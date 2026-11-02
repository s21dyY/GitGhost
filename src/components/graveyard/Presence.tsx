"use client";

import type { CSSProperties } from "react";
import { playSfx } from "@/lib/sound";
import { originOf, useSummon } from "./SummonProvider";

/**
 * An unrevealed presence. Nothing here says which repository it is or what the ghost looks like: that is learned only by
 * entering the encounter. Three generic shadow shapes (a sheet, a hood, a low crawler) walk the fog; which one a slot gets
 * is only its position, so it carries no information about the repository behind it.
 */
const SHAPES: { rows: string[]; scale: number }[] = [
  { scale: 7, rows: ["....XXXXXX....", "...XXXXXXXX...", "..XXXXXXXXXX..", "..XXXXXXXXXX..", "..XXEEXXEEXX..", "..XXEEXXEEXX..", "..XXXXXXXXXX..", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", ".XXX.XXXX.XXX.", ".XX...XX...XX."] },
  { scale: 7, rows: ["......XX......", ".....XXXX.....", "....XXXXXX....", "...XXXXXXXX...", "...XXXXXXXX...", "...XXEXXEXX...", "...XXXXXXXX...", "..XXXXXXXXXX..", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", ".XXXXXXXXXXXX.", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "XX.XXXXXXXX.XX", "X...XXXXXX...X"] },
  { scale: 8, rows: ["..............", "..............", "....XXXXXX....", "..XXXXXXXXXX..", ".XXXXXXXXXXXX.", ".XXEEXXXXEEXX.", "XXXEEXXXXEEXXX", "XXXXXXXXXXXXXX", "XXXXXXXXXXXXXX", "X.XXX.XX.XXX.X", "..X...XX...X.."] },
];

function Shape({ i }: { i: number }) {
  const { rows, scale } = SHAPES[i % SHAPES.length];
  const cells: { x: number; y: number; eye: boolean }[] = [];
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === "X" || ch === "E") cells.push({ x, y, eye: ch === "E" }); }));
  return (
    <svg viewBox={`0 0 ${rows[0].length} ${rows.length}`} width={rows[0].length * scale} height={rows.length * scale} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {cells.map((c) => (c.eye ? null : <rect key={`${c.x},${c.y}`} x={c.x} y={c.y} width="1" height="1" fill={(c.x + c.y) % 5 === 0 ? "#0b1122" : "#070a14"} />))}
      {cells.filter((c) => c.eye).map((c) => <rect key={`e${c.x},${c.y}`} className="presence-eye" x={c.x} y={c.y} width="1" height="1" fill="#bfe9e0" />)}
    </svg>
  );
}

export function Presence({ href, index, total }: { href: string; index: number; total: number }) {
  const summon = useSummon();
  const style = {
    "--dx": `${[46, -52, 38, -44, 56, -34][index % 6]}px`,
    "--dur": `${[17, 21, 19, 24, 18, 22][index % 6]}s`,
    "--delay": `${-index * 3.1}s`,
    "--lift": `${[0, 46, 14, 62, 8, 38][index % 6]}px`,
  } as CSSProperties;
  return (
    <li className="presence" style={style}>
      <div className="presence-drift">
        <div className="presence-face">
          <button
            type="button"
            className="presence-btn"
            aria-label={`Approach presence ${index + 1} of ${total}`}
            data-testid="presence"
            onMouseEnter={() => playSfx("hover")}
            onFocus={() => playSfx("hover")}
            onClick={(e) => summon(href, originOf(e.currentTarget))}
          >
            <Shape i={index} />
            <span className="presence-cue" aria-hidden="true">▶ approach</span>
          </button>
        </div>
      </div>
    </li>
  );
}
