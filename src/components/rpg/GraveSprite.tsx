import type { FeaturedStatus } from "@/fixtures/featured";

/**
 * Tiny deterministic ghost icon for the graveyard markers (16 x 15 art pixels, drawn at 4x = 64 px).
 * It is a status-tinted silhouette, not a character: the real ghost (identity, forms, poses) only
 * appears on the repository page, so these previews never imply or reroll an identity.
 */
const ROWS = [
  "......KKKK......",
  "....KKGGGGKK....",
  "...KGGGGGGGGK...",
  "..KGGGGGGGGGGK..",
  "..KGGKKGGKKGGK..",
  "..KGGKKGGKKGGK..",
  "..KGGGGGGGGGGK..",
  "..KGGGGKKGGGGK..",
  "..KGGGGKKGGGGK..",
  "..KGGGGGGGGGGK..",
  "..KGGGGGGGGGGK..",
  "..KGGGGGGGGGGK..",
  "..KGGKGGGGKGGK..",
  "...KK.KGGK.KK...",
  "......KKKK......",
] as const;

export const GRAVE_SPRITE_SIZE = { w: 16, h: ROWS.length };
export const GRAVE_ROWS = ROWS;

const TINT: Record<FeaturedStatus, { body: string; edge: string }> = {
  archived: { body: "#d9a7b4", edge: "#3b1a26" },
  quiet: { body: "#bcaedf", edge: "#241d3a" },
  active: { body: "#8fd6cf", edge: "#12313a" },
};

export function GraveSprite({ status }: { status: FeaturedStatus }) {
  const t = TINT[status];
  const rects: { x: number; y: number; w: number; fill: string }[] = [];
  ROWS.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let w = 1;
      while (x + w < row.length && row[x + w] === ch) w++;
      if (ch !== ".") rects.push({ x, y, w, fill: ch === "G" ? t.body : t.edge });
      x += w;
    }
  });
  return (
    <svg
      viewBox={`0 0 ${GRAVE_SPRITE_SIZE.w} ${GRAVE_SPRITE_SIZE.h}`}
      width={GRAVE_SPRITE_SIZE.w * 4}
      height={GRAVE_SPRITE_SIZE.h * 4}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      {rects.map((r) => (
        <rect key={`${r.x},${r.y}`} x={r.x} y={r.y} width={r.w} height={1} fill={r.fill} />
      ))}
    </svg>
  );
}
