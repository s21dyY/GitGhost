/**
 * Procedural pixel-art graveyard backdrop. Everything is generated from fixed numbers, so server
 * and browser always agree and there are no image files. The scene is drawn on a 192 x 108 grid
 * ("art pixels") and shown at an INTEGER scale (see `.scene` in globals.css), so every art pixel is
 * the same number of screen pixels.
 */
export const SCENE_W = 192;
export const SCENE_H = 108;

export const SCENE_COLORS = {
  skyTop: "#0c1020",
  sky1: "#10162b",
  sky2: "#151c36",
  sky3: "#1b2342",
  sky4: "#232b4f",
  moon: "#e9e2d6",
  moonShade: "#c3bba9",
  halo: "#2a3358",
  hillFar: "#1a1f3b",
  hillNear: "#141830",
  stone: "#0f1426",
  stoneEdge: "#2a3354",
  stoneMoss: "#1d3a3d",
  ground: "#0b0f1e",
  grass: "#12202a",
  fence: "#060912",
  tree: "#080b17",
  starBone: "#e9e2d6",
  starTeal: "#6bb8b1",
  starGold: "#e4c18b",
} as const;

type Cell = string;
type Layer = Map<string, Set<Cell>>;

const key = (x: number, y: number) => `${x},${y}`;

function layer(): { cells: Layer; put: (c: string, x: number, y: number) => void; rect: (c: string, x: number, y: number, w: number, h: number) => void } {
  const cells: Layer = new Map();
  const put = (c: string, x: number, y: number) => {
    if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) return;
    if (!cells.has(c)) cells.set(c, new Set());
    cells.get(c)!.add(key(x, y));
  };
  const rect = (c: string, x: number, y: number, w: number, h: number) => {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(c, x + i, y + j);
  };
  return { cells, put, rect };
}

/** Merge pixels into horizontal runs and emit one compact SVG path per color. */
export function toPaths(cells: Layer): { color: string; d: string }[] {
  const out: { color: string; d: string }[] = [];
  for (const [color, set] of cells) {
    const rows = new Map<number, number[]>();
    for (const k of set) {
      const [x, y] = k.split(",").map(Number);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push(x);
    }
    let d = "";
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
      const xs = rows.get(y)!.sort((a, b) => a - b);
      let i = 0;
      while (i < xs.length) {
        let j = i;
        while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
        d += `M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`;
        i = j + 1;
      }
    }
    out.push({ color, d });
  }
  return out;
}

// Small deterministic generator (LCG). Same numbers on server and client.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

const C = SCENE_COLORS;

function sky() {
  const L = layer();
  // Banded gradient with a dithered seam between bands, like old 16-bit skies. Bands are disjoint;
  // each band's color also dithers up into the band above it (later paths draw on top).
  const edges = [0, 22, 40, 58, 74, SCENE_H];
  const colors = [C.skyTop, C.sky1, C.sky2, C.sky3, C.sky4];
  colors.forEach((color, i) => L.rect(color, 0, edges[i], SCENE_W, edges[i + 1] - edges[i]));
  for (let i = 1; i < colors.length; i++) {
    const y = edges[i];
    for (let x = 0; x < SCENE_W; x++) {
      if ((x + y) % 2 === 0) L.put(colors[i], x, y - 1);
      if ((x + y) % 4 === 0) L.put(colors[i], x, y - 2);
    }
  }
  return L;
}

function moon() {
  const L = layer();
  const cx = 138, cy = 26, r = 10;
  for (let y = -r - 5; y <= r + 5; y++) {
    for (let x = -r - 5; x <= r + 5; x++) {
      const d = x * x + y * y;
      if (d <= r * r) L.put(C.moon, cx + x, cy + y);
      else if (d <= (r + 3) * (r + 3) && (x + y) % 2 === 0) L.put(C.halo, cx + x, cy + y);
      else if (d <= (r + 5) * (r + 5) && (x + y) % 4 === 0) L.put(C.halo, cx + x, cy + y);
    }
  }
  // craters and a shaded limb
  for (const [dx, dy] of [[-3, -3], [-2, -3], [3, 2], [4, 2], [3, 3], [-4, 4], [0, 6], [1, 6], [5, -4]]) L.put(C.moonShade, cx + dx, cy + dy);
  for (let y = -r; y <= r; y++) for (let x = 5; x <= r; x++) if (x * x + y * y <= r * r && x * x + y * y > (r - 2) * (r - 2)) L.put(C.moonShade, cx + x, cy + y);
  return L;
}

function stars(group: 0 | 1 | 2) {
  const L = layer();
  const r = rng(77 + group * 13);
  const color = [C.starBone, C.starTeal, C.starGold][group];
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(r() * SCENE_W);
    const y = Math.floor(r() * 56);
    if (Math.hypot(x - 138, y - 26) < 18) continue; // keep the moon clear
    L.put(color, x, y);
    if (i % 7 === 0) {
      L.put(color, x - 1, y);
      L.put(color, x + 1, y);
      L.put(color, x, y - 1);
      L.put(color, x, y + 1);
    }
  }
  return L;
}

function hills() {
  const L = layer();
  for (let x = 0; x < SCENE_W; x++) {
    const far = Math.round(66 + 5 * Math.sin(x / 15) + 3 * Math.sin(x / 6 + 1));
    L.rect(C.hillFar, x, far, 1, SCENE_H - far);
    const near = Math.round(78 + 4 * Math.sin(x / 11 + 2) + 2 * Math.sin(x / 4));
    L.rect(C.hillNear, x, near, 1, SCENE_H - near);
  }
  return L;
}

/** A rounded-top headstone silhouette with a lighter left edge and optional cross. */
function headstone(L: ReturnType<typeof layer>, x: number, baseY: number, w: number, h: number, opts: { cross?: boolean; moss?: boolean } = {}) {
  const top = baseY - h;
  L.rect(C.stone, x, top + 2, w, h - 2);
  L.rect(C.stone, x + 1, top + 1, w - 2, 1);
  L.rect(C.stone, x + 2, top, w - 4, 1);
  L.rect(C.stoneEdge, x, top + 2, 1, h - 2);
  L.put(C.stoneEdge, x + 1, top + 1);
  L.rect(C.stoneEdge, x + 2, top, Math.max(1, Math.floor((w - 4) / 2)), 1);
  if (opts.cross) {
    const cx = x + Math.floor(w / 2);
    L.rect(C.stoneEdge, cx, top + 4, 1, 7);
    L.rect(C.stoneEdge, cx - 2, top + 6, 5, 1);
  }
  if (opts.moss) for (let i = 0; i < w; i += 2) L.put(C.stoneMoss, x + i, baseY - 1);
}

function cross(L: ReturnType<typeof layer>, x: number, baseY: number, h: number) {
  L.rect(C.stone, x, baseY - h, 2, h);
  L.rect(C.stone, x - 3, baseY - h + 4, 8, 2);
  L.put(C.stoneEdge, x, baseY - h);
  L.rect(C.stoneEdge, x - 3, baseY - h + 4, 1, 2);
}

function deadTree() {
  const L = layer();
  const x = 26, base = 98;
  L.rect(C.tree, x, base - 40, 3, 40);
  L.rect(C.tree, x - 1, base - 6, 5, 6);
  // branches
  const branches: [number, number, number, number][] = [[x - 12, base - 34, 12, 2], [x + 3, base - 40, 14, 2], [x - 8, base - 24, 9, 2], [x + 3, base - 28, 11, 2], [x - 16, base - 41, 5, 2], [x + 14, base - 47, 6, 2], [x + 13, base - 33, 6, 2]];
  for (const [bx, by, bw, bh] of branches) L.rect(C.tree, bx, by, bw, bh);
  for (const [bx, by] of [[x - 14, base - 44], [x - 11, base - 36], [x + 18, base - 50], [x + 16, base - 36], [x + 20, base - 33], [x - 10, base - 27]]) L.rect(C.tree, bx, by, 1, 3);
  return L;
}

function foreground() {
  const L = layer();
  // ground
  for (let x = 0; x < SCENE_W; x++) {
    const top = 94 + Math.round(1.5 * Math.sin(x / 9));
    L.rect(C.ground, x, top, 1, SCENE_H - top);
  }
  const r = rng(5);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * SCENE_W);
    const y = 95 + Math.floor(r() * 12);
    L.put(C.grass, x, y);
    L.put(C.grass, x, y - 1);
    if (i % 3 === 0) L.put(C.grass, x + 1, y - 2);
  }
  // far stones on the near hill
  headstone(L, 58, 86, 7, 9);
  headstone(L, 74, 85, 6, 8, { cross: true });
  cross(L, 96, 86, 11);
  headstone(L, 108, 88, 8, 10);
  headstone(L, 164, 87, 7, 9);
  // near stones, larger
  headstone(L, 44, 100, 12, 17, { cross: true, moss: true });
  headstone(L, 128, 102, 14, 20, { moss: true });
  cross(L, 82, 101, 18);
  headstone(L, 150, 100, 10, 14);
  headstone(L, 6, 100, 9, 12);
  // iron fence on the right
  for (let x = 170; x < SCENE_W; x += 4) {
    L.rect(C.fence, x, 80, 1, 18);
    L.put(C.fence, x, 78);
    L.put(C.fence, x - 1, 79);
    L.put(C.fence, x + 1, 79);
  }
  L.rect(C.fence, 168, 86, 24, 1);
  L.rect(C.fence, 168, 93, 24, 1);
  return L;
}

function fog(row: number, seed: number, opacityClass: string) {
  void opacityClass;
  const L = layer();
  const r = rng(seed);
  const color = "#6bb8b1";
  for (let i = 0; i < 9; i++) {
    const w = 18 + Math.floor(r() * 30);
    const x = Math.floor(r() * (SCENE_W + 60)) - 30;
    const y = row + Math.floor(r() * 3) * 2;
    L.rect(color, x, y, w, 2);
    L.rect(color, x + 4, y - 1, Math.max(2, w - 8), 1);
  }
  return L;
}

export type SceneLayer = { id: string; className: string; paths: { color: string; d: string }[] };

export function buildScene(): SceneLayer[] {
  return [
    { id: "sky", className: "", paths: toPaths(sky().cells) },
    { id: "stars-a", className: "scene-star scene-star-a", paths: toPaths(stars(0).cells) },
    { id: "stars-b", className: "scene-star scene-star-b", paths: toPaths(stars(1).cells) },
    { id: "stars-c", className: "scene-star scene-star-c", paths: toPaths(stars(2).cells) },
    { id: "moon", className: "", paths: toPaths(moon().cells) },
    { id: "hills", className: "", paths: toPaths(hills().cells) },
    { id: "tree", className: "", paths: toPaths(deadTree().cells) },
    { id: "fog-back", className: "scene-fog scene-fog-a", paths: toPaths(fog(72, 3, "a").cells) },
    { id: "ground", className: "", paths: toPaths(foreground().cells) },
    { id: "fog-front", className: "scene-fog scene-fog-b", paths: toPaths(fog(90, 9, "b").cells) },
  ];
}
