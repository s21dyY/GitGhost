"use client";

import { useEffect, useReducer, useSyncExternalStore } from "react";
import type { Pose } from "@/components/entity/archivist/sprites";

/**
 * Ghost animation state machine. Pure reducer + a tiny hook.
 *
 * Priority: transforming > everything else. A transformation is never cut short by a disturbance,
 * but any conversational event (listen / speak / done) may interrupt anything, so input is never blocked.
 * Timed states carry a token. A timeout only applies if its token still matches, so a stale timer
 * from an interrupted state can never move the machine.
 */
export type AnimState = "idle" | "listening" | "speaking" | "disturbed" | "transforming" | "stabilizing";
export type AnimEvent =
  | { type: "LISTEN" }
  | { type: "SPEAK" }
  | { type: "DONE" }
  | { type: "DISTURB" }
  | { type: "TRANSFORM" }
  | { type: "TIMEOUT"; token: number };
export type Machine = { state: AnimState; token: number };

export const INITIAL: Machine = { state: "idle", token: 0 };
/** Milliseconds a timed state lasts. null = stays until another event. */
export const DURATION: Record<AnimState, number | null> = { idle: null, listening: null, speaking: null, disturbed: 700, transforming: 600, stabilizing: 500 };

const to = (m: Machine, state: AnimState): Machine => (m.state === state ? m : { state, token: m.token + 1 });

export function reduce(m: Machine, e: AnimEvent): Machine {
  switch (e.type) {
    case "LISTEN":
      return to(m, "listening");
    case "SPEAK":
      return to(m, "speaking");
    case "DONE":
      // Finishing a conversation step never cancels a transformation in progress.
      return m.state === "transforming" || m.state === "stabilizing" ? m : to(m, "idle");
    case "DISTURB":
      return m.state === "transforming" ? m : { state: "disturbed", token: m.token + 1 };
    case "TRANSFORM":
      return { state: "transforming", token: m.token + 1 };
    case "TIMEOUT":
      if (e.token !== m.token) return m;
      if (m.state === "disturbed" || m.state === "transforming") return to(m, "stabilizing");
      if (m.state === "stabilizing") return to(m, "idle");
      return m;
  }
}

/** Which of the five authored sprite frames shows for each state. New expression frames would extend this map. */
export function poseFor(state: AnimState): Pose {
  switch (state) {
    case "speaking": return "speaking";
    case "listening":
    case "disturbed": return "thinking";
    case "transforming": return "blink";
    default: return "idle";
  }
}

const MQ = "(prefers-reduced-motion: reduce)";
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(MQ);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

export function useAnimMachine(reduced: boolean) {
  const [m, dispatch] = useReducer(reduce, INITIAL);
  useEffect(() => {
    const d = DURATION[m.state];
    if (d == null) return;
    // Reduced motion resolves timed states immediately: no transitional frames.
    const t = window.setTimeout(() => dispatch({ type: "TIMEOUT", token: m.token }), reduced ? 0 : d);
    return () => window.clearTimeout(t);
  }, [m.state, m.token, reduced]);
  return [m, dispatch] as const;
}
