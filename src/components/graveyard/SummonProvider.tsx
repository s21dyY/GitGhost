"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/components/v4/anim";
import { ARRIVE_KEY } from "@/components/v4/arrival";
import { playSfx } from "@/lib/sound";

export const SUMMON_MS = 900;

const Ctx = createContext<(href: string) => void>(() => undefined);
export const useSummon = () => useContext(Ctx);

/** A plain left click on a link starts the summoning; modified clicks keep their normal meaning (new tab, etc.). */
export function summonClick(summon: (href: string) => void, href: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    summon(href);
  };
}

/**
 * Summoning: fog rises, the lantern gutters, the screen goes dark, then the encounter opens. About 0.9 s.
 * With reduced motion there is no animation: the page simply changes. Screen readers hear "Summoning".
 */
export function SummonProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [active, setActive] = useState(false);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const summon = useCallback(
    (href: string) => {
      if (busy.current) return;
      busy.current = true;
      playSfx("summon");
      try {
        if (!reduced) window.sessionStorage.setItem(ARRIVE_KEY, "1");
      } catch {
        /* the arrival animation is optional */
      }
      if (reduced) {
        router.push(href);
        return;
      }
      setActive(true);
      timer.current = window.setTimeout(() => router.push(href), SUMMON_MS);
    },
    [reduced, router],
  );
  return (
    <Ctx.Provider value={summon}>
      {children}
      {active ? (
        <div className="summon-veil" aria-hidden="true" data-testid="summon-veil">
          <span className="summon-fog summon-fog-a" />
          <span className="summon-fog summon-fog-b" />
          <span className="summon-lamp" />
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{active ? "Summoning…" : ""}</p>
    </Ctx.Provider>
  );
}
