"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/components/game/anim";
import { playSfx } from "@/lib/sound";
import { PresenceShape } from "./Presence";
import { originOf, useSummon } from "./SummonProvider";
import { VisitorSprite } from "./Visitor";
import "./walk.css";
import { approachPoint, clampToField, keyAction, layoutSpots, nearestWithin, START, stepKeys, stepToward, type Facing, type Keys, type Vec } from "./walk";

const NO_KEYS: Keys = { up: false, down: false, left: false, right: false };

/**
 * The graveyard, walked. The visitor walks with the arrow keys or W A S D (or by tapping a spot) and presses E (or Enter
 * or Space) next to a presence to approach it, which summons it. Nothing about the repositories is shown here: the
 * presences stay unnamed until the encounter. The field takes focus when it appears, so the keys work at once, and shows
 * `intro` (the title card) until the visitor first moves. The Presences window (GraveyardGame) is the same choice as a
 * plain list, for anyone who would rather not walk.
 */
export function WalkField({ hrefs, intro }: { hrefs: string[]; intro?: ReactNode }) {
  const uid = useId();
  const summon = useSummon();
  const reduced = useReducedMotion();
  const spots = useMemo(() => layoutSpots(hrefs.length), [hrefs.length]);
  const [pos, setPos] = useState<Vec>(START);
  const [facing, setFacing] = useState<Facing>("up");
  const [moving, setMoving] = useState(false);
  const [started, setStarted] = useState(false);
  const posRef = useRef<Vec>(START);
  const keys = useRef<Keys>({ ...NO_KEYS });
  const target = useRef<{ pt: Vec; then?: number } | null>(null);
  const field = useRef<HTMLDivElement>(null);
  const markers = useRef<(HTMLSpanElement | null)[]>([]);
  const near = nearestWithin(pos, spots);

  const speak = useCallback(
    (i: number) => {
      const el = markers.current[i];
      summon(hrefs[i], el ? originOf(el) : undefined, "graveyard");
    },
    [hrefs, summon],
  );
  const move = (p: Vec, f: Facing | null) => {
    posRef.current = p;
    setPos(p);
    if (f) setFacing(f);
    if (p.x !== START.x || p.y !== START.y) setStarted(true);
  };

  // The graveyard is the page: take focus so the arrow keys work at once (unless the visitor is already typing).
  useEffect(() => {
    const a = document.activeElement;
    if (!a || a === document.body) field.current?.focus({ preventScroll: true });
  }, []);

  // One animation loop while the field is on screen: held keys first, then a tap-to-walk target.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const k = keys.current;
      if (k.up || k.down || k.left || k.right) {
        target.current = null;
        const r = stepKeys(posRef.current, k, dt);
        move(r.pos, r.facing);
        setMoving(true);
      } else if (target.current) {
        const t = target.current;
        const r = stepToward(posRef.current, t.pt, dt);
        move(r.pos, r.facing);
        setMoving(!r.arrived);
        if (r.arrived) {
          target.current = null;
          if (t.then !== undefined) speak(t.then);
        }
      } else setMoving(false);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [speak]);

  /** Walk somewhere; with reduced motion the visitor is simply there. */
  const walkTo = (pt: Vec, then?: number) => {
    if (reduced) {
      move(clampToField(pt), null);
      if (then !== undefined) speak(then);
      return;
    }
    target.current = { pt, then };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const a = keyAction(e.key);
    if (!a) return;
    e.preventDefault(); // arrows and Space must not scroll the page while walking
    if (a === "speak") {
      const n = nearestWithin(posRef.current, spots);
      if (n !== null) speak(n);
      return;
    }
    keys.current = { ...keys.current, [a]: true };
  };
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    const a = keyAction(e.key);
    if (a && a !== "speak") keys.current = { ...keys.current, [a]: false };
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const r = field.current?.getBoundingClientRect();
    if (!r || e.button !== 0) return;
    field.current?.focus();
    walkTo({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
  };
  const onMarker = (i: number) => (e: PointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    field.current?.focus();
    if (nearestWithin(posRef.current, spots) === i) speak(i);
    else walkTo(approachPoint(spots[i]), i);
  };

  return (
    <section className="walk" aria-labelledby={`${uid}-h`} data-started={started || undefined} data-testid="walk-field-section">
      <h2 id={`${uid}-h`} className="sr-only">Walk the graveyard</h2>
      <div
        ref={field}
        className="walk-field"
        tabIndex={0}
        aria-label="The graveyard. Walk with the arrow keys or W A S D. Press E next to a presence to approach it."
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => (keys.current = { ...NO_KEYS })}
        onPointerDown={onPointerDown}
        data-testid="walk-field"
      >
        {intro ? <div className="walk-intro" aria-hidden={started || undefined}>{intro}</div> : null}
        {spots.map((s, i) => (
          <span
            key={hrefs[i]}
            ref={(el) => {
              markers.current[i] = el;
            }}
            className="walk-presence"
            data-near={near === i || undefined}
            style={{ left: `${s.x}%`, top: `${s.y}%`, zIndex: Math.round(s.y) }}
            onPointerDown={onMarker(i)}
            onPointerEnter={() => playSfx("hover")}
            aria-hidden="true"
            data-testid="walk-presence"
          >
            <PresenceShape i={i} scale={4} />
            {near === i ? <span className="walk-prompt">E ▶ approach</span> : null}
          </span>
        ))}
        <span className="walk-visitor" style={{ left: `${pos.x}%`, top: `${pos.y}%`, zIndex: Math.round(pos.y) + 1 }} aria-hidden="true" data-testid="walk-visitor">
          <span className="walk-lantern" />
          <VisitorSprite facing={facing} moving={moving && !reduced} />
        </span>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{near !== null ? `A presence is close. Press E to approach it.` : ""}</p>
    </section>
  );
}
