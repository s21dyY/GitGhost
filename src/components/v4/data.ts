import type { Emotion, Tone } from "./fixtures";

/**
 * What the V4 game shows, in one serializable shape. The live page fills it from GitHub and the saved
 * identity (live-data.ts); the offline demo and the prototype fill it from invented fixtures (mock-data.ts).
 * Every field that states a repository fact is either copied from retrieved data or absent. Nothing in
 * the UI invents history: when a source is missing, the matching list is shorter and a note says why.
 */
export type Stage = "human" | "distorted" | "transformed";

export type EraData = {
  id: string;
  /** Seven-character commit id. */
  sha: string;
  /** Full 40-hex id for real commits; null for fixtures. Time Travel questions send this to the server. */
  fullSha: string | null;
  /** YYYY-MM-DD, or "unknown date". */
  date: string;
  message: string;
  /** GitHub commit page, for real commits. */
  url: string | null;
  /** Narrative presentation (see presentation.ts). Never evidence. */
  stage: Stage;
  emotion: Emotion;
  tone: Tone;
  /** A fictional ghost line with no facts in it. */
  ghostLine: string;
  /** Id of this commit's entry in the evidence archive. */
  evidenceId: string;
};

export type EvidenceData = {
  id: string;
  kind: string;
  label: string;
  revision?: string;
  excerpt: string;
  url?: string;
  /** First era index in which this item exists. Earlier eras do not show it. */
  since: number;
  source: "page" | "answer" | "mock";
};

type Note = { id: string; text: string; since: number };
export type Observation = Note & { evidence: string[] };
export type Reading = Note & { basis: string[] };

export type GameData = {
  mode: "live" | "mock";
  repo: { fullName: string; owner: string; name: string; url: string | null; description: string | null };
  /** The ghost is named after its repository. */
  ghostName: string;
  /** Fictional archetype from the saved identity, for example "The Archivist". */
  archetype: string;
  /** Which drawn body the ghost wears. Chosen from the saved identity, never rerolled. Defaults to the Archivist. */
  sprite?: "archivist" | "watchkeeper" | "hound" | "clockmaker" | "bellwraith";
  /** Cosmetic backdrop family chosen from the repository metadata (scene-theme.ts). Defaults to the old graveyard. */
  scene?: "graveyard" | "network" | "frontend" | "infra" | "data" | "comms";
  /** Plain statement of the repository's status as retrieved, or a fixture notice. */
  statusLine: string;
  identity: { state: "saved" | "provisional" | "mock"; note: string | null };
  /** How replies are produced right now. Display only: the server decides. */
  replyMode: "scripted" | "model" | "unavailable";
  /** Whether the Specialist (deep code analysis) can be asked on this server (src/server/specialist/config.ts). */
  specialist: boolean;
  /** The ghost's saved form: what it looks like when no era is selected (or none could be read). */
  restingStage: Stage;
  /** Alive (committed to within a year, or not judged) or left behind (archived or quiet): see domain/status.ts. */
  vitality: "alive" | "dead";
  eras: EraData[];
  history: { complete: boolean; total: number | null; note: string | null };
  evidence: EvidenceData[];
  observed: Observation[];
  readings: Reading[];
  unknown: Note[];
  shortcuts: string[];
};

export type SegmentKind = "record" | "reading" | "unknown" | "ghost";
export type ReplySegment = { kind: SegmentKind; text: string; cites: string[] };
export type Reply = {
  segments: ReplySegment[];
  /** Evidence ids cited anywhere in the reply, first use first. */
  sources: string[];
  provider?: "mock" | "bedrock";
  /** Sources the server could not read, in plain words. */
  gaps?: string[];
  /** Set when the answer was scoped to a historical commit. */
  asOf?: { shortSha: string; date: string };
};

export type AskResult =
  | { ok: true; reply: Reply; evidence: EvidenceData[] }
  | { ok: false; code: string; message: string; retryAfterSec?: number };

export type Ask = (input: { question: string; eraIdx: number; history: { role: "user" | "assistant"; content: string }[] }) => Promise<AskResult>;
