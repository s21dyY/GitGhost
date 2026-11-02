/**
 * Deterministic question-intent classification. Used only to decide WHICH bounded GitHub evidence
 * to fetch; it never decides what is true. Unknown questions fall back to "general".
 */
export type Intent = "status" | "recent" | "history" | "issues" | "general" | "file" | "compare";

/**
 * Two moments of the repository to compare. A moment is resolved to a real commit on the server:
 *   before   the last commit before an instant ("2016" starts at 2016-01-01)
 *   now      the newest commit
 *   era      the era the visitor is looking at (the commit they chose in the Memory Journal)
 *   beginning the earliest commit GitHub lists
 */
export type Moment = { kind: "before"; iso: string } | { kind: "now" } | { kind: "era" } | { kind: "beginning" };
export type CompareSpec = { from: Moment; to: Moment; phrase: string };

const YEAR = "((?:19|20)\\d{2})";
const startOf = (y: number) => ({ kind: "before" as const, iso: `${y}-01-01T00:00:00Z` });
const sane = (y: number, now: number) => y >= 1990 && y <= now + 1;

/**
 * "What changed between 2016 and 2019?", "from 2015 to 2018", "since 2018", "in the last 2 years",
 * "since then" (from the era being viewed), "over the years" / "since the beginning". Anything else: null.
 */
export function detectCompare(question: string, now = new Date()): CompareSpec | null {
  const q = question.toLowerCase();
  const thisYear = now.getUTCFullYear();
  const range = new RegExp(`\\b(?:between|from)\\s+(?:the\\s+)?${YEAR}\\s+(?:and|to|until|through|&)\\s+(?:the\\s+)?${YEAR}\\b`).exec(q);
  if (range) {
    let [a, b] = [Number(range[1]), Number(range[2])];
    if (a > b) [a, b] = [b, a];
    if (sane(a, thisYear) && sane(b, thisYear)) return { from: startOf(a), to: b >= thisYear ? { kind: "now" } : startOf(b + 1), phrase: `${a} to ${b}` };
  }
  const since = new RegExp(`\\bsince\\s+${YEAR}\\b`).exec(q);
  if (since && sane(Number(since[1]), thisYear)) return { from: startOf(Number(since[1])), to: { kind: "now" }, phrase: `since ${since[1]}` };
  const last = /\b(?:in|over|during)\s+the\s+(?:last|past)\s+(?:(\d{1,2})\s+)?years?\b/.exec(q);
  if (last) {
    const n = Math.min(30, Math.max(1, Number(last[1] ?? 1)));
    const t = new Date(now.getTime() - n * 365.25 * 86_400_000).toISOString();
    return { from: { kind: "before", iso: t }, to: { kind: "now" }, phrase: `the last ${n === 1 ? "year" : `${n} years`}` };
  }
  if (/\b(?:since\s+(?:then|that\s+(?:time|era|commit|day))|between\s+then\s+and\s+now|since\s+this\s+era)\b/.test(q)) return { from: { kind: "era" }, to: { kind: "now" }, phrase: "since then" };
  if (/\b(?:since\s+(?:the\s+(?:beginning|start)|you\s+began|your\s+first\s+commit)|over\s+the\s+years|how\s+(?:have|did)\s+you\s+change)\b/.test(q)) return { from: { kind: "beginning" }, to: { kind: "now" }, phrase: "since the beginning" };
  return null;
}

/**
 * A file (and optionally a line or a range) named in a question: "why does lib/retry.js wait so long?",
 * "src/api.ts:42", "server.py#L10-L20", "line 42 of index.js". The path is checked so it can only ever name
 * a file inside the repository: no "..", no leading slash, no URL, a sane length and a code-like extension.
 */
export type FileRef = { path: string; line?: number; endLine?: number };

const EXT = "js|mjs|cjs|jsx|ts|tsx|py|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|swift|m|mm|scala|sh|bash|zsh|ps1|yml|yaml|json|toml|ini|cfg|conf|md|rst|txt|css|scss|sass|less|html|htm|vue|svelte|sql|lua|pl|pm|r|dart|ex|exs|erl|hrl|hs|ml|clj|cljs|groovy|gradle|xml|proto|graphql|tf|lock|coffee|el|vim|nix|zig|jl|asm|s";
const PATH_RE = new RegExp(`(?:^|[\\s\`'"(\\[])((?:[\\w@+-][\\w.@+-]*/)*[\\w@+-][\\w.@+-]*\\.(?:${EXT}))(?::(\\d{1,6})(?:-(\\d{1,6}))?|#L(\\d{1,6})(?:-L?(\\d{1,6}))?)?(?=$|[\\s\`'"),?!:;\\].])`, "i");
const LINE_RE = /\blines?\s+(\d{1,6})(?:\s*(?:-|–|to|through)\s*(\d{1,6}))?/i;
/** Library names that look like files: "Node.js" is a runtime, not a file in this repository. */
const NOT_A_FILE = /^(node|vue|next|nuxt|react|d3|three|express|ember|backbone|angular|chart|moment|lodash|underscore|jquery|p5|socket|alpine|solid|svelte|deno|bun)\.js$/i;

export function detectFileRef(question: string): FileRef | null {
  const m = PATH_RE.exec(question);
  if (!m) return null;
  const path = m[1].replace(/^\.\//, "");
  if (path.length > 300 || path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return null;
  if (!path.includes("/") && NOT_A_FILE.test(path)) return null;
  const n = (s?: string) => (s ? Number(s) : undefined);
  const lm = LINE_RE.exec(question);
  let line = n(m[2] ?? m[4]) ?? n(lm?.[1]);
  let endLine = n(m[3] ?? m[5]) ?? n(lm?.[2]);
  if (line !== undefined && (line < 1 || line > 200_000)) line = undefined;
  if (line === undefined || endLine === undefined || endLine < line || endLine - line > 400) endLine = undefined;
  return { path, ...(line !== undefined ? { line } : {}), ...(endLine !== undefined ? { endLine } : {}) };
}

const RULES: [Intent, RegExp][] = [
  ["status", /\b(die[ds]?|dead|death|archiv\w*|abandon\w*|deprecat\w*|sunset\w*|unmaintained|maintained|maintenance|inactive|stopp?ed|end(ed)? of life|shut ?down|killed|why .*(quiet|silent|stop))\b/i],
  ["history", /\b(begin|began|beginning|start(ed)?|origin\w*|born|birth|first|early|created|founded|history|long ago)\b/i],
  ["issues", /\b(bugs?|issues?|problems?|complain\w*|broken|requests?|feature|pain|annoy\w*|discuss\w*)\b/i],
  ["recent", /\b(recent\w*|lately|happen\w*|latest|newest|last (commit|change|update|release)|changed|changes|activity|working on|up to|these days|now)\b/i],
];

const FOLLOW_UP = /^(and|so|then|what about|tell me more|more|go on|continue|anything else|what else|why|how so|and then)\b[\s\S]{0,40}$/i;

export function classifyIntent(question: string): Intent {
  // naming a file wins: "why did lib/retry.js stop retrying" is about that file, not about the project dying
  if (detectFileRef(question)) return "file";
  // two moments named: a comparison ("what changed between 2016 and 2019?", "since then")
  if (detectCompare(question)) return "compare";
  for (const [intent, re] of RULES) if (re.test(question)) return intent;
  return "general";
}

export function isFollowUp(question: string): boolean {
  const q = question.trim();
  return q.length <= 60 && FOLLOW_UP.test(q) && classifyIntent(q) === "general";
}

/** Intent for this turn, carrying the topic over for short follow-ups like "tell me more". */
export function intentForTurn(question: string, previousUserQuestions: readonly string[]): Intent {
  const own = classifyIntent(question);
  if (own !== "general" || !isFollowUp(question)) return own;
  for (let i = previousUserQuestions.length - 1; i >= 0; i--) {
    const prior = classifyIntent(previousUserQuestions[i]);
    if (prior !== "general") return prior;
  }
  return "general";
}

/** Words that suggest a maintainer-style status notice. Used to rank evidence, never as proof. */
export const STATUS_NOTICE_RE = /\b(sunset\w*|deprecat\w*|archiv\w*|no longer (maintain\w*|develop\w*|support\w*)|end of life|unmaintained|discontinu\w*|shut ?down|abandon\w*|replac\w*|successor|read-only|wind(ing)? down)\b/i;
