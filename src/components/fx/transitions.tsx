"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useReducedMotion } from "@/components/v4/anim";
import { playSfx } from "@/lib/sound";
import { PixelWipe } from "./PixelWipe";

export const LEAVE_MS = 1100;
const RETURN_MS = 1500;

/**
 * "Coming back from an encounter": set by the flight just before it navigates, read by the graveyard, which plays
 * its return and then clears it. Client navigation only, so a plain module store is enough (no storage, no flags).
 */
let returning = false;
let endTimer: number | undefined;
const subs = new Set<() => void>();
const setReturning = (on: boolean) => {
  returning = on;
  subs.forEach((cb) => cb());
};
const subscribe = (cb: () => void) => {
  subs.add(cb);
  return () => subs.delete(cb);
};

/**
 * "Back to the graveyard" as a flight: footsteps, the dark runs down the screen, then the graveyard. A modified
 * click (new tab) or reduced motion keeps the plain link. The overlay is reset when the page is hidden, because
 * Cache Components keeps this page alive while the player is away.
 */
export function LeaveLink({ className, children, label }: { className: string; children: ReactNode; label: string }) {
  const reduced = useReducedMotion();
  const anchor = useRef<HTMLAnchorElement>(null);
  const proceed = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      window.clearTimeout(timer.current);
      setLeaving(false);
    },
    [],
  );
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // the second, programmatic click after the flight: let Link navigate as usual
    if (proceed.current) {
      proceed.current = false;
      return;
    }
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || reduced) return;
    e.preventDefault();
    if (leaving) return;
    setLeaving(true);
    playSfx("flee");
    timer.current = window.setTimeout(() => {
      setReturning(true);
      proceed.current = true;
      anchor.current?.click();
    }, LEAVE_MS);
  };
  return (
    <>
      <Link ref={anchor} href="/" className={className} aria-label={label} onClick={onClick}>
        {children}
      </Link>
      {leaving
        ? createPortal(
            <div className="fx-veil" aria-hidden="true" data-testid="leave-veil">
              <PixelWipe mode="close" pattern="rain" ms={800} />
              <p className="fx-caption fx-caption-late">You flee into the fog&hellip;</p>
            </div>,
            document.body,
          )
        : null}
      <p className="sr-only" role="status" aria-live="polite">{leaving ? "Leaving the encounter…" : ""}</p>
    </>
  );
}

/** The graveyard after a flight: the dark drains upward and something says it noticed. */
export function ReturnWipe() {
  const reduced = useReducedMotion();
  const show = useSyncExternalStore(subscribe, () => returning, () => false) && !reduced;
  useEffect(() => {
    if (!show) return;
    playSfx("return");
    // One shared timer ends the return. It is never cancelled by a cleanup: clearing the store from a cleanup would
    // hide the veil the instant it appears (React re-checks the store after effects), and if the page is hidden
    // midway the timer still ends it.
    window.clearTimeout(endTimer);
    endTimer = window.setTimeout(() => setReturning(false), RETURN_MS);
  }, [show]);
  if (!show) return null;
  return (
    <div className="fx-veil fx-veil-out" aria-hidden="true" data-testid="return-veil">
      <PixelWipe mode="open" pattern="rise" ms={900} delay={250} />
      <p className="fx-caption fx-caption-early">The graveyard remembers you.</p>
    </div>
  );
}

/** Every eye in the graveyard follows the pointer. Writes --lx / --ly (-1..1) on the root; CSS moves the eyes. */
export function Watchers() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const root = document.documentElement;
    let raf = 0, x = 0, y = 0;
    const move = (e: PointerEvent) => {
      x = (e.clientX / window.innerWidth) * 2 - 1;
      y = (e.clientY / window.innerHeight) * 2 - 1;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        root.style.setProperty("--lx", x.toFixed(2));
        root.style.setProperty("--ly", y.toFixed(2));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
      root.style.removeProperty("--lx");
      root.style.removeProperty("--ly");
    };
  }, [reduced]);
  return null;
}

/** A pale face that is sometimes at the edge of the fog, for a moment, and then is not. CSS decides when. */
export function Peeker() {
  const rows = ["..XXXXXX..", ".XXXXXXXX.", "XXXXXXXXXX", "XXKKXXKKXX", "XXKRXXKRXX", "XXXXXXXXXX", "XXXXKKXXXX", "XXXKKKKXXX", ".XXXXXXXX.", "..XX..XX.."];
  const fill: Record<string, string> = { X: "#c9cfc4", K: "#05060b", R: "#b3122a" };
  return (
    <div className="peeker" aria-hidden="true">
      <svg viewBox="0 0 10 10" width="70" height="70" shapeRendering="crispEdges" focusable="false">
        {rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill={fill[ch]} />)))}
      </svg>
    </div>
  );
}

/** Retro-horror screen: scanlines, grain and a vignette over everything. Pointer-transparent and decorative. */
export function ScreenFx() {
  return <div className="crt" aria-hidden="true" />;
}
