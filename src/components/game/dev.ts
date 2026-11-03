"use client";

import { useSyncExternalStore } from "react";

/**
 * Developer view: `?dev=1` on any page shows the labels, storytelling notes and behaviour explanations that the
 * normal encounter leaves out so the ghost's words stay the focus. The server always renders the normal view.
 */
const subscribe = () => () => {};
const read = () => new URLSearchParams(window.location.search).get("dev") === "1";
export function useDevMode(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
