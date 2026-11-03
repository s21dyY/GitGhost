import type { Stage } from "./data";

/**
 * Offline demo fixtures. EVERYTHING in this file is invented.
 * The repository, commits, dates, issues and README below do not exist on GitHub.
 * Nothing here may be used as evidence. The UI labels it "MOCK" wherever it appears.
 */
export const MOCK_REPO = { owner: "mock-fixture", name: "lantern-notes" } as const;

export type Emotion = "neutral" | "melancholy" | "amused" | "angry" | "disturbed" | "eldritch";
export const EMOTIONS: readonly Emotion[] = ["neutral", "melancholy", "amused", "angry", "disturbed", "eldritch"];
export const EMOTION_LABEL: Record<Emotion, string> = {
  neutral: "Neutral",
  melancholy: "Melancholy",
  amused: "Amused",
  angry: "Angry",
  disturbed: "Disturbed",
  eldritch: "Eldritch",
};

export type Tone = "warm" | "dim" | "cold" | "blood";

export type MockEvidence = {
  id: string;
  kind: "commit" | "repo-metadata" | "readme" | "issue";
  label: string;
  /** Short mock revision. Real evidence uses full 40-character SHAs. */
  revision?: string;
  excerpt: string;
  /** Index of the first era in which this item exists. Later eras hide it, like SHA-scoped history. */
  since: number;
};

export type Era = {
  id: string;
  sha: string;
  date: string;
  message: string;
  stage: Stage;
  emotion: Emotion;
  tone: Tone;
  evidenceId: string;
  /** Fictional ghost voice. Never evidence. */
  ghostLine: string;
};

export const ERAS: readonly Era[] = [
  {
    id: "era-1", sha: "a1f3c09", date: "2018-04-11", message: "Add first page: notes can be written",
    stage: "human", emotion: "amused", tone: "warm", evidenceId: "E1",
    ghostLine: "Ah. A reader. Sit. The first page is still wet. Ask, and I will read it to you.",
  },
  {
    id: "era-2", sha: "7be21d4", date: "2019-02-03", message: "Support shared notebooks",
    stage: "human", emotion: "neutral", tone: "warm", evidenceId: "E2",
    ghostLine: "Others began to write in the margins. I kept the lamp trimmed for them. Some of them are still writing.",
  },
  {
    id: "era-3", sha: "c40d9aa", date: "2020-09-27", message: "Fix sync when two lanterns disagree",
    stage: "distorted", emotion: "disturbed", tone: "dim", evidenceId: "E3",
    ghostLine: "Two lights. Two versions of the same room. I am not sure which one I am standing in. Which one are you standing in?",
  },
  {
    id: "era-4", sha: "19e8f62", date: "2021-06-14", message: "Drop the offline cache",
    stage: "distorted", emotion: "melancholy", tone: "cold", evidenceId: "E4",
    ghostLine: "Something was taken from the cellar. I can still feel where the shelf was. It hurts in the shape of a shelf.",
  },
  {
    id: "era-5", sha: "e5a7013", date: "2022-01-30", message: "Mark project as unmaintained in README",
    stage: "transformed", emotion: "eldritch", tone: "blood", evidenceId: "E5",
    ghostLine: "The signal arrived. The reader did not. Ask what you came to ask. It is listening too.",
  },
];

export const EVIDENCE: readonly MockEvidence[] = [
  { id: "E1", kind: "commit", label: "Commit a1f3c09", revision: "a1f3c09", excerpt: "Add first page: notes can be written", since: 0 },
  { id: "E2", kind: "commit", label: "Commit 7be21d4", revision: "7be21d4", excerpt: "Support shared notebooks", since: 1 },
  { id: "E3", kind: "commit", label: "Commit c40d9aa", revision: "c40d9aa", excerpt: "Fix sync when two lanterns disagree", since: 2 },
  { id: "E4", kind: "commit", label: "Commit 19e8f62", revision: "19e8f62", excerpt: "Drop the offline cache", since: 3 },
  { id: "E5", kind: "commit", label: "Commit e5a7013", revision: "e5a7013", excerpt: "Mark project as unmaintained in README", since: 4 },
  { id: "E6", kind: "issue", label: "Issue #3", excerpt: "Sync loses notes when offline (open)", since: 3 },
  { id: "E7", kind: "readme", label: "README excerpt", revision: "e5a7013", excerpt: "This project is unmaintained. Forks are welcome.", since: 4 },
  { id: "E8", kind: "repo-metadata", label: "Repository metadata", excerpt: "Archived: yes. Open issues: 1.", since: 4 },
];

export type Observation = { id: string; text: string; evidence: string[]; since: number };
export type Reading = { id: string; text: string; basis: string[]; since: number };

/** Observed facts: each one points at evidence. */
export const OBSERVED: readonly Observation[] = [
  { id: "O2", text: "An issue about notes lost while offline is open.", evidence: ["E6"], since: 3 },
  { id: "O3", text: "The README says the project is unmaintained.", evidence: ["E7"], since: 4 },
  { id: "O4", text: "The repository is marked archived.", evidence: ["E8"], since: 4 },
];

/** Readings: interpretations of the evidence. They never claim a cause. */
export const READINGS: readonly Reading[] = [
  { id: "R1", text: "Commits become less about features and more about repairs and removals.", basis: ["E3", "E4"], since: 3 },
  { id: "R2", text: "The README and archived flag agree: the owners treat the project as finished.", basis: ["E7", "E8"], since: 4 },
];

export const UNKNOWN: readonly { text: string; since: number }[] = [
  { text: "No reason for the project going quiet was found in the evidence.", since: 3 },
  { text: "No statement from a maintainer was found.", since: 0 },
];

export const SHORTCUTS = ["Why did you die?", "What happened lately?", "What is still broken?"] as const;

/** The invented repository's code, for the demo's code viewer. Invented like everything else here. */
export const MOCK_CODE: Record<string, string> = {
  "src/notes.js": [
    "// A note is a line of text on a page.",
    "const pages = new Map();",
    "",
    "export function write(page, text) {",
    "  const notes = pages.get(page) ?? [];",
    "  notes.push({ text, at: Date.now() });",
    "  pages.set(page, notes);",
    "  return notes.length;",
    "}",
    "",
    "export function read(page) {",
    "  return pages.get(page) ?? [];",
    "}",
  ].join("\n"),
  "src/sync.js": [
    "import { read, write } from \"./notes.js\";",
    "",
    "// Two lanterns hold copies of the same page. When they disagree, the newer note wins.",
    "export function sync(local, remote, page) {",
    "  const mine = read(page);",
    "  const theirs = remote.read(page);",
    "  const newest = (a, b) => ((a.at ?? 0) >= (b.at ?? 0) ? a : b);",
    "  const merged = mine.map((note, i) => (theirs[i] ? newest(note, theirs[i]) : note));",
    "  for (const note of theirs.slice(mine.length)) write(page, note.text);",
    "  return merged;",
    "}",
  ].join("\n"),
  "README.md": ["# lantern-notes", "", "This project is unmaintained. Forks are welcome.", "", "Notes that two lanterns can share."].join("\n"),
};
/** What each invented file does (the demo's scripted reading) and the invented commit that last touched it. */
const MOCK_CODE_NOTES: Record<string, { reading: string; lastEra: number }> = {
  "src/notes.js": { reading: "These lines keep notes in memory, page by page, and hand them back when a page is read.", lastEra: 0 },
  "src/sync.js": { reading: "These lines merge two copies of a page and keep the newer note where they disagree.", lastEra: 2 },
  "README.md": { reading: "This file is the project's front page; it says the project is unmaintained.", lastEra: 4 },
};

/** A question about one of the invented files: quote it, read it, or say when it last changed. Never why. */
function mockCodeReply(question: string, path: string, eraIdx: number): ReplySegment[] {
  const note = MOCK_CODE_NOTES[path];
  const lines = MOCK_CODE[path].split("\n");
  const m = new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:(\\d+)(?:-(\\d+))?`).exec(question);
  const from = m ? Math.max(1, Number(m[1])) : 1;
  const to = m ? Math.min(lines.length, Number(m[2] ?? m[1])) : Math.min(lines.length, 3);
  const quoted = lines.slice(from - 1, to).find((l) => l.trim()) ?? lines[0];
  const last = ERAS[Math.min(note.lastEra, eraIdx)];
  if (/\bwhy\b/i.test(question)) {
    return [
      { kind: "record", text: `The last mock commit to touch ${path} is ${last.sha}: "${last.message}".`, cites: [last.evidenceId] },
      { kind: "unknown", text: "No mock commit message says why it was written this way.", cites: [] },
    ];
  }
  if (/\b(when|last change|which commit)\b/i.test(question)) {
    return [{ kind: "record", text: `${path} last changed in mock commit ${last.sha} (${last.date}): "${last.message}".`, cites: [last.evidenceId] }];
  }
  return [
    { kind: "record", text: `Line ${from} of ${path} reads: ${quoted.trim()}`, cites: [] },
    { kind: "reading", text: note.reading, cites: [] },
  ];
}

import type { Reply, ReplySegment } from "./data";
export type { Reply, ReplySegment, SegmentKind } from "./data";

const eraEvidence = (era: number) => EVIDENCE.filter((e) => e.since <= era);

/** Scripted reply from fixtures only, scoped to the selected era. No model is called. */
export function mockReply(question: string, eraIdx: number): Reply {
  const q = question.toLowerCase();
  const era = ERAS[eraIdx];
  const segments: ReplySegment[] = [];
  const visible = new Set(eraEvidence(eraIdx).map((e) => e.id));
  const has = (id: string) => visible.has(id);
  const codePath = Object.keys(MOCK_CODE).find((p) => question.includes(p));
  if (codePath) {
    segments.push(...mockCodeReply(question, codePath, eraIdx));
  } else if (/(who were you|made for|made to|what were you|purpose|begin|began|first|earliest|oldest)/.test(q)) {
    // who it was: its oldest mock commit, and the one after it if this era has reached it
    segments.push({ kind: "record", text: `My oldest mock commit is ${ERAS[0].sha} (${ERAS[0].date}): "${ERAS[0].message}".`, cites: [ERAS[0].evidenceId] });
    if (has("E2")) segments.push({ kind: "record", text: `Later came ${ERAS[1].sha}: "${ERAS[1].message}".`, cites: ["E2"] });
    segments.push({ kind: "unknown", text: "Who first wrote me, and why, is not in the evidence.", cites: [] });
  } else if (/(why|die|dead|archiv|abandon|status|unmaintain|stop)/.test(q)) {
    segments.push({ kind: "record", text: `At this era the latest mock commit is ${era.sha}, dated ${era.date}: "${era.message}".`, cites: [era.evidenceId] });
    if (has("E8")) segments.push({ kind: "record", text: "The mock repository is marked archived, and the README says it is unmaintained.", cites: ["E8", "E7"] });
    if (eraIdx >= 3) segments.push({ kind: "reading", text: "The recent commits are repairs and removals. That is a reading of the commits, not a stated reason.", cites: ["E3", "E4"].filter(has) });
    segments.push({ kind: "unknown", text: "No reason for the project going quiet was found in the evidence.", cites: [] });
  } else if (/(recent|lately|last|latest|commit|happen)/.test(q)) {
    segments.push({ kind: "record", text: `The newest mock commit at this era is ${era.sha} (${era.date}): "${era.message}".`, cites: [era.evidenceId] });
    if (eraIdx > 0) segments.push({ kind: "record", text: `Before it came ${ERAS[eraIdx - 1].sha}: "${ERAS[eraIdx - 1].message}".`, cites: [ERAS[eraIdx - 1].evidenceId] });
  } else if (/(broken|bug|issue|problem|complain)/.test(q)) {
    if (has("E6")) segments.push({ kind: "record", text: 'An issue titled "Sync loses notes when offline" is open in the mock data.', cites: ["E6"] });
    else segments.push({ kind: "unknown", text: "No issues exist in the evidence available at this era.", cites: [] });
  } else {
    segments.push({ kind: "unknown", text: "That is not something the evidence at this era can answer.", cites: [] });
  }
  segments.push({ kind: "ghost", text: era.ghostLine, cites: [] });
  const sources = [...new Set(segments.flatMap((s) => s.cites))];
  return { segments, sources };
}
