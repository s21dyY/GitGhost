/**
 * Deterministic question-intent classification. Used only to decide WHICH bounded GitHub evidence
 * to fetch; it never decides what is true. Unknown questions fall back to "general".
 */
export type Intent = "status" | "recent" | "history" | "issues" | "general";

const RULES: [Intent, RegExp][] = [
  ["status", /\b(die[ds]?|dead|death|archiv\w*|abandon\w*|deprecat\w*|sunset\w*|unmaintained|maintained|maintenance|inactive|stopp?ed|end(ed)? of life|shut ?down|killed|why .*(quiet|silent|stop))\b/i],
  ["history", /\b(begin|began|beginning|start(ed)?|origin\w*|born|birth|first|early|created|founded|history|long ago)\b/i],
  ["issues", /\b(bugs?|issues?|problems?|complain\w*|broken|requests?|feature|pain|annoy\w*|discuss\w*)\b/i],
  ["recent", /\b(recent\w*|lately|happen\w*|latest|newest|last (commit|change|update|release)|changed|changes|activity|working on|up to|these days|now)\b/i],
];

const FOLLOW_UP = /^(and|so|then|what about|tell me more|more|go on|continue|anything else|what else|why|how so|and then)\b[\s\S]{0,40}$/i;

export function classifyIntent(question: string): Intent {
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
