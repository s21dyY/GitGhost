"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * "Arriving from a summoning": the landing page sets a one-time sessionStorage flag just before it navigates. The
 * first client render reads and clears it, the arrival lasts about 1.8 s, then it ends. A refresh or a direct visit
 * has no flag, so nothing plays. Reduced motion never plays it.
 */
export const ARRIVE_KEY = "gitghost.arrive";
const LENGTH_MS = 1800;
let state: "unread" | "arriving" | "done" = "unread";
const subs = new Set<() => void>();
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};
function snapshot(): boolean {
  if (state === "unread") {
    state = "done";
    try {
      if (window.sessionStorage.getItem(ARRIVE_KEY) === "1") {
        window.sessionStorage.removeItem(ARRIVE_KEY);
        state = "arriving";
      }
    } catch {
      /* optional */
    }
  }
  return state === "arriving";
}
export function resetArrivalForTests() {
  state = "unread";
  subs.clear();
}
export function useArrival(reduced: boolean): boolean {
  const arriving = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => {
    if (!arriving) return;
    const t = window.setTimeout(() => {
      state = "done";
      subs.forEach((cb) => cb());
    }, LENGTH_MS);
    return () => window.clearTimeout(t);
  }, [arriving]);
  return arriving && !reduced;
}
