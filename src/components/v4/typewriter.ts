"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Typewriter reveal. Returns how many characters are visible. When disabled (reduced motion, or an old
 * message) everything is visible at once. `holds[i]` adds a pause after character i, so broken speech
 * can stall. `skip()` finishes the reveal. Resets when `resetKey` changes.
 */
export function useReveal(total: number, enabled: boolean, resetKey: string | number, holds?: readonly number[], cps = 55) {
  const [state, setState] = useState({ key: resetKey as string | number, n: 0 });
  const n = !enabled ? total : state.key === resetKey ? Math.min(state.n, total) : 0;
  useEffect(() => {
    if (!enabled || total === 0 || n >= total) return;
    const delay = 1000 / cps + (n > 0 ? (holds?.[n - 1] ?? 0) : 0);
    const id = window.setTimeout(() => setState({ key: resetKey, n: n + 1 }), delay);
    return () => window.clearTimeout(id);
  }, [enabled, total, n, resetKey, cps, holds]);
  const skip = useCallback(() => setState({ key: resetKey, n: total }), [resetKey, total]);
  return { n, done: n >= total, skip };
}
