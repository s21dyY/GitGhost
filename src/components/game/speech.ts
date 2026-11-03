/**
 * Broken speech for the ghost's own voice. Deterministic: the same line always breaks the same way, so
 * tests and screenshots are stable. It is applied ONLY to fictional ghost lines. Facts, readings and gaps
 * are never touched, and the original text is always kept as the plain-text version for assistive tech.
 */
export type Fragmented = {
  /** What is drawn: stutters and pauses added. */
  visual: string;
  /** Extra milliseconds to wait after revealing the character at the same index in `visual`. */
  holds: number[];
  /** The unbroken sentence, for screen readers. */
  plain: string;
};

function hash(text: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export function fragment(text: string, seed = 0, intensity = 1): Fragmented {
  const r = rng(hash(text, seed));
  const words = text.split(" ");
  let stutters = 0;
  const out = words.map((w, i) => {
    const letter = /^[A-Za-z]/.test(w);
    if (i > 0 && letter && w.length >= 3 && stutters < 2 && r() < 0.16 * intensity) {
      stutters++;
      return `${w[0]}-${w}`;
    }
    return w;
  });
  let visual = out.join(" ");
  // a sentence now and then trails off instead of ending
  if (intensity > 0 && /\.\s/.test(visual) && r() < 0.35 * intensity) visual = visual.replace(/\.\s/, "… ");
  // a long line loses its place once
  if (visual.length > 70 && !visual.includes("…") && r() < 0.5 * intensity) {
    const at = visual.indexOf(" ", Math.floor(visual.length * 0.45));
    if (at > 0) visual = `${visual.slice(0, at).replace(/[.,;:!?]+$/, "")}… ${visual.slice(at + 1)}`;
  }
  const holds = Array.from({ length: visual.length }, (_, i) => {
    const ch = visual[i];
    if (ch === "…") return 520;
    if (ch === "." || ch === "?") return 340;
    if (ch === "," || ch === "—") return 220;
    if (ch === "-" && /[A-Za-z]/.test(visual[i - 1] ?? "") && /[A-Za-z]/.test(visual[i + 1] ?? "") && visual[i - 2] === " ") return 160;
    return 0;
  });
  return { visual, holds, plain: text };
}
