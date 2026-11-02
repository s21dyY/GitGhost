import type { EntityAssignment } from "@/domain/entity";
import { parseRepoInput } from "@/domain/repo-ref";
import { classifyIntent, intentForTurn } from "@/server/evidence/intent";
import { retrieveEvidenceAsOf, type EraRetrieved } from "@/server/evidence/era";
import { retrieveEvidence, type RetrieveDeps } from "@/server/evidence/retrieve";
import { selectEvidence, type EvidenceRef } from "@/server/evidence/select";
import { resolveEntityForRepo } from "@/server/entity/resolve";
import { keyFacts } from "@/server/evidence/plan";
import { resolveClientIdentity } from "@/server/limits/client-key";
import type { Stage } from "@/config/entities";
import { loadChatConfig } from "./config";
import { classifyTurn, temperatureFor } from "./conversation";
import { validateModelOutput, type ModelOutputResult, type OutputDiagnostics } from "./grounding";
import { buildPrompt } from "./prompt";
import { createGroundedMock } from "./providers/grounded-mock";
import { billableRuntime, type RuntimeClients } from "./runtime";
import { preflightChat, runChat, type ChatDeps } from "./service";
import { estimateRequestTokens } from "./tokens";
import type { ChatMessage } from "./types";
import type { Voice } from "./voice";

export type PipelineRequest = {
  owner: string;
  repo: string;
  question: string;
  history: ChatMessage[];
  form: "current" | "human";
  /** Time Travel: full SHA of the selected commit. Evidence is read as it stood then. */
  asOf?: string;
  /** The ghost's look in that era; used for voice only. Ignored without asOf. */
  eraStage?: Stage;
  headers: { get(name: string): string | null };
};

export type { GroundedAnswer } from "@/domain/chat";
import type { Citation, GroundedAnswer } from "@/domain/chat";

export type PipelineFailure = { ok: false; status: number; code: string; message: string; retryAfterSec?: number };
export type PipelineResult = { ok: true; answer: GroundedAnswer } | PipelineFailure;

export type PipelineDeps = RetrieveDeps & {
  env?: Record<string, string | undefined>;
  chat?: ChatDeps;
  /** Test seam: replaces identity resolution. */
  resolveIdentity?: typeof resolveEntityForRepo;
  /** Test seam: replaces the provider built for the mock path (for example a hostile "model"). */
  providerOverride?: (refs: readonly EvidenceRef[]) => import("./types").ChatProvider;
  /** Test seam: fake AWS clients for the billable path. Real clients are created lazily only when none are given. */
  clients?: RuntimeClients;
  /**
   * Diagnostic seam for the controlled validation harness and tests. Called once per completed
   * model exchange, before the answer is returned. It cannot change the result.
   */
  observe?: (e: ModelExchange) => void;
};

export type ModelExchange = {
  system: string;
  messages: ChatMessage[];
  rawText: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  reservedMicros: number;
  spentMicros: number;
  /** The provider's stop reason (for example end_turn, max_tokens, content_filtered). */
  stopReason?: string;
  refs: readonly EvidenceRef[];
  /** The strict validation result for the raw reply (accepted segments, rejections, diagnostics). */
  validation: ModelOutputResult;
  /** Convenience copy of validation.diagnostics, with the provider stop reason merged in. */
  diagnostics: OutputDiagnostics;
};

const fail = (status: number, code: string, message: string, retryAfterSec?: number): PipelineFailure => ({ ok: false, status, code, message, ...(retryAfterSec ? { retryAfterSec } : {}) });

export async function answerQuestion(req: PipelineRequest, deps: PipelineDeps = {}): Promise<PipelineResult> {
  const env = deps.env ?? process.env;
  const ref = parseRepoInput(`${req.owner}/${req.repo}`);
  if (!ref.ok) return fail(400, "bad_request", ref.message);

  // 1. Cheap checks first, before any GitHub or storage traffic.
  const pre = preflightChat(env);
  if (!pre.ok) return fail(pre.failure.status, pre.failure.code, pre.failure.message);
  const config = pre.config;
  const clientKey = resolveClientIdentity(req.headers, env).key;

  // 2. Intent from the question (and earlier user turns for short follow-ups).
  const priorUser = req.history.filter((m) => m.role === "user").map((m) => m.content);
  const intent = intentForTurn(req.question, priorUser);
  const turn = classifyTurn(req.question);
  const variant = priorUser.filter((q) => classifyIntent(q) === intent || intentForTurn(q, []) === intent).length;

  // 3. Evidence (bounded, selective).
  const got = req.asOf ? await retrieveEvidenceAsOf(ref, intent, req.asOf, deps) : await retrieveEvidence(ref, intent, deps);
  if (!got.ok) {
    if (got.code === "bad_era") return fail(400, "bad_request", got.message);
    if (got.code === "era_not_found") return fail(404, "era_not_found", got.message);
    if (got.code === "not_found") return fail(404, "repo_not_found", "GitHub has no public record of that repository.");
    if (got.code === "rate_limited") return fail(503, "github_rate_limited", "GitHub is limiting requests right now. Try again in a little while.", 60);
    return fail(502, "github_unavailable", "GitHub could not be reached. Try again shortly.");
  }

  // 4. Authoritative identity from the server. Never created here.
  const resolveIdentity = deps.resolveIdentity ?? resolveEntityForRepo;
  const entity = await resolveIdentity(got.repo, { clientKey, readOnly: true });
  if (entity.status === "error") return fail(503, "ghost_unavailable", entity.message);
  const assignment: EntityAssignment = entity.assignment;
  const era = req.asOf ? (got as Partial<EraRetrieved>).asOf : undefined;
  const stage: Stage = era && req.eraStage ? req.eraStage : req.form === "human" ? "human" : assignment.currentStage;
  const voice: Voice = stage === "human" ? "human" : "horror";

  // 5. Fit evidence and history inside the input budget (the same pessimistic estimator runChat uses).
  const inputCap = config.maxInputTokens;
  let history = [...req.history];
  let refs: EvidenceRef[] = [];
  let prompt = buildPrompt({ assignment, stage, refs, gaps: got.gaps, history, question: req.question, repoName: got.repo.fullName, intent, turn, era });
  const fits = (p: typeof prompt) => estimateRequestTokens(p) <= inputCap;
  const baseBytes = () => Buffer.byteLength(prompt.system, "utf8") + history.reduce((n, m) => n + Buffer.byteLength(m.content, "utf8"), 0) + Buffer.byteLength(req.question, "utf8");
  while (history.length > 0 && inputCap * 2 - baseBytes() < 1400) history = history.slice(2); // drop the oldest exchange
  prompt = buildPrompt({ assignment, stage, refs, gaps: got.gaps, history, question: req.question, repoName: got.repo.fullName, intent, turn, era });
  let budget = inputCap * 2 - baseBytes() - 40 * (history.length + 2) - 200;
  for (;;) {
    refs = budget > 200 ? selectEvidence(got.items, { intent, question: req.question, byteBudget: budget }) : [];
    prompt = buildPrompt({ assignment, stage, refs, gaps: got.gaps, history, question: req.question, repoName: got.repo.fullName, intent, turn, era });
    if (fits(prompt) || refs.length === 0) break;
    budget = Math.floor(budget * 0.8);
  }
  if (!fits(prompt)) return fail(413, "input_too_large", "That conversation is too long. Start a new one.");

  // 6. Provider. Mock by default. The real model is used only when preflight already accepted
  //    provider "bedrock" (flag on, kill switch off, price and usage-store config complete).
  const billable = config.provider === "bedrock";
  const runtime = billable ? billableRuntime(config, deps.clients) : {};
  const provider =
    deps.providerOverride?.(refs) ??
    (billable
      ? null
      : createGroundedMock({ refs, intent, gaps: got.gaps, assignment, voice, variant, repo: { archived: got.repo.archived, fullName: got.repo.fullName }, era }));

  // 7. The existing safety pipeline: limits, budget, concurrency, timeout.
  const result = await runChat(
    { headers: req.headers, system: prompt.system, messages: prompt.messages, temperature: temperatureFor(turn) },
    { ...runtime, ...deps.chat, env, createProvider: provider ? () => provider : (deps.chat?.createProvider ?? runtime.createProvider) },
  );
  if (!result.ok) return fail(result.status, result.code, result.message, result.retryAfterSec);

  // 8. Validate before showing anything. Unvalidated model text is never displayed.
  const validated = validateModelOutput(result.text, refs, { era: !!era, allowProse: turn !== "factual" });
  const diagnostics: OutputDiagnostics = { ...validated.diagnostics, stopReason: result.stopReason, truncated: result.stopReason === "max_tokens" };
  if (validated.ok) {
    const count = (k: string) => validated.segments.filter((s) => s.kind === k).length;
    const factual = count("verified") + count("interpretation");
    const offered = keyFacts(refs, intent).length;
    diagnostics.quality = {
      ghostSegments: count("ghost"), factualSegments: factual, unknownSegments: count("unknown"), keyFactsOffered: offered,
      citedRefs: [...new Set(validated.segments.flatMap((s) => s.citations.map((c) => c.ref)))], thin: turn !== "character" && offered > 0 && factual === 0,
    };
  }
  deps.observe?.({ system: prompt.system, messages: prompt.messages, rawText: result.text, usage: result.usage, reservedMicros: result.reservedMicros, spentMicros: result.spentMicros, stopReason: result.stopReason, refs, validation: validated, diagnostics });
  // Developer log: codes and counts only. The model's text is untrusted and is never written to logs or shown.
  const log = deps.chat?.log ?? ((event: string, detail?: Record<string, unknown>) => console.error(`[chat] ${event}`, detail ?? ""));
  if (!validated.ok || diagnostics.rejected.length || diagnostics.ignoredSegmentKeys.length) {
    log(validated.ok ? "model_output_partly_rejected" : "model_output_rejected", {
      refusedBecause: diagnostics.refusedBecause, unknownTopLevelKeys: diagnostics.unknownTopLevelKeys, topLevelKeys: diagnostics.topLevelKeys,
      segmentCount: diagnostics.segmentCount, rejected: diagnostics.rejected, ignoredSegmentKeys: diagnostics.ignoredSegmentKeys,
      accepted: diagnostics.accepted, stopReason: diagnostics.stopReason, truncated: diagnostics.truncated,
    });
  }
  if (diagnostics.quality?.thin) log("model_answer_thin", { keyFactsOffered: diagnostics.quality.keyFactsOffered, accepted: diagnostics.accepted, intent });
  if (!validated.ok) return fail(502, "unverifiable_answer", "The ghost's reply came back garbled, so nothing was shown. Please ask again.");
  let segments = validated.segments;
  // Uncertainty is stated by the server, never invented: a removed unsupported claim is acknowledged, and a factual or
  // mixed question with no supported fact says so. Pure character talk needs neither.
  const hasUnknown = segments.some((s) => s.kind === "unknown");
  if ((diagnostics.droppedFactual ?? 0) > 0 && !hasUnknown) {
    segments = [...segments, { kind: "unknown", text: segments.length === 0 ? "That memory will not come back to me." : "Part of that memory is too tangled to trust, so I will not speak it.", citations: [] }];
  } else if (!hasUnknown && !segments.some((s) => s.kind !== "ghost") && (turn !== "character" || segments.length === 0)) {
    segments = [...segments, { kind: "unknown", text: "That memory will not come back to me.", citations: [] }];
  }

  const seen = new Set<string>();
  const sources: Citation[] = [];
  for (const s of segments) for (const c of s.citations) if (!seen.has(c.id)) { seen.add(c.id); sources.push(c); }

  return {
    ok: true,
    answer: {
      segments, sources, intent, form: req.form, stage, voice,
      provider: result.provider, scripted: result.provider === "mock",
      gaps: got.gaps.map((g) => `${g.source}: ${g.message}`),
      identityStatus: entity.status === "persisted" ? "persisted" : "provisional",
      ...(era ? { asOf: era } : {}),
    },
  };
}

export { loadChatConfig };
