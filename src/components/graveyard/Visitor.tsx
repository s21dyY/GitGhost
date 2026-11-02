import type { Facing } from "./walk";

/**
 * The visitor: a person wearing a bedsheet ghost costume, carrying a lantern. Placeholder pixel art drawn in code
 * (20 x 18 art pixels) until the artist's sprite arrives. The human shows through on purpose: cut-out eye holes, an
 * uneven hem, a hand holding the lantern and sneakers underneath. It is an original costume, not a brand mascot.
 */
const SHEET = [
  "......XXXX..........",
  "....XXXXXXXX........",
  "...XXXXXXXXXX.......",
  "..XXXXXXXXXXXX......",
  "..XXXKKXXKKXXX......",
  "..XXXKKXXKKXXX......",
  "..XXXXXXXXXXXX......",
  ".XXXXXXXXXXXXXX.....",
  ".XXXXSXXXXSXXXX.....",
  ".XXXXSXXXXSXXXXH....",
  "XXXXXSXXXXSXXXXXHL..",
  "XXXXSXXXXXXSXXXXLLL.",
  "XXXXSXXXXXXSXXXXLGL.",
  "XXXSXXXXXXXXSXXXLGL.",
  "XX.XXXXX.XXXXX.XLLL.",
  "X...XXX...XXX.......",
];
const FEET: Record<"a" | "b", string[]> = {
  a: ["....BB....BB........", "....WW....WW........"],
  b: ["...BB......BB.......", "...WW......WW......."],
};
const FILL: Record<string, string> = {
  X: "#e7e0ce", // the sheet
  S: "#b9b2a2", // folds
  K: "#05070d", // eye holes: the dark of the person inside
  H: "#d9a77c", // a hand
  L: "#8a6a2c", // lantern frame
  G: "#ffd27a", // lantern flame
  B: "#7a2630", // sneakers
  W: "#d8d4cc", // soles
};

function Frame({ frame, back }: { frame: "a" | "b"; back: boolean }) {
  const rows = [...SHEET, ...FEET[frame]];
  return (
    <svg className={`walk-frame walk-frame-${frame}`} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) => {
          if (ch === ".") return null;
          const c = back && ch === "K" ? "X" : ch;
          return <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill={FILL[c]} />;
        }),
      )}
    </svg>
  );
}

export function VisitorSprite({ facing, moving }: { facing: Facing; moving: boolean }) {
  return (
    <span className="walk-visitor-art" data-facing={facing} data-moving={moving || undefined}>
      <Frame frame="a" back={facing === "up"} />
      <Frame frame="b" back={facing === "up"} />
    </span>
  );
}
