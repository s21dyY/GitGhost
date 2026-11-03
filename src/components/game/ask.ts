import type { Ask, AskResult, EvidenceData, GameData, ReplySegment, SegmentKind } from "./data";
import type { ChatApiResponse, GroundedAnswer } from "@/domain/chat";

/**
 * Live questions: POST /api/chat, the same guarded endpoint the classic screen uses. The browser sends
 * the question, the earlier turns of THIS era, and for a historical era the full SHA and the look the ghost
 * has there. The server re-reads the evidence for that commit, re-checks every citation, and decides
 * everything else (identity, provider, limits, budget). Nothing here talks to GitHub or AWS.
 */
const KIND: Record<string, SegmentKind> = { verified: "record", interpretation: "reading", unknown: "unknown", ghost: "ghost" };

export function toAskResult(answer: GroundedAnswer, eraIdx: number): Extract<AskResult, { ok: true }> {
  const evidence: EvidenceData[] = answer.sources.map((c) => ({
    id: c.id,
    kind: c.kind,
    label: c.label,
    revision: c.revisionSha?.slice(0, 7),
    excerpt: c.excerpt ?? "",
    url: c.url,
    since: eraIdx,
    source: "answer",
  }));
  const segments: ReplySegment[] = answer.segments.map((s) => ({ kind: KIND[s.kind] ?? "unknown", text: s.text, cites: s.citations.map((c) => c.id) }));
  return {
    ok: true,
    reply: { segments, sources: answer.sources.map((c) => c.id), provider: answer.provider, gaps: answer.gaps, ...(answer.asOf ? { asOf: { shortSha: answer.asOf.shortSha, date: answer.asOf.date.slice(0, 10) } } : {}) },
    evidence,
  };
}

export function liveAsk(data: Pick<GameData, "repo" | "eras">, fetchImpl: typeof fetch = fetch): Ask {
  return async ({ question, eraIdx, history }) => {
    const era = data.eras[eraIdx];
    const latest = eraIdx >= data.eras.length - 1;
    // The latest era is "now": a present-day question. Older eras are answered as of their commit.
    const timeTravel = !!era && !latest && !!era.fullSha;
    let res: Response;
    try {
      res = await fetchImpl("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owner: data.repo.owner,
          repo: data.repo.name,
          question,
          history,
          // a living repository's ghost speaks as the person it still is (the server's human voice)
          form: !timeTravel && era?.stage === "human" ? "human" : "current",
          ...(timeTravel ? { asOf: era.fullSha, eraStage: era.stage } : {}),
        }),
      });
    } catch {
      return { ok: false, code: "network", message: "The ghost could not be reached. Check your connection and try again." };
    }
    let body: ChatApiResponse;
    try {
      body = (await res.json()) as ChatApiResponse;
    } catch {
      return { ok: false, code: "bad_response", message: "The ghost's answer was unreadable. Try again." };
    }
    if (!body.ok) return { ok: false, code: body.code, message: body.message, retryAfterSec: body.retryAfterSec };
    return toAskResult(body.answer, eraIdx);
  };
}
