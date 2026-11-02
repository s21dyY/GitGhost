import { HORRORS, HUMANS, allFormLinesForTests, formLines, type EntityIdentity, type Stage } from "@/config/entities";
import { identityFromAssignment, type EntityAssignment } from "@/domain/entity";
import { resolveEntity } from "@/config/entities";

export type Voice = "human" | "horror";

const NOSTALGIC_OPENERS = [
  "I remember how these pages felt when they were new.",
  "Those were careful years. Let me tell you what the record shows.",
  "Sit with me a moment. I will go through it slowly.",
];
const NOSTALGIC_CLOSERS = [
  "That is as much as the record tells me.",
  "Ask me anything else you would like to know.",
];

function pickIndex(key: string, n: number): number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return (h >>> 0) % n;
}

/**
 * Atmosphere lines taken from the entity config. They carry no digits and no links, so they pass
 * the "ghost segments make no factual claims" rule by construction (a test checks every voice).
 */
export function voiceLines(assignment: EntityAssignment, voice: Voice, salt: string, stage?: Stage) {
  const identity: EntityIdentity = identityFromAssignment(assignment);
  // With a known form, speak in that form's own voice (config/entities/voices.ts): the person's personality,
  // the person slipping, or the thing underneath. Without one, the older two-voice lines below.
  if (stage) return formLines(identity, voice === "human" ? "human" : stage, `${assignment.seed}:${salt}`);
  const { origin, horror } = resolveEntity(identity);
  const key = `${assignment.seed}:${salt}`;
  if (voice === "human") {
    const greetings = [...origin.greetings, ...NOSTALGIC_OPENERS];
    return {
      opener: greetings[pickIndex(`${key}:o`, greetings.length)],
      bridge: "I will read it plainly.",
      closer: NOSTALGIC_CLOSERS[pickIndex(`${key}:c`, NOSTALGIC_CLOSERS.length)],
    };
  }
  const v = horror.vocabulary;
  const a = v[pickIndex(`${key}:a`, v.length)];
  const b = v[pickIndex(`${key}:b`, v.length)];
  const lines = horror.atmosphereLines;
  return {
    opener: lines[pickIndex(`${key}:o`, lines.length)],
    bridge: a === b ? `${a}… ${a}… here.` : `${a}… ${b}… this remains:`,
    closer: lines[pickIndex(`${key}:c`, lines.length)],
  };
}

export const allVoiceLinesForTests = () =>
  HORRORS.flatMap((h) => [...h.atmosphereLines]).concat(HUMANS.flatMap((o) => [...o.greetings]), NOSTALGIC_OPENERS, NOSTALGIC_CLOSERS, allFormLinesForTests());
