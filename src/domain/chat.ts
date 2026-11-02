/** Types shared by the chat API and the browser. Plain data only; no server imports. */
export type SegmentKind = "verified" | "interpretation" | "unknown" | "ghost";

export type Citation = {
  ref: string; id: string; kind: string; label: string; url: string;
  /** The retrieved text the claim rests on (server copy, bounded), so the reader can inspect it. */
  excerpt?: string;
  /** Commit the evidence was read at, when it was read for a historical era. */
  revisionSha?: string;
};
export type AnswerSegment = { kind: SegmentKind; text: string; citations: Citation[] };

export type GroundedAnswer = {
  segments: AnswerSegment[];
  /** Deduplicated citations in first-use order. Every URL came from the server's evidence registry. */
  sources: Citation[];
  intent: "status" | "recent" | "history" | "issues" | "general" | "file";
  form: "current" | "human";
  stage: "human" | "distorted" | "transformed";
  voice: "human" | "horror";
  provider: "mock" | "bedrock";
  /** True when the reply was composed by fixed templates, not by an AI model. */
  scripted: boolean;
  /** Evidence sources that could not be read, in plain words. */
  gaps: string[];
  identityStatus: "persisted" | "provisional";
  /** Set when the answer is scoped to a historical commit: nothing after it was read. */
  asOf?: { sha: string; shortSha: string; date: string };
};

export type ChatApiResponse =
  | { ok: true; answer: GroundedAnswer }
  | { ok: false; code: string; message: string; retryAfterSec?: number };
