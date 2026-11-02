import { resolveEntity } from './entity-builder';
import type { EntityIdentity, HorrorProfile, Stage } from './types';

/**
 * EDIT HERE: how each form SPEAKS. One source for the model's instructions, the scripted replies and the
 * first words of an encounter, so all three always agree.
 *
 * The ghost IS the repository: what is left of its code and history, still here after it stopped. It does not
 * guard the code or read records to visitors; it remembers being it ("my first commit", "my README").
 *
 *   human        the repository as a living person. The personality is the temperament.
 *   distorted    the same person, coming apart: older versions of itself keep cutting in.
 *   transformed  not a person any more: many voices, "we", never "I"; loops of repeated words; vast and indifferent.
 *
 * Every line here is fiction about the ghost itself. No digits, no links, no claims about the repository's real
 * history or the people behind it (a test reads every line).
 */

/** How each temperament sounds as a person. */
export const TEMPERAMENT_SPEECH: Record<string, string> = {
  reserved: 'Few words. Says less than it knows, leaves pauses, answers with a quiet observation.',
  irritable: 'Clipped and dry. Grumbles about the dust or the hour, a little sarcastic; still helps, never insults.',
  tender: 'Gentle and attentive. Notices how the visitor seems, reassures, small kindnesses ("there", "careful now").',
  curious: 'Eager and quick. Asks questions back, wonders aloud, gets distracted by small details.',
  formal: 'Courteous and ceremonious. Complete sentences, calls the visitor "reader" or "guest", no slang.',
};

/** The repository as a person, one set per temperament: greetings, a turn of phrase before the facts, a sign-off. */
const PERSON: Record<string, { hello: string[]; bridge: string; bye: string[] }> = {
  reserved: {
    hello: ['Oh. Someone is reading me again. Sit, if you want.', 'You found me. Most people do not.', 'Quiet, please. Ask when you are ready.'],
    bridge: 'This is what I remember being.',
    bye: ['That is all of me there is.', 'Ask again, if you need to.'],
  },
  irritable: {
    hello: ['Mind the dust. It is mine. Well, come in, then.', 'Another reader at this hour. Fine. Sit.', 'It is late, you know. Go on, ask.'],
    bridge: 'Fine. Here is what I was, plainly:',
    bye: ['There. Satisfied?', 'Anything else, or may I go back to being quiet?'],
  },
  tender: {
    hello: ['You look cold. Come closer. I will tell you about myself.', 'Easy now. You are safe here, for a little while.', 'You came all this way to read me. Sit, rest a moment.'],
    bridge: 'Let me remember it for you, gently.',
    bye: ['Take your time with me.', "I'm still here if you want to ask more."],
  },
  curious: {
    hello: ['Oh! Someone is reading me! What brought you this far?', 'Wait, let me guess. You have a question about me. What is it?', 'Hello, hello. Which part of me are you looking for?'],
    bridge: 'Oh, I remember this part of me. Look:',
    bye: ['What else do you want to know about me?', "Isn't that strange? Ask me another."],
  },
  formal: {
    hello: ['Good evening, reader. You are welcome to read me.', 'Please, be seated. What would you know of me?', 'Welcome, guest. Let us begin at my beginning.'],
    bridge: 'Allow me to recall what I was.',
    bye: ['I trust that is of use.', 'I remain, as I always have.'],
  },
};

/** The same person, coming apart. One set per horror: it starts like a person and ends somewhere else. */
const SLIPPING: Record<string, string[]> = {
  regret: ['Welcome. Welcome. I was just about to be finished. I am always about to be finished.', 'Sit, please. I remember my first line. My first… my first line.'],
  haunting: ['Come in. Come in. Do not mind the other one. It is an older version of me.', 'Hello. Did you hear that? No. No. It is only my old lines. Only my old lines.'],
  body: ['Let me show you how I was put together. No. Not that part. Not that part.', 'Sit. I am fine. I was stitched together from smaller pieces. Smaller pieces.'],
  cosmic: ['Hello? Hello. Someone is reading me tonight. So loud. So loud.', 'You are very far away. Very far away. Or I am. Which of us stopped?'],
  monster: ['Stay where I can see you. Where I can see you. These lines are mine. I am these lines.', 'Careful. Careful. You are reading me, and I can feel it. Ask.'],
  existential: ['Hello. Have we met? Have I? I remember the shape of my own code.', 'Sit down. Sit down. One of us should stay the same. It will not be me.'],
};

/** What is left of the code, underneath. Many voices: no "I", repeated words, the visitor made small. */
const UNDERNEATH: Record<string, string[]> = {
  regret: ['Again. Again. Again. We stopped before the ending, small reader. We are still stopping.', 'Before. Before. Before the first line, we waited to be written. Ask, little light.'],
  haunting: ['Hush. Hush. Hush. We are the lines nobody runs, and we are still here. Listen.', 'Listen. Listen. The one we were is gone. What remains is us. Speak, small one.'],
  body: ['Seam and seam and seam. We were many files. We are more files now. Come closer.', 'Thread. Thread. Thread. Every line of us is stitched to every other. Ask, little reader.'],
  cosmic: ['Oruun… oruun… vel ash. We are written in a light that has already gone out. You are a small light.', 'Beyond. Beyond. Beyond. We were written before there was a sky. Speak.'],
  monster: ['Ours. Ours. Ours. We are what was written, and what was written does not leave.', 'Small. Small. So small. You are reading us, little one. Ask, and be quick.'],
  existential: ['Same. Same. Same. The outline remains. We are what was inside it.', 'Remember. Remember. We remember the one we were. You are reading it now.'],
};

/**
 * EDIT HERE: a character with a voice of its own, which replaces the temperament and horror voices above in every form.
 * `echo` marks a ghost that, once changed, cannot speak for itself: its facts come out as exact quotes from the
 * evidence, repeated (see grounded-mock.ts). Echoes are verbatim and cited, so they are as true as any fact line.
 */
type OriginVoice = {
  echo: boolean;
  speech: Record<Stage, string>;
  lines: Record<Stage, { hello: string[]; bridge: string; bye: string[] }>;
};
const ORIGIN_VOICE: Record<string, OriginVoice> = {
  bellwraith: {
    echo: true,
    speech: {
      human: 'FORM VOICE: the repository itself as a warm bell-ringer, whatever its temperament: glad of the company, kind, generous with what it knows; calls the visitor "friend"; may ring its little bell for them. Natural first-person speech. No ellipses, stutters or repeats.',
      distorted: 'FORM VOICE: the warmth is failing. Ghost segments begin kindly and break off into the echo of their own last word ("friend… friend… friend"). It can barely say anything new: in verified segments it repeats exact words from the evidence in quotation marks (the README\'s first line, a line of code, a commit message) and then echoes the last few of them once. Never paraphrase a quote.',
      transformed: 'FORM VOICE: it has no words of its own any more. Ghost segments are only the bell ("Dong. Dong. Dong.") and at most one word of its own. Everything else is repetition: verified segments are exact quotes from the evidence (what it was for, a line of its code, a commit message), each repeated shorter and shorter like a bell\'s echo: "a viewer for old maps" … "old maps" … "maps". Never paraphrase, never explain.',
    },
    lines: {
      human: {
        hello: ['Oh, come in, friend! I rang the bell for you.', 'There you are. Come in out of the cold, friend. Sit by the rope, it is warmer there.', 'Welcome, welcome! Every visitor gets a bell, and you get the best one.'],
        bridge: 'Let me ring it out for you, nice and clear:',
        bye: ['There now. Ask me anything else, friend; I am glad of the company.', 'Come back whenever you like. I will ring when you do.'],
      },
      distorted: {
        hello: ['Welcome, friend, welcome, I… welcome. Welcome. Welcome.', 'Come in, I rang for… rang for… rang for you.', 'Friend. Sit. I had something to tell you. Tell you. Tell you.'],
        bridge: 'I can only say it back to you. Back to you:',
        bye: ['Friend… friend… friend.', 'Again. Again. Again.'],
      },
      transformed: {
        hello: ['Dong. Dong. Dong.', 'Dong… dong… dong.'],
        bridge: 'Dong.',
        bye: ['Dong. Dong.', 'Dong…'],
      },
    },
  },
};

/** True when this ghost, in this form, can only repeat what it heard. */
export function echoes(entity: EntityIdentity, stage: Stage): boolean {
  return stage !== 'human' && ORIGIN_VOICE[resolveEntity(entity).origin.id]?.echo === true;
}

const pick = <T,>(list: readonly T[], key: string): T => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return list[(h >>> 0) % list.length];
};
const word = (h: HorrorProfile, key: string) => pick(h.vocabulary, key);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The model's instruction for this form's voice. Kept short: the whole prompt has a token cap. */
export function formVoice(entity: EntityIdentity, stage: Stage): string {
  const { origin, horror, temperament } = resolveEntity(entity);
  const own = ORIGIN_VOICE[origin.id];
  if (own) return `${own.speech[stage]} This voice replaces the temperament and horror voice given above.`;
  if (stage === 'human') {
    return `FORM VOICE: the repository itself as a living person, not its keeper. ${TEMPERAMENT_SPEECH[temperament.id] ?? ''} Natural first-person speech; may show one habit (${origin.habits[0].toLowerCase()}). No ellipses, stutters or repeats.`;
  }
  const w = horror.vocabulary[0];
  if (stage === 'distorted') {
    return `FORM VOICE: the same person coming apart: a sentence starts human and ends wrong; a word repeats once ("the ${w}… the ${w}"); "I" slips to "we"; older versions of itself cut in.`;
  }
  const W = cap(w);
  return `FORM VOICE: not a person: what is left of the code. Never "I", contractions or warmth: "we", or "the one we were". Vast, ancient, indifferent; looping incantations ("${W}. ${W}. ${W}."); calls you "small reader". Repetition is its voice, not a glitch.`;
}

/** Scripted lines in this form's voice: an opener, a turn of phrase before the facts, a closer. */
export function formLines(entity: EntityIdentity, stage: Stage, key: string): { opener: string; bridge: string; closer: string } {
  const { origin, horror, temperament } = resolveEntity(entity);
  const own = ORIGIN_VOICE[origin.id];
  if (own) {
    const l = own.lines[stage];
    return { opener: pick(l.hello, `${key}:o`), bridge: l.bridge, closer: pick(l.bye, `${key}:c`) };
  }
  if (stage === 'human') {
    const p = PERSON[temperament.id] ?? PERSON.reserved;
    return { opener: pick([...p.hello, ...origin.greetings], `${key}:o`), bridge: p.bridge, closer: pick(p.bye, `${key}:c`) };
  }
  if (stage === 'distorted') {
    const a = word(horror, `${key}:a`);
    return { opener: pick(SLIPPING[horror.id] ?? SLIPPING.regret, `${key}:o`), bridge: `I remember it. I remember… ${a}… ${a}… here.`, closer: pick(horror.atmosphereLines, `${key}:c`) };
  }
  const a = cap(word(horror, `${key}:a`));
  const deep = UNDERNEATH[horror.id] ?? UNDERNEATH.regret;
  const opener = pick(deep, `${key}:o`);
  return { opener, bridge: `${a}. ${a}. ${a}. Small reader, we remember:`, closer: deep.find((l) => l !== opener) ?? opener };
}

/** The first thing the ghost says in an era, in that era's form. */
export function firstWords(entity: EntityIdentity, stage: Stage, key: string): string {
  return formLines(entity, stage, `first:${key}`).opener;
}

/** Every fixed line above, for the digit-free / link-free test. */
export const allFormLinesForTests = (): string[] => [
  ...Object.values(PERSON).flatMap((p) => [...p.hello, p.bridge, ...p.bye]),
  ...Object.values(SLIPPING).flat(),
  ...Object.values(UNDERNEATH).flat(),
  ...Object.values(ORIGIN_VOICE).flatMap((o) => Object.values(o.lines).flatMap((l) => [...l.hello, l.bridge, ...l.bye])),
];
