import type { EraData, Stage } from "./data";
import type { Emotion, Tone } from "./fixtures";

/**
 * How the ghost LOOKS in each era. A narrative convention, not evidence: nothing about a repository's
 * activity or health is inferred from it, and the interface says so.
 *
 * Rule (deterministic, from the commit's position in the timeline and its own id only):
 *  - Fewer than three commits: no progression. Every era shows the saved form.
 *  - Otherwise p = index / (count - 1):  p < 0.4 human,  p < 0.8 distorted,  else the SAVED form.
 *  - So the latest era always shows the saved form, and the first era is always human.
 *  - The expression is picked from a short list for that form by hashing the commit id.
 */
export type SavedStage = "distorted" | "transformed";

const EXPRESSIONS: Record<Stage, Emotion[]> = {
  human: ["neutral", "amused", "melancholy"],
  distorted: ["melancholy", "disturbed", "angry", "neutral"],
  transformed: ["eldritch", "disturbed", "angry"],
};

const GHOST_LINES: Record<Stage, string[]> = {
  human: [
    "Ah. A reader. Sit. The pages are still warm.",
    "You came to ask. Good. Ask slowly, and I will answer slowly.",
    "I remember the sound of the lamp being trimmed.",
  ],
  distorted: [
    "Something is wrong with the margins. Do you see it too?",
    "I am not sure which version of the room I am standing in.",
    "Ask. I will tell you what the pages still hold.",
  ],
  transformed: [
    "The signal arrived. The reader did not. Ask what you came to ask.",
    "It is listening too. Speak plainly.",
    "I have been a long time between the lines. Ask.",
  ],
};

export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function stageFor(index: number, count: number, saved: SavedStage): Stage {
  if (count < 3) return saved;
  const p = index / (count - 1);
  if (p < 0.4) return "human";
  if (p < 0.8) return "distorted";
  return saved;
}

const toneFor = (stage: Stage, index: number, count: number): Tone => (stage === "human" ? "warm" : stage === "distorted" ? (index / Math.max(1, count - 1) < 0.6 ? "dim" : "cold") : "blood");

export type PresentationEra = Pick<EraData, "stage" | "emotion" | "tone" | "ghostLine">;

export function presentationFor(ids: readonly string[], saved: SavedStage): PresentationEra[] {
  return ids.map((id, i) => {
    const stage = stageFor(i, ids.length, saved);
    const h = hashString(id);
    return {
      stage,
      emotion: EXPRESSIONS[stage][h % EXPRESSIONS[stage].length],
      tone: toneFor(stage, i, ids.length),
      ghostLine: GHOST_LINES[stage][(h >>> 8) % GHOST_LINES[stage].length],
    };
  });
}
