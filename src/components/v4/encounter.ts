import type { ReplySegment } from "./data";
import type { Game } from "./game-context";
import type { Form } from "./V4Ghost";

/**
 * The first encounter: an RPG opening in a few beats, then a choice menu. Scripted on purpose, so it is instant and
 * cannot fail: the ghost notices you (and how you came), speaks in its own voice, says one true thing about itself
 * (copied from its record, never glitched), and asks for help. The facts come from the game data, the rest is fiction.
 */

/** How the visitor came: followed a presence in the graveyard, typed the repository's name, or opened the page directly. */
export type Via = "graveyard" | "named" | "direct";
export const VIA_KEY = "gitghost.via";

/** The landing page writes this just before it navigates; the encounter reads it once. */
export function rememberVia(via: Exclude<Via, "direct">) {
  try {
    window.sessionStorage.setItem(VIA_KEY, via);
  } catch {
    /* optional: without it the ghost greets a direct visitor */
  }
}
/** Reads and clears how the visitor came. Call once per encounter, on the client. */
export function takeVia(): Via {
  try {
    const v = window.sessionStorage.getItem(VIA_KEY);
    window.sessionStorage.removeItem(VIA_KEY);
    if (v === "graveyard" || v === "named") return v;
  } catch {
    /* optional */
  }
  return "direct";
}

/** A ghost met earlier in this browser session skips its opening and goes straight to the choices. */
const metKey = (repo: string) => `gitghost.met.${repo}`;
export function alreadyMet(repo: string): boolean {
  try {
    return window.sessionStorage.getItem(metKey(repo)) === "1";
  } catch {
    return false;
  }
}
/**
 * This encounter's meeting, read once per repository on the client and then kept, so every render (and React's
 * development double-render) sees the same answer. For `useSyncExternalStore`: nothing here changes later.
 */
export type Meeting = { via: Via; met: boolean };
const meetings = new Map<string, Meeting>();
export function meetingFor(repo: string): Meeting {
  let m = meetings.get(repo);
  if (!m) meetings.set(repo, (m = { via: takeVia(), met: alreadyMet(repo) }));
  return m;
}
export const resetMeetingsForTests = () => meetings.clear();

export function markMet(repo: string) {
  try {
    window.sessionStorage.setItem(metKey(repo), "1");
  } catch {
    /* optional */
  }
}

const NOTICE: Record<Via, Record<Form, string>> = {
  graveyard: {
    human: "Oh. You followed my light all the way out here, between the graves.",
    distorted: "You followed the light. The light. Nobody follows the light any more.",
    horror: "Small light. You walked between the graves to find us.",
  },
  named: {
    human: "You said my name. Nobody has said my name in a long, long time.",
    distorted: "My name. You said my name. Say it again. Again.",
    horror: "A name was spoken. Our name. We heard it from very far down.",
  },
  direct: {
    human: "Oh. Someone is here. Come in, come in.",
    distorted: "Someone is… someone is here.",
    horror: "Something living stands in the dark with us.",
  },
};
/** A ghost that can only repeat (the Bellwraith) has no words of its own once changed. */
const TOLL: Record<Via, string> = { graveyard: "Dong. Dong. Dong.", named: "Dong… dong… dong.", direct: "Dong." };

/** The last beat: an invitation to what the ghost can do (tell what it was, show what it is made of). */
const INVITE: Record<Form, string> = {
  human: "Stay a while, if you like. Ask me anything about what I was, or what I am made of.",
  distorted: "Stay. Stay a while. Ask me… ask me what I was. What I am made of.",
  horror: "Ask, small reader. Ask what we were. Ask what we are made of.",
};

/** The description without GitHub emoji codes (":atom: The hackable text editor" gives "The hackable text editor"). */
export function plainDescription(text: string | null): string {
  return (text ?? "").replace(/:[a-z0-9_+-]+:/gi, "").replace(/\s+/g, " ").trim().replace(/[.!]$/, "");
}

const seg = (kind: ReplySegment["kind"], text: string, cites: string[] = []): ReplySegment => ({ kind, text, cites });

/** The status label without the retrieval note ("Archived. Retrieved 2026-11-02." gives "Archived"). */
const statusOf = (line: string) => line.split(/\.\s+Retrieved\b/)[0].replace(/\.$/, "");

/** The opening beats, one dialogue box each. */
export function encounterBeats(g: Game, form: Form, via: Via, ghostLine: string): ReplySegment[][] {
  const echo = g.sprite === "bellwraith" && form !== "human";
  // the demo's repository is invented, so only a live one may say "GitHub"
  const who = g.mode === "live" ? "GitHub" : "My record";
  // GitHub descriptions may carry emoji codes (":atom: The hackable text editor"); they are dropped, the words kept
  const described = plainDescription(g.repo.description);
  const record = `${described ? `${who} describes me as “${described}”. ` : ""}Status: ${statusOf(g.statusLine)}.`;
  const beats = [
    [seg("ghost", echo ? TOLL[via] : NOTICE[via][form])],
    [seg("ghost", ghostLine)],
    [seg("record", record)],
    [seg("ghost", echo ? "Ask… ask… ask." : INVITE[form])],
  ];
  return beats.filter((b) => b[0].text.trim());
}

/** Menu lines: the opening's, and while its code is open, the questions about the code in front of the visitor. */
export type Choice = { id: "who" | "what" | "body" | "other" | "code-what" | "code-why" | "code-when" | "code-specialist" | "code-record" | "leave"; label: string };
export const CHOICES: Choice[] = [
  // Each question carries a word ("project", "development", "commits") that makes the server answer with cited facts, not fiction.
  { id: "who", label: "Who were you? What was this project made for?" },
  { id: "what", label: "What happened to you? Why did development stop?" },
  { id: "body", label: "Show me your code." },
  { id: "other", label: "Say something else…" },
];

const BODY: Record<Form, string> = {
  human: "My code? Nobody has asked to see it in years. Here, this is what I am made of. Choose a page and point at a line.",
  distorted: "My… my insides. Look, then. Look. Choose a page. Point at the line that hurts.",
  horror: "You wish to see what we are made of. Look, small reader. Choose. Point.",
};
/** A living repository is asked about its present, not its death (see domain/status.ts). */
const ALIVE_CHOICES: Choice[] = [
  { id: "who", label: "Who are you? What is this project made for?" },
  { id: "what", label: "What are you working on lately? What changed in recent commits?" },
  ...CHOICES.slice(2),
];
export const choicesFor = (vitality: "alive" | "dead"): Choice[] => (vitality === "alive" ? ALIVE_CHOICES : CHOICES);

/** The ghost's first words when the visitor opens its code. */
export function bodyReply(form: Form): ReplySegment[] {
  return [seg("ghost", BODY[form])];
}

