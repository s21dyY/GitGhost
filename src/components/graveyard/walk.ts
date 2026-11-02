/**
 * The graveyard, walked (the home screen): the visitor, a person in a bedsheet ghost costume, walks the graveyard and meets the
 * presences. Pure logic only, so it can be tested without a browser. Coordinates are percent of the field (0..100).
 */
export type Vec = { x: number; y: number };
export type Facing = "down" | "up" | "left" | "right";
export type Keys = { up: boolean; down: boolean; left: boolean; right: boolean };

export const START: Vec = { x: 50, y: 88 };
/** Percent per second. */
export const SPEED = 32;
/** How close (percent) the visitor must be to speak to a presence. */
export const REACH = 11;
/** The visitor stays inside this box, so the sprite never leaves the field. */
export const BOUNDS = { minX: 4, maxX: 96, minY: 10, maxY: 94 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const clampToField = (p: Vec): Vec => ({ x: clamp(p.x, BOUNDS.minX, BOUNDS.maxX), y: clamp(p.y, BOUNDS.minY, BOUNDS.maxY) });

/** Where the presences stand: two loose rows, nudged so they do not look like a grid. Deterministic by slot only. */
export function layoutSpots(count: number): Vec[] {
  const nudgeX = [-4, 3, -2, 4, -3, 2];
  const nudgeY = [0, 5, -3, 4, -2, 6];
  const perRow = Math.ceil(count / 2);
  return Array.from({ length: count }, (_, i) => {
    const row = i < perRow ? 0 : 1;
    const col = row === 0 ? i : i - perRow;
    const inRow = row === 0 ? perRow : count - perRow;
    const x = ((col + 1) / (inRow + 1)) * 100 + nudgeX[i % nudgeX.length];
    const y = (row === 0 ? 26 : 56) + nudgeY[i % nudgeY.length];
    return clampToField({ x, y });
  });
}

/** One movement step from held keys. Diagonals are normalized, so they are not faster. */
export function stepKeys(p: Vec, keys: Keys, dtSec: number): { pos: Vec; facing: Facing | null } {
  const dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  const dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (!dx && !dy) return { pos: p, facing: null };
  const len = Math.hypot(dx, dy);
  const d = (SPEED * Math.min(dtSec, 0.1)) / len;
  return { pos: clampToField({ x: p.x + dx * d, y: p.y + dy * d }), facing: facingOf(dx, dy) };
}

/** One step toward a target (tap or click to walk). Arrives exactly, never overshoots. */
export function stepToward(p: Vec, target: Vec, dtSec: number): { pos: Vec; facing: Facing | null; arrived: boolean } {
  const t = clampToField(target);
  const dx = t.x - p.x;
  const dy = t.y - p.y;
  const dist = Math.hypot(dx, dy);
  const d = SPEED * Math.min(dtSec, 0.1);
  if (dist <= d || dist < 0.01) return { pos: t, facing: dist < 0.01 ? null : facingOf(dx, dy), arrived: true };
  return { pos: { x: p.x + (dx / dist) * d, y: p.y + (dy / dist) * d }, facing: facingOf(dx, dy), arrived: false };
}

export function facingOf(dx: number, dy: number): Facing {
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
}

/** The nearest presence within reach, or null. */
export function nearestWithin(p: Vec, spots: readonly Vec[], reach = REACH): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  spots.forEach((s, i) => {
    const d = Math.hypot(s.x - p.x, s.y - p.y);
    if (d <= reach && d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

/** A spot just in front of a presence, where tapping it walks the visitor to. */
export const approachPoint = (s: Vec): Vec => clampToField({ x: s.x, y: s.y + REACH * 0.6 });

/** Keyboard key → direction, or the "speak" action. */
export function keyAction(key: string): keyof Keys | "speak" | null {
  switch (key) {
    case "ArrowUp": case "w": case "W": return "up";
    case "ArrowDown": case "s": case "S": return "down";
    case "ArrowLeft": case "a": case "A": return "left";
    case "ArrowRight": case "d": case "D": return "right";
    case "e": case "E": case "Enter": case " ": return "speak";
    default: return null;
  }
}
