"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TRANSFORM_FRAMES, type Frame } from "./V4Ghost";

/**
 * Plays a short list of frames on the ghost. Interruptible: starting a new sequence (or calling cancel)
 * clears the old timers, so a stale step can never land. Under reduced motion every sequence resolves
 * at once to its final frame (null = back to the resting pose), so nothing is lost but the movement.
 */
export type Step = { frame: Frame | null; ms: number; freeze?: boolean };
export type Playing = { frame: Frame | null; freeze: boolean; name: string } | null;

/** Animation 2: a sudden flinch, then the unnatural freeze, then a small snap back. */
export const TWITCH: Step[] = [
  { frame: { kind: "atlas", state: "twitchA" }, ms: 90 },
  { frame: { kind: "atlas", state: "twitchB" }, ms: 70 },
  { frame: { kind: "atlas", state: "twitchA" }, ms: 60 },
  { frame: { kind: "atlas", state: "twitchB" }, ms: 110 },
  { frame: { kind: "atlas", state: "freeze" }, ms: 1500, freeze: true },
  { frame: { kind: "atlas", state: "twitchB" }, ms: 80 },
  { frame: null, ms: 0 },
];

/** Animation 3: the transformation. `from` and `to` are indexes into the morph strip; they may run backwards. */
export function transformSteps(from: number, to: number): Step[] {
  const dir = to >= from ? 1 : -1;
  const steps: Step[] = [];
  for (let i = from; i !== to + dir; i += dir) steps.push({ frame: { kind: "transform", index: i }, ms: TRANSFORM_FRAMES[i].ms });
  steps.push({ frame: null, ms: 0 });
  return steps;
}
/** Index of the morph frame whose t is closest to the form's t (human 0, distorted 0.5, horror 1). */
export const FORM_INDEX = { human: 0, distorted: 6, horror: TRANSFORM_FRAMES.length - 1 } as const;

export function useSequencer(reduced: boolean) {
  const [playing, setPlaying] = useState<Playing>(null);
  const timers = useRef<number[]>([]);
  const cancel = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    setPlaying(null);
  }, []);
  const play = useCallback(
    (name: string, steps: Step[], onEnd?: () => void) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (reduced) {
        setPlaying(null);
        onEnd?.();
        return;
      }
      let at = 0;
      steps.forEach((s, i) => {
        timers.current.push(window.setTimeout(() => setPlaying(s.frame ? { frame: s.frame, freeze: s.freeze === true, name } : null), at));
        at += s.ms;
        if (i === steps.length - 1) timers.current.push(window.setTimeout(() => onEnd?.(), at));
      });
    },
    [reduced],
  );
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  return { playing, play, cancel };
}
