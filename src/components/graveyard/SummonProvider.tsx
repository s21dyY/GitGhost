"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/components/game/anim";
import { ARRIVE_KEY } from "@/components/game/arrival";
import { rememberVia, type Via } from "@/components/game/encounter";
import { PixelWipe } from "@/components/fx/PixelWipe";
import { playSfx } from "@/lib/sound";

export const SUMMON_MS = 1500;

/** Where the summoning came from, as 0..1 of the viewport: the dark closes in on that point. */
export type Origin = { x: number; y: number };
/** `via`: how the visitor chose (a presence in the graveyard, or a typed name); the ghost greets them for it. */
type Summon = (href: string, origin?: Origin, via?: Exclude<Via, "direct">) => void;
const Ctx = createContext<Summon>(() => undefined);
export const useSummon = () => useContext(Ctx);

/** The centre of an element as 0..1 of the viewport. */
export function originOf(el: Element): Origin {
  const r = el.getBoundingClientRect();
  return { x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight };
}

/** A plain left click on a link starts the summoning; modified clicks keep their normal meaning (new tab, etc.). */
export function summonClick(summon: Summon, href: string) {
  return (e: MouseEvent<HTMLElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    summon(href, originOf(e.currentTarget));
  };
}

/**
 * Summoning, as a retro RPG encounter (about 1.5 s): the sting, the screen jolts and flashes red, the dark closes in
 * block by block on the thing you chose until only its eyes are left, a line of text, then the encounter opens.
 * With reduced motion there is no animation: the page simply changes. Screen readers hear "Summoning".
 */
export function SummonProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const reduced = useReducedMotion();
  const [active, setActive] = useState<Origin | null>(null);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  // Cache Components keeps this page alive (hidden) while the encounter is open, so a finished summoning would
  // still be showing its veil, and refusing new summons, when the player comes back. Reset it whenever the page hides.
  useLayoutEffect(
    () => () => {
      window.clearTimeout(timer.current);
      busy.current = false;
      setActive(null);
      delete document.documentElement.dataset.fx;
    },
    [],
  );
  const summon = useCallback(
    (href: string, origin: Origin = { x: 0.5, y: 0.45 }, via: Exclude<Via, "direct"> = "graveyard") => {
      if (busy.current) return;
      busy.current = true;
      playSfx("summon");
      rememberVia(via);
      try {
        if (!reduced) window.sessionStorage.setItem(ARRIVE_KEY, "1");
      } catch {
        /* the arrival animation is optional */
      }
      if (reduced) {
        router.push(href);
        return;
      }
      setActive(origin);
      // the page jolts as the encounter starts
      document.documentElement.dataset.fx = "shake";
      window.setTimeout(() => delete document.documentElement.dataset.fx, 420);
      timer.current = window.setTimeout(() => router.push(href), SUMMON_MS);
    },
    [reduced, router],
  );
  return (
    <Ctx.Provider value={summon}>
      {children}
      {active ? (
        <div className="summon-veil" aria-hidden="true" data-testid="summon-veil">
          <span className="summon-flash" />
          <PixelWipe mode="close" pattern="converge" origin={active} ms={800} delay={260} />
          <span className="summon-eyes" style={{ left: `${active.x * 100}%`, top: `${active.y * 100}%` }}>
            <i />
            <i />
          </span>
          <p className="fx-caption summon-caption">Something answers&hellip;</p>
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{active ? "Summoning…" : ""}</p>
    </Ctx.Provider>
  );
}
