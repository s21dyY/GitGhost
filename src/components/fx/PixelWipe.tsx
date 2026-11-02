"use client";

import { useLayoutEffect, useRef } from "react";

/**
 * A retro screen transition: the screen fills (close) or clears (open) in chunky blocks, in a stepped rhythm
 * like an old console. The order of the blocks is the pattern:
 *   converge  the dark closes in on a point (the thing you chose), far edges first
 *   spiral    a JRPG battle swirl around the centre
 *   rain      dark runs down the screen in uneven columns
 *   rise      the same columns, running upward
 * Decorative only. Callers skip it entirely under reduced motion.
 */
export type WipePattern = "converge" | "spiral" | "rain" | "rise";

const BLOCK = 16;

function rand(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Block indices in the order they change. Exported for tests. */
export function wipeOrder(cols: number, rows: number, pattern: WipePattern, origin: { x: number; y: number } = { x: 0.5, y: 0.5 }): number[] {
  const r = rand(7);
  const colDelay = Array.from({ length: cols }, () => r() * 0.5);
  const keys: number[] = [];
  const ox = origin.x * cols, oy = origin.y * rows;
  const maxD = Math.hypot(Math.max(ox, cols - ox), Math.max(oy, rows - oy));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const jitter = r() * 0.08;
    let k: number;
    if (pattern === "converge") k = 1 - Math.hypot(x + 0.5 - ox, y + 0.5 - oy) / maxD + jitter;
    else if (pattern === "spiral") {
      const dx = x + 0.5 - cols / 2, dy = y + 0.5 - rows / 2;
      const d = Math.hypot(dx / cols, dy / rows) * 1.4;
      const a = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
      k = 0.6 * d + 0.4 * ((a + d * 1.5) % 1) + jitter * 0.5;
    } else if (pattern === "rain") k = colDelay[x] + (y / rows) * 0.5;
    else k = colDelay[x] + ((rows - 1 - y) / rows) * 0.5;
    keys.push(k);
  }
  return keys.map((k, i) => [k, i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
}

export function PixelWipe({
  mode, pattern, ms, delay = 0, steps = 18, origin, color = "#000",
}: {
  mode: "close" | "open";
  pattern: WipePattern;
  ms: number;
  delay?: number;
  steps?: number;
  /** 0..1 of the viewport; where "converge" closes in. */
  origin?: { x: number; y: number };
  color?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ox = origin?.x ?? 0.5, oy = origin?.y ?? 0.5;
  useLayoutEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const cols = Math.ceil(w / BLOCK), rows = Math.ceil(h / BLOCK);
    const order = wipeOrder(cols, rows, pattern, { x: ox, y: oy });
    const b = BLOCK * dpr;
    g.fillStyle = color;
    // "open" starts fully dark before the first paint, so nothing flashes through
    if (mode === "open") g.fillRect(0, 0, canvas.width, canvas.height);
    let drawn = 0, raf = 0;
    const t0 = performance.now() + delay;
    const tick = (now: number) => {
      const p = Math.max(0, Math.min(1, (now - t0) / ms));
      const target = Math.floor((Math.floor(p * steps) / steps) * order.length);
      for (; drawn < target; drawn++) {
        const i = order[drawn], x = (i % cols) * b, y = Math.floor(i / cols) * b;
        if (mode === "close") g.fillRect(x, y, b, b);
        else g.clearRect(x, y, b, b);
      }
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, pattern, ms, delay, steps, ox, oy, color]);
  return <canvas ref={ref} className="fx-wipe" aria-hidden="true" />;
}
