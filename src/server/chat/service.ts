import { randomUUID } from "node:crypto";
import { resolveClientIdentity, type ClientIdentity } from "@/server/limits/client-key";
import { bedrockReadiness, loadChatConfig, type ChatConfig } from "./config";
import { createMockProvider } from "./providers/mock";
import { costMicros, maxRequestCostMicros, utcDay } from "./spend";
import { estimateRequestTokens } from "./tokens";
import { ProviderError, type ChatMessage, type ChatProvider, type ChatResponse } from "./types";
import { createMemoryUsageStore, UsageStoreError, type UsageStore } from "./usage-store";

/**
 * Chat gate: every request passes through here, whichever provider answers.
 *
 * Order (cheapest and cost-free checks first):
 *  1 config valid -> 2 provider allowed (flag, env kill switch) -> 3 input size
 *  4 per-client rate limit -> [billable only:]
 *  5 shared kill switch -> 6 concurrency lease -> 7 global daily request count
 *  8 ATOMIC budget reservation of the worst-case cost -> 9 invoke with timeout -> 10 reconcile.
 *
 * A billable call is refused whenever any shared-store step fails. A reservation is only refunded
 * when the actual cost is known or the provider says the request was rejected before inference.
 * Timeouts, crashes and unknown errors keep the full reservation.
 */
export type ChatFailureCode =
  | "invalid_config"
  | "bedrock_disabled"
  | "kill_switch"
  | "input_too_large"
  | "rate_limited"
  | "daily_limit"
  | "busy"
  | "budget_exhausted"
  | "budget_unavailable"
  | "provider_timeout"
  | "provider_error";

export type ChatResult =
  | { ok: true; text: string; provider: "mock" | "bedrock"; billable: boolean; usage: ChatResponse["usage"]; reservedMicros: number; spentMicros: number; stopReason?: string }
  | { ok: false; status: number; code: ChatFailureCode; message: string; retryAfterSec?: number };

export type ChatFailure = Extract<ChatResult, { ok: false }>;

export type ChatInput = {
  headers: { get(name: string): string | null };
  system: string;
  messages: ChatMessage[];
  /** Optional sampling temperature for conversational turns. */
  temperature?: number;
};

export type ChatDeps = {
  env?: Record<string, string | undefined>;
  now?: () => number;
  /** Provider factory is called only after every gate has passed, so no client is built early. */
  createProvider?: (config: ChatConfig) => ChatProvider;
  /** Shared store for billable work and (when configured) rate limits. */
  store?: UsageStore;
  /** Fallback for free (mock) requests when no shared store is configured or it fails. */
  localStore?: UsageStore;
  newId?: () => string;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  /**
   * Diagnostic hook for the validation harness. Receives only the provider error NAME and whether it
   * may have been billed, never the provider's message. It cannot change the outcome.
   */
  onProviderError?: (e: { code: string; outcome: "not_billed" | "unknown" }) => void;
  /**
   * Whose counters this call uses. "chat" (default) keeps the original keys. "specialist" (deep code analysis,
   * src/server/specialist) counts its requests, budget and rate limit separately, and must also pass its own kill
   * switch, KILL#specialist, on top of the shared KILL#bedrock. The concurrency lease is shared.
   */
  ledger?: "chat" | "specialist";
};

/**
 * Cheap, store-free checks that must pass before anything expensive happens (GitHub retrieval,
 * identity lookups, provider construction): valid configuration, Bedrock flag, env kill switch,
 * and Bedrock readiness.
 */
export function preflightChat(
  env: Record<string, string | undefined> = process.env,
  log: (event: string, detail?: Record<string, unknown>) => void = (e, d) => console.error(`[chat] ${e}`, d ?? ""),
): { ok: true; config: ChatConfig } | { ok: false; failure: ChatFailure } {
  const cfg = loadChatConfig(env);
  if (!cfg.ok) {
    log("invalid_config", { errors: cfg.errors });
    return { ok: false, failure: fail(503, "invalid_config", "Chat is unavailable because its configuration is invalid.") };
  }
  const c = cfg.config;
  if (c.provider === "bedrock") {
    if (!c.bedrockEnabled) return { ok: false, failure: fail(503, "bedrock_disabled", "Model-backed chat is switched off.") };
    if (c.killSwitch) return { ok: false, failure: fail(503, "kill_switch", "Model-backed chat is switched off.") };
    const problems = bedrockReadiness(c);
    if (problems.length) {
      log("bedrock_not_ready", { problems });
      return { ok: false, failure: fail(503, "invalid_config", "Chat is unavailable because its configuration is incomplete.") };
    }
  }
  return { ok: true, config: c };
}

const fail = (status: number, code: ChatFailureCode, message: string, retryAfterSec?: number): ChatFailure => ({
  ok: false, status, code, message, ...(retryAfterSec ? { retryAfterSec } : {}),
});

const DAY_TTL = 3 * 86_400;
const KILL_FLAG = "KILL#bedrock";
const SPECIALIST_KILL_FLAG = "KILL#specialist";
/** Counter keys per ledger. Chat's are the original ones, unchanged. */
const keysFor = (ledger: "chat" | "specialist", day: string) =>
  ledger === "chat"
    ? { rate: "RL#chat", requests: `REQ#bedrock#${day}`, budget: `BUDGET#${day}` }
    : { rate: "RL#specialist", requests: `REQ#specialist#${day}`, budget: `BUDGET#specialist#${day}` };

// Per-process fallback for free requests only.
let defaultLocal: UsageStore | undefined;

/** Test helper: forget the process-local counters used when no shared store is supplied. */
export function resetChatLocalStateForTests(): void {
  defaultLocal = undefined;
}

export async function runChat(input: ChatInput, deps: ChatDeps = {}): Promise<ChatResult> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((event, detail) => console.error(`[chat] ${event}`, detail ?? ""));

  const pre = preflightChat(env, log);
  if (!pre.ok) return pre.failure;
  const c = pre.config;
  const wantsBedrock = c.provider === "bedrock";

  // Build the provider object now. This performs no network call and spends nothing; if it cannot
  // be built we stop before touching any counter.
  let provider: ChatProvider;
  try {
    provider = (deps.createProvider ?? (wantsBedrock ? missingBedrockFactory : defaultMockFactory))(c);
    if (provider.billable !== wantsBedrock) throw new Error("Provider does not match the configured provider.");
  } catch (err) {
    log("provider_unavailable", { name: (err as Error).name });
    return fail(503, "invalid_config", "Chat is unavailable because its configuration is incomplete.");
  }

  // Input guard (pessimistic estimate), before any shared-store traffic.
  const estimated = estimateRequestTokens(input);
  if (input.messages.length === 0 || estimated > c.maxInputTokens) {
    return fail(413, "input_too_large", `The question is too long (limit about ${c.maxInputTokens} tokens).`);
  }

  const identity: ClientIdentity = resolveClientIdentity(input.headers, env);
  const sharedStore = deps.store ?? undefined;
  const local = deps.localStore ?? (defaultLocal ??= createMemoryUsageStore());

  // Free requests may use the shared store, but fall back to process memory if it fails.
  // Billable requests never fall back.
  const ledger = deps.ledger ?? "chat";
  const rateKey = `${keysFor(ledger, "").rate}#${identity.key}#${Math.floor(now() / 60_000)}`;
  const rateStore = wantsBedrock ? sharedStore : (sharedStore ?? local);
  if (!rateStore) return fail(503, "budget_unavailable", "Chat is unavailable right now.");
  let rate;
  try {
    rate = await rateStore.incrementIfBelow(rateKey, c.perClientPerMinute, 120);
  } catch (err) {
    if (wantsBedrock) {
      log("rate_store_failed", { name: (err as Error).name });
      return fail(503, "budget_unavailable", "Chat is unavailable right now.");
    }
    rate = await local.incrementIfBelow(rateKey, c.perClientPerMinute, 120);
  }
  if (!rate.ok) {
    const retry = 60 - Math.floor((now() % 60_000) / 1000);
    return fail(429, "rate_limited", `Too many questions. Try again in ${retry} seconds.`, retry);
  }

  // ---- free path ---------------------------------------------------------------------------
  if (!wantsBedrock) {
    return invokeFree(provider, input, c);
  }

  // ---- billable path: everything below needs the shared store ------------------------------
  const store = sharedStore!;
  const id = (deps.newId ?? randomUUID)();
  const day = utcDay(now());
  const keys = keysFor(ledger, day);
  const reserve = maxRequestCostMicros(c);
  let lease: number | null = null;
  let countedRequest = false;
  let reserved = false;

  const undo = async () => {
    // Best effort. If a refund fails we stay conservative (the counters stay over-counted).
    if (reserved) await store.add(keys.budget, -reserve, DAY_TTL).catch(() => undefined);
    if (countedRequest) await store.add(keys.requests, -1, DAY_TTL).catch(() => undefined);
    if (lease !== null) await store.releaseLease("LEASE#bedrock", lease, id).catch(() => undefined);
  };

  try {
    if (await store.getFlag(KILL_FLAG)) return fail(503, "kill_switch", "Model-backed chat is switched off.");
    if (ledger === "specialist" && (await store.getFlag(SPECIALIST_KILL_FLAG))) return fail(503, "kill_switch", "The Specialist is switched off.");

    lease = await store.acquireLease("LEASE#bedrock", c.globalConcurrency, c.timeoutMs + 10_000, id);
    if (lease === null) return fail(429, "busy", "The ghost is busy answering others. Try again shortly.", 5);

    const req = await store.incrementIfBelow(keys.requests, c.globalPerDay, DAY_TTL);
    if (!req.ok) {
      await undo();
      return fail(429, "daily_limit", "Today's question limit has been reached. Try again tomorrow (UTC).");
    }
    countedRequest = true;

    const budget = await store.addIfWithin(keys.budget, reserve, c.dailyBudgetMicros, DAY_TTL);
    if (!budget.ok) {
      await undo();
      return fail(429, "budget_exhausted", "Today's spending limit has been reached. Try again tomorrow (UTC).");
    }
    reserved = true;
  } catch (err) {
    if (err instanceof UsageStoreError || (err as Error).name === "UsageStoreError") {
      log("store_failed_before_invoke", { name: (err as Error).name });
      await undo();
      return fail(503, "budget_unavailable", "Chat is unavailable right now.");
    }
    throw err;
  }

  // The reservation is held. From here on we only ever refund with certainty.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProviderError("The model took too long.", "unknown", "timeout"));
    }, c.timeoutMs);
  });

  try {
    const response = await Promise.race([
      provider.invoke({ system: input.system, messages: input.messages, maxOutputTokens: c.maxOutputTokens, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}) }, { signal: controller.signal }),
      timeout,
    ]);
    clearTimeout(timer);

    let spent = reserve; // unknown usage: keep the full reservation
    if (response.usage) {
      const actual = costMicros(response.usage, c);
      spent = actual;
      try {
        await store.add(keys.budget, actual - reserve, DAY_TTL); // usually a refund; positive if we under-reserved
      } catch (err) {
        spent = reserve; // reconcile failed: the reservation stands
        log("reconcile_failed", { name: (err as Error).name });
      }
      if (actual > reserve) log("under_reserved", { actual, reserve });
    }
    await store.releaseLease("LEASE#bedrock", lease!, id).catch(() => undefined);
    return { ok: true, text: response.text, provider: provider.id, billable: true, usage: response.usage, reservedMicros: reserve, spentMicros: spent, stopReason: response.stopReason };
  } catch (err) {
    clearTimeout(timer);
    deps.onProviderError?.(
      timedOut ? { code: "timeout", outcome: "unknown" } : err instanceof ProviderError ? { code: err.code, outcome: err.outcome } : { code: (err as Error)?.name ?? "Error", outcome: "unknown" },
    );
    if (timedOut) {
      // Outcome unknown: keep the reservation and the lease (it expires on its own).
      log("timeout_kept_reservation", { reserve });
      return fail(504, "provider_timeout", "The ghost took too long to answer.");
    }
    if (err instanceof ProviderError && err.outcome === "not_billed") {
      await undo();
      return fail(502, "provider_error", "The ghost could not answer right now.");
    }
    // Unknown outcome (or a bug): keep the reservation and the lease.
    log("unknown_outcome_kept_reservation", { reserve, name: (err as Error).name });
    return fail(502, "provider_error", "The ghost could not answer right now.");
  }
}

async function invokeFree(provider: ChatProvider, input: ChatInput, c: ChatConfig): Promise<ChatResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), c.timeoutMs);
  try {
    const r = await provider.invoke({ system: input.system, messages: input.messages, maxOutputTokens: c.maxOutputTokens, ...(input.temperature !== undefined ? { temperature: input.temperature } : {}) }, { signal: controller.signal });
    return { ok: true, text: r.text, provider: provider.id, billable: false, usage: r.usage, reservedMicros: 0, spentMicros: 0, stopReason: r.stopReason };
  } catch {
    return controller.signal.aborted ? fail(504, "provider_timeout", "The ghost took too long to answer.") : fail(502, "provider_error", "The ghost could not answer right now.");
  } finally {
    clearTimeout(timer);
  }
}

function defaultMockFactory(): ChatProvider {
  return createMockProvider();
}
function missingBedrockFactory(): ChatProvider {
  // Real Bedrock wiring (client, credentials) is intentionally not part of this checkpoint.
  throw new Error("No Bedrock provider factory was supplied.");
}
