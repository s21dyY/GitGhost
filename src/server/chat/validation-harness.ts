import type { OutputDiagnostics } from "./grounding";
import { answerQuestion, type ModelExchange, type PipelineDeps } from "./pipeline";
import { loadChatConfig } from "./config";
import { costMicros } from "./spend";
import type { ChatMessage } from "./types";

/**
 * Controlled real-model validation (Milestone 2C.2). This module only DRIVES the normal pipeline
 * and records what happened. It adds no model access of its own:
 *  - the same gates, reservation, validator and DynamoDB accounting apply;
 *  - calls are sequential, with a fixed pause, and the run STOPS at the first failure;
 *  - a failed billable call is never retried;
 *  - the ceilings of the chosen PLAN are checked before the first call and cannot be raised by
 *    environment variables.
 * A plan pins one model, its verified prices and its call list, so a price from one model can never
 * be used with another. Plans: "claude-haiku-4-5" (Stage 2, blocked by the missing Anthropic use-case
 * form) and "nova-lite" (in-region fallback). Neither is chosen by default.
 * It is exercised offline with fake clients (validation-harness.test.ts, nova-offline.test.ts). The
 * live runner is live.validation.test.ts (opt-in, billable, not run until the owner approves).
 */
export type PlanCall = {
  id: string;
  purpose: string;
  question: string;
  form: "current" | "human";
  /** Carry the previous answer's text as an assistant turn (multi-turn check). */
  followsPrevious?: boolean;
};

export type PlanCeilings = {
  maxCalls: number;
  maxDailyBudgetMicros: number;
  maxRequestsPerDay: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxConcurrency: number;
  maxTimeoutMs: number;
};

export type ValidationPlan = {
  name: string;
  /** The exact model or inference-profile ID the plan is allowed to call. */
  modelId: string;
  region: string;
  /** Verified on-demand prices, USD per million tokens. The environment must equal these exactly. */
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  /** Where the prices came from, for the report. */
  priceSource: string;
  ceilings: PlanCeilings;
  calls: readonly PlanCall[];
  /** The repository the plan runs against. Defaults to atom/atom (the earlier plans). */
  repo?: { owner: string; name: string };
  /** When set, the run must use exactly this named AWS profile for billable work (GITGHOST_BEDROCK_AWS_PROFILE). */
  billableProfile?: string;
};

const WHY_DIE: PlanCall = { id: "1-status", purpose: "Core grounded answer in the saved changed form", question: "Why did you die?", form: "current" };
const MISS_DEVS: PlanCall = { id: "2-feeling", purpose: "Emotional, non-template question: personality without invented facts", question: "Do you miss your developers?", form: "current" };

const PAST: PlanCall = {
  id: "1-past",
  purpose: "V6 smoke test: an open question about the ghost's past, answerable from the README, the repository record and early commits",
  question: "Tell me about your past. What was this repository originally created to do?",
  form: "current",
};

export const PLANS: Readonly<Record<string, ValidationPlan>> = {
  "claude-haiku-4-5": {
    name: "claude-haiku-4-5",
    modelId: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    region: "us-east-2",
    inputUsdPerMTok: 1.1,
    outputUsdPerMTok: 5.5,
    priceSource: "AWS Price List AmazonBedrockFoundationModels 20261012084008, Claude Haiku 4.5 on-demand Regional tier (tier for the us. profile is inferred)",
    ceilings: { maxCalls: 2, maxDailyBudgetMicros: 20_000, maxRequestsPerDay: 2, maxInputTokens: 4000, maxOutputTokens: 300, maxConcurrency: 1, maxTimeoutMs: 20_000 },
    calls: [WHY_DIE, MISS_DEVS],
  },
  "nova-lite": {
    name: "nova-lite",
    // The bare model ID supports ON_DEMAND in us-east-2 (verified read-only), so it is invoked directly,
    // in-region, with no inference profile and no routing to other regions.
    modelId: "amazon.nova-lite-v1:0",
    region: "us-east-2",
    inputUsdPerMTok: 0.06,
    outputUsdPerMTok: 0.24,
    priceSource: "AWS Price List AmazonBedrock 20261030160456 (published 2026-10-30, effective 2026-10-01), Nova Lite on-demand, us-east-2: USD 0.00006 per 1K input tokens, USD 0.00024 per 1K output tokens",
    // Output cap 500 (owner's Stage B decision, replacing the earlier 300): the answer is JSON and a reply
    // cut off by the cap is rejected whole. Exactly one billable call, one request per day, no retries.
    ceilings: { maxCalls: 1, maxDailyBudgetMicros: 20_000, maxRequestsPerDay: 1, maxInputTokens: 4000, maxOutputTokens: 500, maxConcurrency: 1, maxTimeoutMs: 20_000 },
    calls: [WHY_DIE],
  },
  // V6: the same model, region, prices and ceilings as "nova-lite", pointed at the repository and question the owner
  // named for the first browser-ready smoke test. The billable path must run as the restricted profile.
  "nova-lite-v6": {
    name: "nova-lite-v6",
    modelId: "amazon.nova-lite-v1:0",
    region: "us-east-2",
    inputUsdPerMTok: 0.06,
    outputUsdPerMTok: 0.24,
    priceSource: "AWS Price List AmazonBedrock 20261030160456 (published 2026-10-30, effective 2026-10-01), Nova Lite on-demand, us-east-2: USD 0.00006 per 1K input tokens, USD 0.00024 per 1K output tokens (re-checked 2026-11-01)",
    ceilings: { maxCalls: 1, maxDailyBudgetMicros: 20_000, maxRequestsPerDay: 1, maxInputTokens: 4000, maxOutputTokens: 500, maxConcurrency: 1, maxTimeoutMs: 20_000 },
    calls: [PAST],
    repo: { owner: "microsoft", name: "VisualStudioUninstaller" },
    billableProfile: "gitghost-smoke",
  },
};

export function getPlan(name: string | undefined): ValidationPlan {
  const plan = name && Object.hasOwn(PLANS, name) ? PLANS[name] : undefined;
  if (!plan) throw new Error(`Refusing to run: GITGHOST_VALIDATION_PLAN must be one of ${Object.keys(PLANS).join(", ")}.`);
  return plan;
}

// Back-compat for the Claude plan (existing tests and docs).
export const CEILINGS = PLANS["claude-haiku-4-5"].ceilings;
export const PLAN: readonly PlanCall[] = PLANS["claude-haiku-4-5"].calls;

/** Problems that must stop the run before the first call. Empty means the configuration is inside the plan. */
export function checkCeilings(env: Record<string, string | undefined>, plan: ValidationPlan = PLANS["claude-haiku-4-5"]): string[] {
  const loaded = loadChatConfig(env);
  if (!loaded.ok) return loaded.errors;
  const c = loaded.config;
  const k = plan.ceilings;
  const problems: string[] = [];
  if (c.provider !== "bedrock" || !c.bedrockEnabled) problems.push("Provider must be bedrock and enabled for the live run.");
  if (c.killSwitch) problems.push("The environment kill switch is on.");
  if (c.usageStore !== "dynamodb") problems.push("The shared DynamoDB usage store is required.");
  if (c.modelId !== plan.modelId) problems.push(`BEDROCK_MODEL_ID must be exactly ${plan.modelId} for plan ${plan.name}.`);
  if (c.region !== plan.region) problems.push(`AWS_REGION must be ${plan.region} for plan ${plan.name}.`);
  if (c.inputUsdPerMTok !== plan.inputUsdPerMTok || c.outputUsdPerMTok !== plan.outputUsdPerMTok) {
    problems.push(`Prices must be exactly the verified ${plan.inputUsdPerMTok} / ${plan.outputUsdPerMTok} USD per million tokens for plan ${plan.name}.`);
  }
  if (c.dailyBudgetMicros <= 0 || c.dailyBudgetMicros > k.maxDailyBudgetMicros) problems.push(`Daily budget must be above 0 and at most ${k.maxDailyBudgetMicros} micro-dollars.`);
  if (c.globalPerDay > k.maxRequestsPerDay) problems.push(`Requests per day must be at most ${k.maxRequestsPerDay}.`);
  if (c.globalConcurrency > k.maxConcurrency) problems.push("Concurrency must be 1.");
  if (c.maxInputTokens > k.maxInputTokens) problems.push("Input token cap is above the ceiling.");
  if (c.maxOutputTokens > k.maxOutputTokens) problems.push(`Output token cap is above the ceiling (${k.maxOutputTokens}).`);
  if (c.timeoutMs > k.maxTimeoutMs) problems.push("Timeout is above the ceiling.");
  if (c.budgetSafetyFactor < 1.5) problems.push("The safety factor must be at least 1.5.");
  if (plan.billableProfile && c.billableProfile !== plan.billableProfile) {
    problems.push(`GITGHOST_BEDROCK_AWS_PROFILE must be exactly ${plan.billableProfile} for plan ${plan.name}: the billable path runs as the restricted profile.`);
  }
  return problems;
}

export type SegmentReport = { kind: string; text: string; cites: string[] };
export type CallReport = {
  id: string;
  purpose: string;
  question: string;
  form: string;
  status: "answered" | "refused" | "skipped";
  httpStatus?: number;
  code?: string;
  latencyMs?: number;
  provider?: string;
  scripted?: boolean;
  raw?: { text: string; usage: ModelExchange["usage"] };
  /** The provider's stop reason: end_turn is normal; max_tokens means the reply was cut off. */
  stopReason?: string;
  accepted?: SegmentReport[];
  rejectedReasons?: string[];
  /** The reply parsed as JSON (it may still break the contract; see contractOk). */
  rawWasValidJson?: boolean;
  /** The reply obeyed the strict contract: one object, only "segments", usable segments. */
  contractOk?: boolean;
  /** Developer diagnostics: unknown keys, per-segment rejection reasons, accepted counts, stop reason. Codes only, never model text. */
  diagnostics?: OutputDiagnostics;
  /** Shape of the accepted answer, for judging helpfulness at a glance. */
  shape?: { ghost: number; factual: number; unknown: number; citedRefs: string[]; keyFactRefsOffered: number };
  sources?: string[];
  sourcesAllRetrievedGitHub?: boolean;
  shownTextHasLink?: boolean;
  evidenceRefs?: { ref: string; kind: string }[];
  accounting?: { reservedMicros: number; spentMicros: number; expectedMicros: number | null; matchesUsage: boolean };
  counters?: { budgetMicros: number | null; requests: number | null };
  promptBytes?: number;
  /** Provider error NAME and billing outcome (never the provider message). */
  providerError?: { code: string; outcome: "not_billed" | "unknown" };
};
export type RunReport = {
  startedAt: string;
  plan: { name: string; modelId: string; region: string; inputUsdPerMTok: number; outputUsdPerMTok: number; priceSource: string; worstCaseReservationMicros: number };
  stoppedEarly: boolean;
  calls: CallReport[];
  totals: { inputTokens: number; outputTokens: number; spentMicros: number; calls: number };
};

export type Counters = () => Promise<{ budgetMicros: number | null; requests: number | null }>;

const LINK = /(https?:\/\/|www\.)/i;

export async function runPlan(opts: {
  deps: PipelineDeps;
  owner: string;
  repo: string;
  headers: { get(name: string): string | null };
  /** The validation plan (model, prices, ceilings, calls). Defaults to the Claude plan for older callers. */
  validationPlan?: ValidationPlan;
  /** Override the plan's call list (tests only); it still may not exceed the plan's maxCalls. */
  calls?: readonly PlanCall[];
  sleep?: (ms: number) => Promise<void>;
  spacingMs?: number;
  counters?: Counters;
  now?: () => number;
}): Promise<RunReport> {
  const vp = opts.validationPlan ?? PLANS["claude-haiku-4-5"];
  const plan = opts.calls ?? vp.calls;
  if (plan.length > vp.ceilings.maxCalls) throw new Error("The plan has more calls than the ceiling allows.");
  const env = opts.deps.env ?? process.env;
  const problems = checkCeilings(env, vp);
  if (problems.length) throw new Error(`Refusing to run: ${problems.join(" ")}`);
  const loaded = loadChatConfig(env);
  if (!loaded.ok) throw new Error("Refusing to run: invalid configuration.");
  const config = loaded.config;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const worst = costMicros({ inputTokens: config.maxInputTokens, outputTokens: config.maxOutputTokens }, config);
  const report: RunReport = {
    startedAt: new Date(now()).toISOString(),
    plan: { name: vp.name, modelId: vp.modelId, region: vp.region, inputUsdPerMTok: vp.inputUsdPerMTok, outputUsdPerMTok: vp.outputUsdPerMTok, priceSource: vp.priceSource, worstCaseReservationMicros: worst },
    stoppedEarly: false,
    calls: [],
    totals: { inputTokens: 0, outputTokens: 0, spentMicros: 0, calls: 0 },
  };
  let last: { question: string; text: string } | null = null;
  let stopped = false;

  for (const [i, call] of plan.entries()) {
    const base = { id: call.id, purpose: call.purpose, question: call.question, form: call.form };
    if (stopped) {
      report.calls.push({ ...base, status: "skipped" });
      continue;
    }
    if (i > 0) await sleep(opts.spacingMs ?? 30_000);
    const history: ChatMessage[] = call.followsPrevious && last ? [{ role: "user", content: last.question }, { role: "assistant", content: last.text }] : [];
    let exchange: ModelExchange | null = null;
    let providerError: CallReport["providerError"];
    const t0 = now();
    const res = await answerQuestion(
      { owner: opts.owner, repo: opts.repo, question: call.question, history, form: call.form, headers: opts.headers },
      // the harness promises an exact number of model calls: no automatic retry of an unreadable reply
      { ...opts.deps, retryUnreadable: false, chat: { ...opts.deps.chat, onProviderError: (e) => { providerError = e; } }, observe: (e) => { exchange = e; } },
    );
    const latencyMs = now() - t0;
    const counters = opts.counters ? await opts.counters().catch(() => ({ budgetMicros: null, requests: null })) : undefined;
    const ex = exchange as ModelExchange | null;

    if (!res.ok) {
      stopped = true; // never retry a billable call
      report.stoppedEarly = true;
      report.calls.push({
        ...base, status: "refused", httpStatus: res.status, code: res.code, latencyMs, counters, ...(providerError ? { providerError } : {}),
        ...(ex ? { raw: { text: ex.rawText, usage: ex.usage }, stopReason: ex.stopReason, rawWasValidJson: ex.diagnostics.json === "ok", contractOk: ex.validation.ok, diagnostics: ex.diagnostics, promptBytes: Buffer.byteLength(ex.system, "utf8") } : {}),
      });
      if (ex?.usage) { report.totals.inputTokens += ex.usage.inputTokens; report.totals.outputTokens += ex.usage.outputTokens; }
      if (ex) { report.totals.spentMicros += ex.spentMicros; report.totals.calls++; }
      continue;
    }

    const a = res.answer;
    const registryUrls = new Set((ex?.refs ?? []).map((r) => r.item.sourceUrl));
    const expectedMicros = ex?.usage ? costMicros(ex.usage, config) : null;
    report.calls.push({
      ...base, status: "answered", latencyMs, provider: a.provider, scripted: a.scripted, counters,
      promptBytes: ex ? Buffer.byteLength(ex.system, "utf8") : undefined,
      raw: ex ? { text: ex.rawText, usage: ex.usage } : undefined,
      stopReason: ex?.stopReason,
      rawWasValidJson: ex ? ex.diagnostics.json === "ok" : undefined,
      contractOk: ex ? ex.validation.ok : undefined,
      diagnostics: ex?.diagnostics,
      shape: ex
        ? {
            ghost: a.segments.filter((s) => s.kind === "ghost").length,
            factual: a.segments.filter((s) => s.kind === "verified" || s.kind === "interpretation").length,
            unknown: a.segments.filter((s) => s.kind === "unknown").length,
            citedRefs: [...new Set(a.segments.flatMap((s) => s.citations.map((c) => c.ref)))],
            keyFactRefsOffered: (/^- \[E\d+\] /gm.exec(ex.system) ? ex.system.match(/^- \[E\d+\] /gm)!.length : 0),
          }
        : undefined,
      accepted: a.segments.map((s) => ({ kind: s.kind, text: s.text, cites: s.citations.map((c) => c.ref) })),
      rejectedReasons: ex?.diagnostics.rejected.map((r) => r.reason) ?? [],
      sources: a.sources.map((s) => s.url),
      sourcesAllRetrievedGitHub: a.sources.every((s) => registryUrls.has(s.url) && s.url.startsWith(`https://github.com/${opts.owner}/${opts.repo}`)),
      shownTextHasLink: a.segments.some((s) => LINK.test(s.text)),
      evidenceRefs: (ex?.refs ?? []).map((r) => ({ ref: r.ref, kind: r.item.kind })),
      accounting: ex ? { reservedMicros: ex.reservedMicros, spentMicros: ex.spentMicros, expectedMicros, matchesUsage: expectedMicros === null ? ex.spentMicros === ex.reservedMicros : ex.spentMicros === expectedMicros } : undefined,
    });
    if (ex) {
      report.totals.calls++;
      report.totals.spentMicros += ex.spentMicros;
      if (ex.usage) { report.totals.inputTokens += ex.usage.inputTokens; report.totals.outputTokens += ex.usage.outputTokens; }
    }
    last = { question: call.question, text: a.segments.map((s) => s.text).join(" ") };
  }
  return report;
}
