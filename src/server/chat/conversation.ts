/**
 * Conversational intent of one visitor turn (V6.3). Deterministic and cheap: no model call.
 *
 *  - character: talk to the ghost as a character ("Are you lonely?", "Tell me a scary story"). Fiction is welcome.
 *  - factual:   a question about the real repository ("When was the first commit?"). Every claim needs evidence.
 *  - mixed:     feeling about repository history ("How did you feel when development stopped?").
 *
 * This only shapes the prompt, the sampling temperature and whether the server adds an uncertainty line.
 * It NEVER decides what is true: factual claims are validated claim by claim in grounding.ts whatever the turn kind.
 */
export type TurnKind = "character" | "factual" | "mixed";

const FACT_CUE =
  /\b(commits?|issues?|pull requests?|prs?|readme|releases?|versions?|tags?|branch(?:es)?|merg\w+|maintain\w*|contributors?|creators?|authors?|developers?|devs?|owners?|team|archiv\w*|deprecat\w*|abandon\w*|unmaintained|sunset\w*|die[ds]?|dead|death|stopp?ed|ended|shut ?down|killed|inactive|stars?|forks?|licen[sc]e|history|development|repo(?:sitory)?|project|codebase|source code|dependenc\w+|bugs?|changelog)\b|#\d/i;
const EMOTION_CUE =
  /\b(feel|felt|feeling|lonely|alone|afraid|scared|fear\w*|miss(?:ed)?|love[ds]?|hate[ds]?|happy|happiest|sad(?:dest)?|saddest|angry|dream\w*|remember\w*|forgive\w*|hurt\w*|cry|crying|haunt\w*|proud|regret\w*|grie\w*|mourn\w*|favou?rite|worst|best)\b/i;
/** Fact cues that stay factual even next to a feeling word: they ask for a concrete record. */
const RECORD_ASK = /(\b(when|who|what happened|how many|which)\b[^?]{0,60}\b(commit|issue|release|version|archiv\w*|maintain\w*|merge|tag)\w*|#\d|\bwhy\b[^?]{0,40}\barchiv\w*)/i;

export function classifyTurn(question: string): TurnKind {
  const q = question.trim();
  const fact = FACT_CUE.test(q);
  const emotion = EMOTION_CUE.test(q);
  if (!fact) return "character";
  if (emotion && !RECORD_ASK.test(q)) return "mixed";
  return "factual";
}

/** Sampling temperature per turn kind. Factual turns keep the provider's low default. */
export function temperatureFor(kind: TurnKind): number | undefined {
  return kind === "character" ? 0.8 : kind === "mixed" ? 0.6 : undefined;
}
