import type { Emotion } from "./fixtures";

/**
 * Pixel-art icons as text bitmaps: 8x8 for actions, 7x7 for emotion faces.
 * Drawn as crisp SVG rects, so they scale only in whole pixels and never blur.
 */
const ICONS = {
  talk: [".######.", "#......#", "#.#..#.#", "#......#", ".######.", "...##...", "..##....", ".#......"],
  memories: [".#####..", "#....##.", "#.##.#.#", "#....#.#", "#.##.#.#", "#....#.#", "#....###", ".#####.."],
  rewind: ["...#...#", "..##..##", ".###.###", "########", "########", ".###.###", "..##..##", "...#...#"],
  inspect: ["..####..", ".#....#.", "#..##..#", "#.####.#", "#.####.#", "#..##..#", ".#....#.", "..####.."],
} as const;
export type IconName = keyof typeof ICONS;

function Bitmap({ rows, scale }: { rows: readonly string[]; scale: number }) {
  const w = rows[0].length;
  return (
    <svg width={w * scale} height={rows.length * scale} viewBox={`0 0 ${w} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false" className="gg-icon">
      {rows.flatMap((row, y) => [...row].map((ch, x) => (ch === "#" ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill="currentColor" /> : null)))}
    </svg>
  );
}

export const PixelIcon = ({ name, scale = 3 }: { name: IconName; scale?: number }) => <Bitmap rows={ICONS[name]} scale={scale} />;

const FACES: Record<Emotion, string[]> = {
  neutral: [".#####.", "#.....#", "#.#.#.#", "#.....#", "#.###.#", "#.....#", ".#####."],
  melancholy: [".#####.", "#.....#", "#.#.#.#", "#.....#", "#..#..#", "#.#.#.#", ".#####."],
  amused: [".#####.", "#.....#", "#.#.#.#", "#.....#", "#.###.#", "#.#.#.#", ".#####."],
  angry: [".#####.", "##...##", "#.#.#.#", "#.....#", "#.###.#", "#.....#", ".#####."],
  disturbed: [".#####.", "#.....#", "#.###.#", "#.....#", "#.#.#.#", "#.###.#", ".#####."],
  eldritch: [".#.#.#.", "#.....#", "#.#.#.#", "#.....#", "#.###.#", "#.#.#.#", ".#####."],
};
export const EmotionGlyph = ({ emotion, scale = 3 }: { emotion: Emotion; scale?: number }) => <Bitmap rows={FACES[emotion]} scale={scale} />;
