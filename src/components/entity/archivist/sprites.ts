/**
 * Archivist art metadata. The body is authored pixel art exported to PNG by
 * scripts/art/export-archivist.mts (64x80 art pixels, public/sprites/archivist/).
 * Mutation overlays are small cell lists drawn in the same 64x80 grid on top of (or behind) the PNG.
 * Overlays without a drawing are reported as unsupported and never invented.
 */
export type Stage = "human" | "distorted" | "transformed";
export type Pose = "idle" | "thinking" | "speaking" | "blink";
export type Cell = { x: number; y: number; c: string };

export const WIDTH = 64;
export const HEIGHT = 80;
export const STAGES: readonly Stage[] = ["human", "distorted", "transformed"];
export const POSES: readonly Pose[] = ["idle", "thinking", "speaking", "blink"];
export const spriteUrl = (stage: Stage, pose: Pose) => `/sprites/archivist/${stage}-${pose}.png`;

/** Head-and-shoulders crop in art pixels, for the dialogue portrait. */
export const PORTRAIT_CROP = { x: 18, y: 6, w: 28, h: 28 } as const;

const INK = "#141c25";
const PAPER = "#e7e0ce";
const TEAL = "#6bb8b1";
const THREAD = "#c9a85a";

const eye = (cx: number, cy: number): Cell[] => [
  { x: cx - 2, y: cy, c: PAPER }, { x: cx - 1, y: cy - 1, c: PAPER }, { x: cx, y: cy - 1, c: PAPER }, { x: cx + 1, y: cy - 1, c: PAPER },
  { x: cx + 2, y: cy, c: PAPER }, { x: cx - 1, y: cy + 1, c: PAPER }, { x: cx, y: cy + 1, c: PAPER }, { x: cx + 1, y: cy + 1, c: PAPER },
  { x: cx - 1, y: cy, c: TEAL }, { x: cx, y: cy, c: INK }, { x: cx + 1, y: cy, c: TEAL },
];
const column = (x: number, y0: number, y1: number, c: string): Cell[] => Array.from({ length: y1 - y0 + 1 }, (_, i) => ({ x, y: y0 + i, c }));
const stitches = (pts: [number, number][]): Cell[] => pts.map(([x, y]) => ({ x, y, c: THREAD }));

export type OverlayDef = {
  layer: "over" | "under";
  /** Cells to draw. Empty for the human form where the config says "None". */
  cells: (stage: Stage) => Cell[];
};

/** Floor shadow used by the human form of both shadow mutations. */
const FLOOR = Array.from({ length: 22 }, (_, i) => ({ x: 21 + i, y: 79, c: "#0b1018" }));

export const OVERLAYS: Readonly<Record<string, OverlayDef>> = {
  "ink-tears": {
    layer: "over",
    cells: (s) =>
      s === "human" ? [] : s === "distorted" ? column(37, 25, 31, INK) : [...column(27, 25, 34, INK), ...column(37, 25, 34, INK), ...column(36, 25, 28, INK)],
  },
  "orbiting-eyes": {
    layer: "over",
    cells: (s) => (s === "human" ? [] : s === "distorted" ? eye(8, 26) : [...eye(8, 26), ...eye(57, 14), ...eye(6, 48)]),
  },
  "stitched-halo": {
    layer: "over",
    cells: (s) =>
      s === "human"
        ? []
        : s === "distorted"
          ? stitches([[17, 14], [18, 12], [20, 10], [22, 9]])
          : stitches([[13, 16], [15, 13], [17, 11], [19, 9], [21, 8], [43, 8], [45, 9], [47, 11], [49, 13], [51, 16]]),
  },
  // The shadow mutations use a darkened copy of the sprite offset in the component; the human form gets a floor shadow here.
  "delayed-shadow": { layer: "under", cells: (s) => (s === "human" ? FLOOR : []) },
  "guarding-shadow": { layer: "under", cells: (s) => (s === "human" ? FLOOR : []) },
  // "missing-outline" needs erased outline pixels; not drawn yet, so it stays unsupported.
};

export type ShadowKind = "delayed" | "guarding" | null;

export type Composition = {
  over: Cell[];
  under: Cell[];
  shadow: ShadowKind;
  /** Overlay IDs from the assignment that have no drawing here. Reported, never invented. */
  unsupported: string[];
};

export function composeOverlays(stage: Stage, mutationIds: readonly string[]): Composition {
  const out: Composition = { over: [], under: [], shadow: null, unsupported: [] };
  for (const id of mutationIds) {
    const def = Object.hasOwn(OVERLAYS, id) ? OVERLAYS[id] : undefined;
    if (!def) {
      out.unsupported.push(id);
      continue;
    }
    (def.layer === "over" ? out.over : out.under).push(...def.cells(stage));
    if (stage !== "human") {
      if (id === "delayed-shadow") out.shadow = "delayed";
      if (id === "guarding-shadow" && out.shadow === null) out.shadow = "guarding";
    }
  }
  return out;
}

/** Three rising dots shown next to the head while thinking (animated by CSS). */
export const THOUGHT_DOTS: readonly Cell[] = [
  { x: 48, y: 12, c: "#a88cdc" },
  { x: 52, y: 8, c: "#a88cdc" },
  { x: 56, y: 4, c: "#a88cdc" },
];
