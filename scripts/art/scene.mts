/**
 * The haunted graveyard, authored as layered pixel art at the SAME pixel density as the ghost.
 * Canvas: 320 x 240 art pixels. The ghost stands on GROUND_Y. Light comes from the moon (upper right)
 * and a single lantern left of the ghost ("one lamp remains lit for a reader").
 * Layers (PNG, deterministic): sky, far, mid, near, fog (tileable), flames.
 * Run: node scripts/art/scene.mts
 */
import { Canvas, bayer, canvasPng, diff, ellipse, fill, line, mix, noise2, paint, poly, px, rect, rgb, rng, toHex, union, writeFile, type Pred } from "./kit.mts";

export const SW = 320;
export const SH = 240;
export const GROUND_Y = 192;
export const MOON = { x: 214, y: 56, r: 15 };
export const LAMP = { x: 106, y: 138 }; // the lantern's flame, in scene pixels

const OUT = "public/scene";
const NIGHT = ["#070913", "#0b0e1e", "#10152c", "#171e3d", "#1f284f", "#2a3562", "#364376"];

/* ---------------- sky ---------------- */
export function drawSky(): Canvas {
  const c = new Canvas(SW, SH);
  const stops = ["#05070f", "#080b18", "#0c1124", "#121a35", "#1a2447", "#25315c", "#34437a"];
  const horizon = 168;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const t = Math.min(1, y / horizon) ** 1.15 * (stops.length - 1);
    const i = Math.max(0, Math.min(stops.length - 1, Math.floor(t + 0.5 + bayer(x, y) * 0.9)));
    c.set(x, y, stops[i], 0);
  }
  // stars: many faint, a few bright with a cross glint
  const r = rng(404);
  for (let i = 0; i < 150; i++) {
    const x = Math.floor(r() * SW), y = Math.floor(Math.pow(r(), 1.5) * 130);
    if (Math.hypot(x - MOON.x, y - MOON.y) < MOON.r + 12) continue;
    const bright = r();
    c.set(x, y, bright > 0.92 ? "#fff4d8" : bright > 0.6 ? "#a9b7d6" : "#5d6a96", 0);
    if (bright > 0.95) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) c.set(x + dx, y + dy, "#8d9cc6", 0);
  }
  // clouds: soft banks of thresholded noise, three tones inside, lit from the moon, dithered edges
  const n = noise2(9);
  const dens = (x: number, y: number) => {
    const v = n(x * 0.02, y * 0.07) * 0.62 + n(x * 0.055, y * 0.15 + 5) * 0.28 + n(x * 0.14, y * 0.3 + 9) * 0.10;
    return y > 14 && y < 150 ? v - Math.max(0, (y - 95) * 0.004) : 0;
  };
  const THR = 0.6;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const d = dens(x, y);
    const edge = d - THR + (bayer(x, y) - 0.5) * 0.05;
    if (edge < 0) continue;
    const base = c.get(x, y)!;
    const glow = Math.max(0, 1 - Math.hypot(x - MOON.x, y - MOON.y) / 150);
    const topLit = dens(x, y - 2) < THR; // upper edge catches the light
    const tone = edge < 0.025 ? 0 : edge < 0.07 ? 1 : 2;
    const amt = [0.16, 0.26, 0.34][tone] + glow * 0.4 + (topLit ? 0.14 : 0);
    c.set(x, y, mix(base, tone === 2 ? "#0d1226" : "#7f96c4", tone === 2 ? 0.28 - glow * 0.2 : Math.min(0.85, amt)), 0);
  }
  // moon with halo
  for (let y = MOON.y - 46; y <= MOON.y + 46; y++) for (let x = MOON.x - 46; x <= MOON.x + 46; x++) {
    const d = Math.hypot(x + 0.5 - MOON.x, y + 0.5 - MOON.y);
    if (d <= MOON.r) continue;
    const ring = d <= MOON.r + 4 ? 0.5 : d <= MOON.r + 9 ? 0.32 : d <= MOON.r + 17 ? 0.18 : d <= MOON.r + 28 ? 0.08 : 0;
    if (ring && bayer(x, y) + 0.5 < ring * 2.4) c.set(x, y, mix(c.get(x, y) ?? "#1a2447", "#9fb4d6", ring * 0.8), 0);
  }
  const moonPix: Pred = ellipse(MOON.x, MOON.y, MOON.r, MOON.r);
  paint(c, 1, moonPix, ["#8f93a1", "#b7b6b8", "#dcd7cc", "#f3eee2", "#fffaf0"], { base: 3, blur: 6, k: 2.4, dither: 0.3, light: [0.7, -0.6] });
  for (const [dx, dy, rr] of [[-5, -4, 3], [4, 3, 2.4], [-3, 6, 2], [6, -6, 1.8], [0, -9, 1.6]] as [number, number, number][]) {
    fill(c, 1, ellipse(MOON.x + dx, MOON.y + dy, rr, rr * 0.85), "#a9a8ae");
    px(c, 1, [[Math.round(MOON.x + dx + rr * 0.5), Math.round(MOON.y + dy - rr * 0.5)]], "#d6d1c6");
  }
  return c;
}

/* ---------------- shared helpers ---------------- */
export const STONE = ["#0a0e1d", "#121932", "#1e2848", "#2e3c68", "#4a5d94"];
export const FAR = ["#0a0e1c", "#10162b", "#18213f", "#26325c"];

function stone(c: Canvas, part: number, x: number, base: number, w: number, h: number, kind: "round" | "cross" | "slab" | "obelisk", ramp = STONE, moss = true) {
  const top = base - h;
  let shape: Pred;
  if (kind === "round") shape = union(rect(x, top + w / 2, x + w - 1, base - 1), ellipse(x + w / 2, top + w / 2, w / 2, w / 2));
  else if (kind === "slab") shape = union(rect(x, top + 3, x + w - 1, base - 1), poly([[x, top + 3], [x + 3, top], [x + w - 4, top], [x + w, top + 3]]));
  else if (kind === "obelisk") shape = poly([[x + w * 0.3, top], [x + w * 0.7, top], [x + w, base], [x, base]]);
  else shape = union(rect(x + Math.floor(w / 2) - 1, top, x + Math.floor(w / 2) + 1, base - 1), rect(x, top + Math.floor(h * 0.25), x + w - 1, top + Math.floor(h * 0.25) + 2));
  // cast shadow on the ground, away from the moon
  fill(c, part - 1, ellipse(x + w / 2 - w * 0.35, base, w * 0.9, 1.6), mix(ramp[0], "#000000", 0.2), { under: [part] });
  paint(c, part, shape, ramp, { base: 2, blur: 3, k: 3, dither: 0.3 });
  // chips, cracks and an engraved cross or lines
  const r = rng(Math.round(x * 31 + base));
  if (kind !== "cross" && w >= 9) {
    const cx = x + Math.floor(w / 2);
    fill(c, part, rect(cx, top + 6, cx, top + 11), ramp[1]);
    fill(c, part, rect(cx - 2, top + 8, cx + 2, top + 8), ramp[1]);
    px(c, part, [[cx + 1, top + 6], [cx + 3, top + 8]], ramp[3]);
  }
  for (let i = 0; i < 2; i++) { const cx = x + 1 + Math.floor(r() * (w - 2)), cy = top + 3 + Math.floor(r() * (h - 6)); line(c, part, [cx, cy], [cx + 1 + Math.floor(r() * 2), cy + 2 + Math.floor(r() * 3)], ramp[0], { only: [part] }); }
  if (moss) for (let i = 0; i < w; i++) if (r() > 0.45) { c.set(x + i, base - 1, "#1f4a43", part); if (r() > 0.6) c.set(x + i, base - 2, "#2c6258", part); }
}

export function rim(c: Canvas, color: string, parts?: number[]) {
  const src = c.clone();
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const p = src.partAt(x, y);
    if (p < 0 || (parts && !parts.includes(p))) continue;
    if (src.partAt(x + 1, y - 1) < 0 || (src.partAt(x + 1, y) < 0 && src.partAt(x, y - 1) < 0)) c.set(x, y, mix(src.get(x, y)!, color, 0.55), p);
  }
}

/* ---------------- far ---------------- */
function drawFar(): Canvas {
  const c = new Canvas(SW, SH);
  const hill = (x: number) => Math.round(146 + 9 * Math.sin(x / 31 + 1) + 5 * Math.sin(x / 11) + 4 * Math.sin(x / 57 + 2));
  const hills: Pred = (x, y) => y >= hill(x);
  paint(c, 1, hills, FAR, { base: 1, blur: 5, k: 1.6, dither: 0.2 });
  // the ruined abbey: nave wall, a tower, a broken tower, pointed windows
  const abbey = union(
    rect(62, 112, 128, 150),
    poly([[62, 112], [70, 104], [78, 112]]),
    rect(70, 84, 86, 150), // tower
    poly([[70, 84], [73, 76], [76, 84]]), poly([[80, 84], [83, 80], [86, 84], [86, 90]]),
    rect(104, 92, 122, 150), // broken tower
    poly([[104, 92], [107, 86], [110, 92], [113, 88], [116, 96], [122, 92]]),
    rect(128, 118, 150, 150),
  );
  const abbeyCut = union(
    ellipse(77, 100, 2.2, 3.4), rect(75, 100, 79, 110), // pointed windows (cut-outs)
    ellipse(113, 108, 2.2, 3.4), rect(111, 108, 115, 118),
    ellipse(96, 128, 2.6, 4), rect(93.5, 128, 98.5, 140), ellipse(138, 130, 2, 3), rect(136, 130, 140, 140),
    poly([[118, 118], [124, 122], [128, 118], [128, 150], [118, 150]]),
  );
  paint(c, 2, diff(abbey, abbeyCut), ["#080b17", "#0e1328", "#171e3c", "#273360"], { base: 1, blur: 3, k: 2.4, dither: 0.2 });
  // faint warm glow inside two windows, as if something still reads there
  for (const [cx, cy] of [[77, 103], [96, 132]] as [number, number][]) {
    fill(c, 3, ellipse(cx, cy, 1.4, 2.4), "#6a5636");
    px(c, 3, [[cx, cy]], "#b7915a");
  }
  rim(c, "#7f94c4", [2]);
  // distant dead trees
  const r = rng(77);
  function branch(x: number, y: number, ang: number, len: number, depth: number) {
    if (depth <= 0 || len < 2) return;
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    line(c, 4, [x, y], [x2, y2], "#0a0e1d");
    if (depth > 2) line(c, 4, [x + 1, y], [x2 + 1, y2], "#0a0e1d");
    branch(x2, y2, ang + 0.5 + r() * 0.4, len * 0.72, depth - 1);
    branch(x2, y2, ang - 0.5 - r() * 0.4, len * 0.7, depth - 1);
  }
  for (const [x, base, len] of [[22, 152, 14], [40, 150, 10], [258, 150, 13], [290, 153, 16], [304, 152, 9]] as [number, number, number][]) branch(x, base, Math.PI / 2 + (r() - 0.5) * 0.3, len, 6);
  // far gravestones on the ridge
  for (const [x, b, w, h] of [[150, 152, 5, 8], [160, 153, 4, 7], [168, 152, 5, 9], [236, 154, 5, 8], [246, 153, 4, 7]] as [number, number, number, number][]) stone(c, 5, x, b, w, h, "round", FAR, false);
  return c;
}

/* ---------------- mid ---------------- */
function drawMid(): Canvas {
  const c = new Canvas(SW, SH);
  const ground = (x: number) => Math.round(172 + 4 * Math.sin(x / 23) + 2 * Math.sin(x / 8 + 1));
  paint(c, 1, (x, y) => y >= ground(x), ["#080b17", "#0d1226", "#141b36", "#1e2a50"], { base: 1, blur: 6, k: 1.8, dither: 0.25 });
  // iron fence running into the distance on both sides
  const bars = (x0: number, x1: number, yTop: number, yBot: number) => {
    for (let x = x0; x < x1; x += 4) {
      fill(c, 2, rect(x, yTop, x, yBot), "#05070f");
      px(c, 2, [[x, yTop - 1], [x - 1, yTop], [x + 1, yTop]], "#05070f");
      px(c, 2, [[x + 1, yTop + 1]], "#2b3764");
    }
    fill(c, 2, rect(x0, yTop + 5, x1, yTop + 5), "#05070f");
    fill(c, 2, rect(x0, yBot - 4, x1, yBot - 4), "#05070f");
  };
  bars(0, 74, 150, 178);
  bars(252, SW, 148, 178);
  // mid-ground stones, smaller and darker than the near ones
  const spots: [number, number, number, number, "round" | "cross" | "slab" | "obelisk"][] = [
    [150, 178, 8, 12, "round"], [176, 180, 10, 15, "slab"], [196, 177, 8, 13, "cross"], [226, 181, 9, 14, "round"], [132, 181, 7, 10, "round"], [88, 182, 9, 14, "obelisk"], [244, 182, 8, 12, "slab"],
  ];
  spots.forEach(([x, b, w, h, k], i) => stone(c, 3 + i, x, b, w, h, k, STONE.map((v) => mix(v, "#080b17", 0.2)), false));
  return c;
}

/* ---------------- near ---------------- */
export function drawNear(): Canvas {
  const c = new Canvas(SW, SH);
  const n = noise2(31);
  const ground = (x: number) => Math.round(GROUND_Y - 2 + 2.5 * Math.sin(x / 19 + 2) + 1.5 * Math.sin(x / 7));
  paint(c, 1, (x, y) => y >= ground(x), ["#070a14", "#0b101f", "#111a2e", "#1b283f", "#2c4153"], { base: 1, blur: 8, k: 1.5, dither: 0.3 });
  // ground texture: scattered soil flecks, stones, grass blades, fallen leaves
  const r = rng(12);
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(r() * SW), y = GROUND_Y + Math.floor(r() * (SH - GROUND_Y));
    if (c.partAt(x, y) !== 1) continue;
    const v = n(x * 0.2, y * 0.2);
    c.set(x, y, v > 0.55 ? "#1a2a3a" : v < 0.3 ? "#05080f" : "#0e1626", 1);
  }
  for (let i = 0; i < 150; i++) {
    const x = Math.floor(r() * SW), y = GROUND_Y - 1 + Math.floor(r() * 46);
    if (c.partAt(x, y) !== 1) continue;
    const h = 2 + Math.floor(r() * 3);
    const col = r() > 0.5 ? "#1c4a46" : "#143a3c";
    for (let k = 0; k < h; k++) c.set(x + (k > 1 ? 1 : 0), y - k, col, 2);
    c.set(x, y - h, "#2f7468", 2);
  }
  for (let i = 0; i < 24; i++) { const x = Math.floor(r() * SW), y = GROUND_Y + 4 + Math.floor(r() * 40); if (c.partAt(x, y) === 1) { c.set(x, y, "#5a3a2a", 3); c.set(x + 1, y, "#7a5030", 3); } }
  // worn path of pale stones leading toward the ghost
  for (let i = 0; i < 8; i++) {
    const y = GROUND_Y + 6 + i * 5, w = 8 + i * 2, x = 160 - w / 2 + Math.round(Math.sin(i * 1.7) * 6);
    fill(c, 4, ellipse(x + w / 2, y, w / 2, 2 + i * 0.25), ["#17233a", "#1d2c46", "#243553"][i % 3]);
    fill(c, 4, ellipse(x + w / 2 + 1, y - 1, w / 2 - 1, 1 + i * 0.15), "#2b3f63");
  }
  // framing tombstones, large and dark, lit on their right edges by the moon
  stone(c, 6, 6, GROUND_Y + 38, 30, 52, "round", STONE, true);
  stone(c, 8, 40, GROUND_Y + 30, 16, 26, "slab", STONE, true);
  stone(c, 10, 276, GROUND_Y + 40, 34, 56, "cross", STONE, true);
  stone(c, 12, 252, GROUND_Y + 30, 17, 24, "round", STONE, true);
  // the lantern post: a thin iron stand, a hook, a lantern with an open flame cage
  const post = "#05070f";
  fill(c, 14, rect(LAMP.x - 1, LAMP.y + 10, LAMP.x, GROUND_Y + 4), post);
  fill(c, 14, rect(LAMP.x - 3, GROUND_Y + 3, LAMP.x + 2, GROUND_Y + 5), post);
  fill(c, 14, rect(LAMP.x - 1, LAMP.y - 12, LAMP.x, LAMP.y - 6), post);
  line(c, 14, [LAMP.x, LAMP.y - 12], [LAMP.x + 6, LAMP.y - 8], post);
  fill(c, 14, rect(LAMP.x + 5, LAMP.y - 8, LAMP.x + 6, LAMP.y - 6), post);
  // lantern box hanging from the hook
  fill(c, 15, rect(LAMP.x - 4, LAMP.y - 6, LAMP.x + 5, LAMP.y + 9), "#10151f");
  fill(c, 15, rect(LAMP.x - 5, LAMP.y - 7, LAMP.x + 6, LAMP.y - 6), "#2a2f3d");
  fill(c, 15, rect(LAMP.x - 5, LAMP.y + 9, LAMP.x + 6, LAMP.y + 10), "#2a2f3d");
  fill(c, 15, rect(LAMP.x - 3, LAMP.y - 4, LAMP.x + 4, LAMP.y + 7), "#2b2318"); // glass, dark: the flame layer lights it
  for (const x of [LAMP.x - 4, LAMP.x + 5]) fill(c, 15, rect(x, LAMP.y - 5, x, LAMP.y + 8), "#3a4256");
  px(c, 15, [[LAMP.x - 1, LAMP.y - 8], [LAMP.x, LAMP.y - 8]], "#2a2f3d");
  rim(c, "#7f94c4", [6, 8, 10, 12]);
  return c;
}

/* ---------------- fog (tileable horizontally) ---------------- */
export function drawFog(): Canvas {
  const c = new Canvas(SW, 72);
  const n = noise2(88);
  for (let y = 0; y < 72; y++) for (let x = 0; x < SW; x++) {
    // sample noise on a torus so the tile repeats seamlessly
    const a = (x / SW) * Math.PI * 2;
    const v = n(Math.cos(a) * 6 + y * 0.01, Math.sin(a) * 6 + y * 0.14) * 0.7 + n(Math.cos(a) * 14 + 3, Math.sin(a) * 14 + y * 0.3) * 0.3;
    const band = Math.max(0, 1 - Math.abs(y - 42) / 26);
    const d = v * band;
    if (d + bayer(x, y) * 0.1 > 0.5) c.set(x, y, d > 0.6 ? "#9fbac6" : "#5f7f90", 1);
  }
  return c;
}

function drawFlames(): { warm: Canvas; ghostly: Canvas } {
  const make = (core: string, mid: string, edge: string) => {
    const c = new Canvas(9, 14);
    paint(c, 1, poly([[4.5, 0], [7, 6], [7.5, 10], [4.5, 13.5], [1.5, 10], [2, 6]]), [edge, mid, core, "#ffffff"], { base: 1, blur: 2, k: 2.2, dither: 0.2, light: [0, -1] });
    fill(c, 1, ellipse(4.5, 9, 1.6, 2.8), core);
    fill(c, 1, ellipse(4.5, 10, 0.9, 1.8), "#fff7d6");
    return c;
  };
  return { warm: make("#ffd98a", "#e4903a", "#7d3a1a"), ghostly: make("#a8f0e6", "#4fb0a8", "#1b5a60") };
}

/**
 * Horror grade: drain colour toward corpse-gray, darken, and cool the shadows.
 * Applied to every scenery layer so the world reads decayed rather than pretty.
 * `keepWarm` leaves strongly warm pixels (the lantern glass, abbey windows) mostly intact.
 */
export function grade(c: Canvas, sat = 0.6, dark = 0.74, keepWarm = true): Canvas {
  for (let i = 0; i < c.pix.length; i++) {
    const p = c.pix[i];
    if (!p) continue;
    const [r, g, b] = rgb(p);
    const warm = keepWarm && r > b + 28 && r > 70;
    const l = 0.3 * r + 0.59 * g + 0.11 * b;
    const k = warm ? 0.85 : sat;
    const dk = warm ? 0.9 : dark;
    // slight cold teal-gray tint in the shadows
    c.pix[i] = toHex([(l + (r - l) * k) * dk * 0.96, (l + (g - l) * k) * dk * 1.0 + 1, (l + (b - l) * k) * dk * 1.02 + 2]);
  }
  return c;
}

/** Dead branches reaching in from the top corners, in the nearest layer. */
export function deadBranches(c: Canvas) {
  const ink = "#04060b";
  const r = rng(515);
  function limb(x: number, y: number, ang: number, len: number, depth: number, part: number) {
    if (depth <= 0 || len < 2) return;
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    line(c, part, [x, y], [x2, y2], ink);
    if (depth > 3) line(c, part, [x, y + 1], [x2, y2 + 1], ink);
    limb(x2, y2, ang + 0.45 + r() * 0.5, len * 0.74, depth - 1, part);
    limb(x2, y2, ang - 0.35 - r() * 0.4, len * 0.7, depth - 1, part);
  }
  limb(-4, 6, 0.25, 34, 7, 16); // from upper left, drooping
  limb(-4, 30, 0.1, 22, 6, 16);
  limb(SW + 4, 2, Math.PI - 0.3, 38, 7, 17); // from upper right
  limb(SW + 4, 26, Math.PI - 0.15, 20, 6, 17);
}

/** A tall, thin, wrong shape on the far ridge. Faint on purpose: easy to miss, hard to unsee. */
function ridgeFigure(c: Canvas) {
  const x = 232, base = 150;
  const col = "#05070f";
  fill(c, 6, rect(x, base - 30, x + 1, base - 4), col); // body, too long
  fill(c, 6, ellipse(x + 0.5, base - 32, 1.8, 2.4), col); // head
  line(c, 6, [x, base - 24], [x - 4, base - 8], col); // arms hanging past the knees
  line(c, 6, [x + 1, base - 24], [x + 5, base - 7], col);
  fill(c, 6, rect(x - 1, base - 4, x + 2, base), col);
}

export function buildScene() {
  const far = drawFar();
  ridgeFigure(far);
  const near = drawNear();
  deadBranches(near);
  writeFile(`${OUT}/sky.png`, canvasPng(grade(drawSky(), 0.55, 0.78, false)));
  writeFile(`${OUT}/far.png`, canvasPng(grade(far, 0.5, 0.8)));
  writeFile(`${OUT}/mid.png`, canvasPng(grade(drawMid(), 0.5, 0.8)));
  writeFile(`${OUT}/near.png`, canvasPng(grade(near, 0.5, 0.85)));
  writeFile(`${OUT}/fog.png`, canvasPng(grade(drawFog(), 0.4, 0.8, false)));
  const f = drawFlames();
  writeFile(`${OUT}/flame-warm.png`, canvasPng(f.warm));
  writeFile(`${OUT}/flame-ghostly.png`, canvasPng(f.ghostly));
  // preview composite at 3x
  const comp = new Canvas(SW, SH);
  for (const layer of [grade(drawSky(), 0.55, 0.78, false), grade(far, 0.5, 0.8), grade(drawMid(), 0.5, 0.8), grade(near, 0.5, 0.85)]) for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = layer.get(x, y); if (v) comp.set(x, y, v); }
  const fog = drawFog();
  for (let y = 0; y < 72; y++) for (let x = 0; x < SW; x++) { const v = fog.get(x, y); if (v) comp.set(x, 150 + y, mix(comp.get(x, 150 + y) ?? "#000000", v, 0.2)); }
  writeFile("/tmp/gitghost-art/scene.png", canvasPng(comp, 3));
}

if (process.argv[1]?.endsWith("scene.mts")) {
  buildScene();
  console.log("wrote", OUT);
}
void NIGHT;
