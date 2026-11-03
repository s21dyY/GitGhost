/**
 * GitGhost's Archivist ghost. Original pixel art, authored in code on the same 64 x 80 grid
 * as the production sprites and reusing their body, book, hood and clasp (scripts/art/archivist.mts).
 * Output goes to public/sprites/ghosts/.
 *
 * Everything is driven by one morph value t:  0 = human, 0.5 = distorted, 1 = horror.
 * The three forms and the transformation frames are the SAME generator at different t, so every
 * intermediate frame is a real point on the way from the person to the thing.
 *
 * Run: node scripts/art/ghost-archivist.mts        (writes sprites to public/sprites/ghosts and previews to /tmp/gitghost-art)
 */
import { Canvas, canvasPng, diff, ellipse, fill, inter, line, mix, noise2, outline, paint, poly, px, rect, rng, union, writeFile, type Pred, type Pt } from "./kit.mts";
import { HORROR, INK, ORDER, P, W, H, drawBody, drawHairFront, dissolve, addScraps, head as humanHead, type Look } from "./archivist.mts";
import { lookFor } from "./archivist.mts";

export type Form = "human" | "distorted" | "horror";
export type Expr = "neutral" | "melancholy" | "amused" | "angry" | "disturbed" | "eldritch";
export type State = "idle" | "speak" | "blink" | "twitchA" | "twitchB" | "freeze";
export const FORMS: Form[] = ["human", "distorted", "horror"];
export const EXPRS: Expr[] = ["neutral", "melancholy", "amused", "angry", "disturbed", "eldritch"];
export const STATES: State[] = ["idle", "speak", "blink", "twitchA", "twitchB", "freeze"];
export const FORM_T: Record<Form, number> = { human: 0, distorted: 0.5, horror: 1 };

/* ---------- part ids (head canvas and body share them) ---------- */
const SK = P.head, HR = P.hairFront;
export const FL = 20, TH = 21, EY = 22, BL = 23, VN = 24, PG = 25, GR = 26, VD = 27, TD = 28;
Object.assign(ORDER, { [FL]: 4.1, [TH]: 4.3, [EY]: 4.2, [BL]: -1, [VN]: 4.05, [PG]: 5.3, [GR]: 3.5, [VD]: 4.15, [TD]: 0.5 });
const SEP = [P.coat, P.neck, P.collar, SK, P.hairBack, P.sleeveL, P.sleeveR, P.book, P.hands, P.pages, HR, PG, VD, TD];

/* ---------- palette ---------- */
export const FLESH = ["#1d070c", "#3d0f19", "#661a27", "#8c2a38", "#b0485a"];
export const TEETH = ["#625a46", "#9a9279", "#c9c2a5", "#ebe5cb"];
export const BLOOD = ["#2a0409", "#58080f", "#86101b", "#b81f2c"];
export const VEIN = "#150a1c";
const VEIN_RED = "#4a0c1e";

function mixLook(a: Look, b: Look, t: number): Look {
  const arr = (x: string[], y: string[]) => x.map((v, i) => mix(v, y[i], t));
  return {
    skin: arr(a.skin, b.skin), hair: arr(a.hair, b.hair), coat: arr(a.coat, b.coat), paper: arr(a.paper, b.paper), cover: arr(a.cover, b.cover), brass: arr(a.brass, b.brass),
    iris: mix(a.iris, b.iris, t), sclera: mix(a.sclera, b.sclera, t), lid: mix(a.lid, b.lid, t), ring: mix(a.ring, b.ring, t), brow: mix(a.brow, b.brow, t),
    mouth: mix(a.mouth, b.mouth, t), lip: mix(a.lip, b.lip, t), outer: mix(a.outer, b.outer, t),
  };
}
/** A colder, greener, more necrotic skin for the final form. */
/** The last form is not rotting flesh: it is something wearing the person. Pale, cold, violet, and bloodless. */
const NECRO: Look = {
  ...HORROR,
  skin: ["#15121f", "#2a2740", "#4f4a6e", "#7a7598", "#a6a2c2"],
  coat: ["#080612", "#120d26", "#1f1840", "#32285e", "#4d3f86"],
  sclera: "#e6e0c0", iris: "#7ff0d6", ring: "#1c1040", lip: "#4f4a6e", mouth: "#15121f",
};
export function ghostLook(t: number): Look {
  const hum = lookFor("human"), dis = lookFor("distorted");
  return t <= 0.5 ? mixLook(hum, dis, t / 0.5) : mixLook(dis, NECRO, (t - 0.5) / 0.5);
}

/* ---------- the morph: numeric face spec at t ---------- */
type Spec = {
  cx: number; cy: number; rx: number; ry: number; taper: number; lean: number; bulge: number;
  eLx: number; eLy: number; eLrx: number; eLry: number; eRx: number; eRy: number; eRrx: number; eRry: number;
  mx: number; my: number; mw: number; mh: number;
  veins: number; flesh: number; split: number; extra: number; tongue: number; bleed: number; bruise: number; growth: number;
};
const K: Spec[] = [
  // human: the original face, a little more tired
  { cx: 32, cy: 21.5, rx: 10.8, ry: 13, taper: 0.36, lean: 0, bulge: 0, eLx: 27.5, eLy: 20.5, eLrx: 3.5, eLry: 2.3, eRx: 36.5, eRy: 21.5, eRrx: 3.5, eRry: 2.3, mx: 32, my: 29.5, mw: 6, mh: 4, veins: 0, flesh: 0, split: 0, extra: 0, tongue: 0, bleed: 0, bruise: 0.25, growth: 0 },
  // distorted: long face, one huge low eye, one tiny high eye, a jaw that hangs
  { cx: 32, cy: 24.5, rx: 10.2, ry: 16, taper: 0.46, lean: 0.07, bulge: 0, eLx: 28, eLy: 24, eLrx: 4.7, eLry: 3.9, eRx: 37.5, eRy: 17.2, eRrx: 2.7, eRry: 1.6, mx: 31, my: 32, mw: 9.5, mh: 7, veins: 0.7, flesh: 0.55, split: 0, extra: 0, tongue: 0, bleed: 0.8, bruise: 0.75, growth: 0.45 },
  // eldritch: no gore left. The head is long and smooth and the face is a void with eyes in it (drawVoid)
  { cx: 32, cy: 24.5, rx: 10, ry: 16.5, taper: 0.4, lean: 0, bulge: 0, eLx: 28, eLy: 24, eLrx: 4.7, eLry: 3.9, eRx: 37.5, eRy: 17.2, eRrx: 2.7, eRry: 1.6, mx: 32, my: 32, mw: 9.5, mh: 7, veins: 0, flesh: 0, split: 0, extra: 0, tongue: 0, bleed: 0, bruise: 0.2, growth: 0 },
];
function lerpSpec(a: Spec, b: Spec, t: number): Spec {
  const o = {} as Spec;
  for (const k of Object.keys(a) as (keyof Spec)[]) o[k] = a[k] + (b[k] - a[k]) * t;
  return o;
}
export const specAt = (t: number): Spec => (t <= 0.5 ? lerpSpec(K[0], K[1], t / 0.5) : lerpSpec(K[1], K[2], (t - 0.5) / 0.5));

/* ---------- expressions ---------- */
export type Ex = { lid: [number, number]; brow: [number, number]; lift: [number, number]; pup: [number, number]; ps: number; curve: number; open: number; teeth: boolean; glow: boolean; vslit: boolean; extraOpen: boolean; tear: boolean; cav: number };
export const EX: Record<Expr, Ex> = {
  neutral: { lid: [0.38, 0.38], brow: [0, 0], lift: [0, 0], pup: [0, 0.1], ps: 1, curve: 0, open: 0, teeth: false, glow: false, vslit: false, extraOpen: false, tear: false, cav: 0.8 },
  melancholy: { lid: [0.55, 0.5], brow: [-1.6, -1.6], lift: [0, 0], pup: [0.1, 0.7], ps: 1, curve: -1.8, open: 0, teeth: false, glow: false, vslit: false, extraOpen: false, tear: true, cav: 0.55 },
  amused: { lid: [0.3, 0.5], brow: [0.4, -0.5], lift: [-1, -2], pup: [0.2, -0.1], ps: 0.9, curve: 3, open: 0.4, teeth: true, glow: false, vslit: false, extraOpen: false, tear: false, cav: 0.9 },
  angry: { lid: [0.62, 0.62], brow: [2.2, 2.2], lift: [1, 1], pup: [0, 0], ps: 0.7, curve: -1.2, open: 0.5, teeth: true, glow: false, vslit: false, extraOpen: false, tear: false, cav: 0.68 },
  disturbed: { lid: [0, 0], brow: [-0.8, -0.8], lift: [-1.8, -1.8], pup: [0, 0], ps: 0.5, curve: 0, open: 0.75, teeth: true, glow: false, vslit: false, extraOpen: false, tear: true, cav: 1 },
  eldritch: { lid: [0, 0.05], brow: [0, 0], lift: [-1.5, -1], pup: [0, 0], ps: 1, curve: 1.2, open: 1, teeth: true, glow: true, vslit: true, extraOpen: true, tear: false, cav: 1 },
};

/* ---------- head pieces ---------- */
function skullPred(s: Spec): Pred {
  const body: Pred = (x, y) => {
    const dy = (y + 0.5 - s.cy) / s.ry;
    if (Math.abs(dy) > 1) return false;
    const w = s.rx * Math.sqrt(1 - dy * dy) * (dy > 0 ? 1 - s.taper * dy : 1);
    return Math.abs(x + 0.5 - (s.cx + s.lean * (y - s.cy))) <= w;
  };
  return s.bulge > 0.02 ? union(body, ellipse(39.5, 19.5, 6.8 * s.bulge, 7.4 * s.bulge)) : body;
}

type EyeBox = { x: number; y: number; rx: number; ry: number };
type EyeOpt = { lid: number; tilt: number; pdx: number; pdy: number; ps: number; glow: boolean; vslit: boolean; bloodshot: number; ring: number; tint?: string; catchLight?: boolean; softLid?: boolean };

/** One eyeball: sclera, iris, pupil, a lid cutting across the top, a dark rim, and a bruised ring beneath. */
export function drawEye(c: Canvas, L: Look, e: EyeBox, o: EyeOpt, part = EY) {
  const { x: cx, y: cy, rx, ry } = e;
  const sclera = o.tint ?? L.sclera;
  const iris = o.glow ? "#7ff0d6" : L.iris;
  const inEye = ellipse(cx, cy, rx, ry);
  const ringed = ellipse(cx, cy, rx + 1.4, ry + 1.3);
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
    if (!inEye(x, y) && ringed(x, y) && c.partAt(x, y) >= 0 && y + 0.5 > cy - ry * 0.4) c.set(x, y, mix(c.get(x, y)!, L.ring, 0.22 + 0.5 * o.ring), c.partAt(x, y));
  }
  const lidY = (x: number) => cy - ry + o.lid * 2 * ry + o.tilt * (x + 0.5 - cx);
  const irisR = Math.min(rx, ry * 1.3) * 0.8;
  const px0 = cx + o.pdx * rx * 0.45, py0 = cy + o.pdy * ry * 0.45;
  const r = rng(Math.round(cx * 7 + cy * 13));
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
    if (!inEye(x, y)) continue;
    // a person's lid is skin, lit like the cheek; a changed lid is dark and wet
    if (y + 0.5 < lidY(x)) { c.set(x, y, o.softLid ? mix(L.skin[2], L.lid, 0.3) : mix(L.lid, INK, 0.3), part); continue; }
    let col = sclera;
    if (o.bloodshot > 0 && r() < 0.14 * o.bloodshot) col = mix(sclera, "#8a1c2c", 0.6);
    const di = ((x + 0.5 - px0) / (irisR * (o.vslit ? 0.85 : 1))) ** 2 + ((y + 0.5 - py0) / (irisR * (o.vslit ? 1.35 : 1))) ** 2;
    if (di <= 1) {
      col = di > 0.55 ? mix(iris, INK, 0.25) : iris;
      const pr = irisR * 0.5 * o.ps;
      const dp = o.vslit ? Math.abs(x + 0.5 - px0) <= Math.max(0.5, 0.4 * o.ps) && Math.abs(y + 0.5 - py0) <= ry * 0.95 : ((x + 0.5 - px0) / pr) ** 2 + ((y + 0.5 - py0) / pr) ** 2 <= 1;
      if (dp) col = INK;
    }
    c.set(x, y, col, part);
  }
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
    if (!inEye(x, y)) continue;
    const edge = !inEye(x + 1, y) || !inEye(x - 1, y) || !inEye(x, y + 1) || !inEye(x, y - 1);
    if (o.softLid && y + 0.5 < lidY(x)) continue; // a skin lid has no hard rim
    if (edge && c.partAt(x, y) === part) c.set(x, y, mix(c.get(x, y)!, INK, o.softLid ? 0.4 : 0.6), part);
  }
  for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const y = Math.round(lidY(x));
    if (!o.softLid && o.lid > 0.05 && (inEye(x, y) || inEye(x, y - 1))) c.set(x, y - 1, INK, part);
  }
  // a closed soft lid shows its lashes along the bottom
  if (o.softLid && o.lid >= 0.9) for (let x = Math.floor(cx - rx + 0.5); x <= Math.ceil(cx + rx - 1.5); x++) c.set(x, Math.round(cy + ry * 0.55), mix(INK, L.skin[1], 0.35), part);
  if (o.catchLight && !o.vslit && o.lid < 0.7 && rx >= 2) c.set(Math.round(px0 - irisR * 0.45), Math.round(py0 - irisR * 0.5), "#ffffff", part);
  if (o.glow) for (const [dx, dy] of [[-rx - 1, 0], [rx + 1, 0], [0, -ry - 1], [0, ry + 1]] as Pt[]) {
    const x = Math.round(cx + dx), y = Math.round(cy + dy);
    if (c.partAt(x, y) >= 0) c.set(x, y, mix(c.get(x, y)!, "#7ff0d6", 0.55), c.partAt(x, y));
  }
}

/** An eye that has been sewn shut: a swollen lid, a black seam, short vertical stitches. */
export function drawStitchedEye(c: Canvas, L: Look, e: EyeBox, weep: boolean) {
  const lid = ellipse(e.x, e.y, e.rx + 1.2, e.ry + 1.6);
  for (let y = Math.floor(e.y - e.ry - 3); y <= Math.ceil(e.y + e.ry + 3); y++) for (let x = Math.floor(e.x - e.rx - 3); x <= Math.ceil(e.x + e.rx + 3); x++) {
    if (lid(x, y) && c.partAt(x, y) >= 0) c.set(x, y, mix(L.skin[2], FLESH[3], 0.4), SK);
  }
  const y0 = Math.round(e.y);
  for (let x = Math.floor(e.x - e.rx - 1); x <= Math.ceil(e.x + e.rx + 1); x++) c.set(x, y0, VEIN, EY);
  for (let x = Math.floor(e.x - e.rx); x <= Math.ceil(e.x + e.rx); x += 2) {
    c.set(x, y0 - 2, VEIN, EY); c.set(x, y0 - 1, TEETH[2], EY); c.set(x, y0, TEETH[3], EY); c.set(x, y0 + 1, TEETH[2], EY); c.set(x, y0 + 2, VEIN, EY);
  }
  if (weep) for (let i = 2; i < 6; i++) c.set(Math.round(e.x + 1), y0 + i, i > 4 ? BLOOD[3] : BLOOD[2], BL);
}

function drawBrow(c: Canvas, a: Pt, b: Pt, color: string, thick = 2) {
  line(c, SK, a, b, color);
  if (thick > 1) line(c, SK, [a[0], a[1] + 1], [b[0], b[1] + 1], color);
}

/** Mouth: lips, cavity, teeth. `open` is 0..1 of the form's cavity height; `curve` raises or drops the corners. */
function drawMouth(c: Canvas, L: Look, s: Spec, e: Ex, open: number, teeth: boolean, jawDx: number, stitchy: boolean) {
  const cx = s.mx + jawDx, y0 = Math.round(s.my);
  const hw = s.mw / 2;
  const cavH = Math.round(open * s.mh);
  const cornerY = (x: number) => Math.round((Math.abs(x + 0.5 - cx) / hw) ** 1.4 * -e.curve * 0.9 + (s.my > 30 ? (x + 0.5 - cx) * -0.1 : 0));
  const x0 = Math.floor(cx - hw), x1 = Math.ceil(cx + hw);
  if (cavH <= 0) {
    for (let x = x0; x <= x1; x++) {
      const yy = y0 + cornerY(x);
      c.set(x, yy, L.mouth, SK);
      c.set(x, yy - 1, mix(L.lip, L.skin[1], 0.6), SK);
      if (Math.abs(x + 0.5 - cx) < hw * 0.6) c.set(x, yy + 1, mix(L.lip, L.skin[1], 0.35), SK);
    }
    if (stitchy) for (let x = x0 + 1; x <= x1 - 1; x += 2) { const yy = y0 + cornerY(x); c.set(x, yy - 1, VEIN, SK); c.set(x, yy + 1, VEIN, SK); c.set(x, yy - 2, L.paper[1], SK); }
    return;
  }
  for (let x = x0; x <= x1; x++) {
    const u = (x + 0.5 - cx) / hw;
    if (Math.abs(u) > 1) continue;
    const top = y0 + cornerY(x);
    const hh = Math.max(1, Math.round(cavH * (1 - u * u) ** 0.7));
    for (let y = top; y < top + hh; y++) c.set(x, y, y > top + hh - 2 && hh > 3 ? FLESH[2] : FLESH[0], GR);
    if (teeth && hh >= 3) {
      const tw = hh >= 6 ? 2 : 1;
      for (let k = 0; k < tw; k++) c.set(x, top + k, (x + k) % 3 === 0 ? TEETH[1] : TEETH[3 - (k % 2)], TH);
      if (hh >= 5) for (let k = 0; k < tw; k++) c.set(x, top + hh - 1 - k, (x * 2 + k) % 5 === 0 ? TEETH[0] : x % 2 ? TEETH[2] : TEETH[1], TH);
    }
    c.set(x, top - 1, L.mouth, SK);
  }
  // torn stitches hang from the corners of an open mouth
  if (stitchy) for (const x of [x0, x0 + 2, x1, x1 - 2]) { c.set(x, y0 + cornerY(x) - 1, VEIN, SK); c.set(x, y0 + cornerY(x) + 1, VEIN, SK); c.set(x, y0 + cornerY(x) + 2, L.paper[1], SK); }
  if (hw > 3 && cavH >= 4) px(c, GR, [[Math.round(cx), y0 + Math.round(cavH * 0.6)]], FLESH[3]);
}

function veinWalk(c: Canvas, from: Pt, dir: number, len: number, seed: number, color: string, within: Pred) {
  const r = rng(seed);
  let [x, y] = from, a = dir;
  for (let i = 0; i < len; i++) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a); y += Math.sin(a);
    const X = Math.round(x), Y = Math.round(y);
    if (!within(X, Y)) break;
    if (c.partAt(X, Y) === SK) c.set(X, Y, color, VN);
  }
}

/** Exposed muscle on the right cheek, with the teeth showing through the hole. */
function drawCheekWound(c: Canvas, s: Spec, skull: Pred) {
  if (s.flesh < 0.1 || s.split > 0.4) return;
  const n = noise2(3);
  const k = Math.min(1, s.flesh * 1.3);
  const cx = 37.2 + s.lean * 4, cy = 25.6;
  const wound: Pred = (x, y) => skull(x, y) && Math.hypot((x - cx) * 0.95, (y - cy) * 1.1) < 4.9 * k * (0.8 + 0.4 * n(x * 0.45, y * 0.45));
  paint(c, FL, wound, FLESH, { base: 2, blur: 2, k: 2.2, dither: 0.25 });
  // the hole: dark, with a row of teeth bared through it
  if (k > 0.5) {
    const hx = Math.round(cx - 2), hy = Math.round(cy - 1);
    fill(c, GR, rect(hx, hy, hx + 4, hy + 2), FLESH[0]);
    for (let x = hx; x <= hx + 4; x++) { c.set(x, hy, x % 2 ? TEETH[3] : TEETH[2], TH); c.set(x, hy + 2, x % 2 ? TEETH[1] : TEETH[2], TH); }
  }
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.partAt(x, y) === SK && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => c.partAt(x + dx, y + dy) === FL)) c.set(x, y, mix(c.get(x, y)!, FLESH[1], 0.65), SK);
}

/** The opened face: a wound along the spine of the face that widens until the right half is a cavity of eyes and teeth. */
function drawOpenFace(c: Canvas, L: Look, s: Spec, e: Ex, skull: Pred) {
  if (s.split < 0.05) return;
  const top = 10.5, bot = Math.round(s.my);
  const xb = (y: number) => 31 + Math.sin(y * 0.62) * 0.9 + (y - top) * 0.02;
  const edge = (y: number) => { for (let x = 52; x > 20; x--) if (skull(x, y)) return x; return 0; };
  const rows: { lb: number; rb: number; y: number }[] = [];
  for (let y = Math.ceil(top); y <= bot; y++) {
    const lb = Math.round(xb(y));
    const re = edge(y) - 1;
    const shape = Math.sin((Math.PI * (y - top)) / (bot - top)) ** 0.5;
    const f = Math.min(1, s.split * (0.3 + 0.8 * shape) * e.cav + (e.glow ? 0.06 : 0));
    const rb = lb + Math.round((re - lb) * f);
    rows.push({ lb, rb, y });
    for (let x = lb - 1; x <= rb + 1; x++) {
      if (!skull(x, y) && x <= rb) continue;
      if (x === lb - 1 || x === rb + 1) c.set(x, y, FLESH[3], FL);
      else {
        const depth = Math.abs(x - (lb + rb) / 2) / Math.max(1, (rb - lb) / 2);
        c.set(x, y, depth > 0.75 ? FLESH[1] : "#240a10", GR);
        if ((x * 7 + y * 3) % 13 === 0) c.set(x, y, FLESH[2], GR);
        if (e.glow && depth < 0.5 && (x + y) % 4 === 0) c.set(x, y, mix("#240a10", "#2f9d8f", 0.5), GR);
      }
    }
  }
  // teeth along the left wall, and a few on the far lip
  const tr = rng(77);
  let skip = 0;
  for (const { lb, rb, y } of rows) {
    if (rb - lb < 3) continue;
    if (skip-- > 0) continue;
    const len = 1 + Math.floor(tr() * 3);
    skip = 1 + Math.floor(tr() * 2);
    for (let k = 0; k < len; k++) c.set(lb + k, y, k === 0 ? TEETH[3] : TEETH[2 - Math.min(2, k - 1)], TH);
    if (tr() < 0.5) c.set(lb, y + 1, TEETH[2], TH);
    if (tr() < 0.4 && rb - lb > 7) { c.set(rb, y, TEETH[2], TH); c.set(rb - 1, y, TEETH[1], TH); }
  }
}

/** Eyes that opened inside the wound. They shut and open with the expression. */
function drawCavityEyes(c: Canvas, L: Look, s: Spec, e: Ex, lidBase: number) {
  if (s.split < 0.45) return;
  const eyes: [EyeBox, number, number][] = [
    [{ x: 37.2, y: 17.6, rx: 3.9, ry: 3.7 }, 0.5, 0.2],
    [{ x: 40.6, y: 25.4, rx: 2.7, ry: 2.5 }, 0.7, -0.1],
    [{ x: 35.0, y: 25.8, rx: 1.9, ry: 1.8 }, 0.85, 0.15],
    [{ x: 42.2, y: 12.6, rx: 1.6, ry: 1.5 }, 0.95, -0.2],
  ];
  eyes.forEach(([box, need, tilt]) => {
    if (s.split < need) return;
    drawEye(c, L, box, { lid: e.extraOpen || lidBase < 0.1 ? 0 : e.lid[1] >= 0.45 ? e.lid[1] * 0.8 : 0, tilt, pdx: -0.3, pdy: 0.3, ps: 0.8, glow: e.glow, vslit: e.vslit, bloodshot: 0.7, ring: 0.4, tint: "#ece6b8" });
  });
}

/** Paper tongue: a strip of the Archivist's own pages hanging from the maw to the book. */
function drawTongue(c: Canvas, L: Look, s: Spec, sway: number) {
  if (s.tongue < 0.2) return;
  const len = Math.round(5 + 8 * s.tongue);
  const x0 = Math.round(s.mx - 1);
  for (let i = 0; i < len; i++) {
    const y = Math.round(s.my + 2 + i), wob = Math.round(Math.sin(i * 0.7 + sway) * 1.2);
    const w = i < 2 ? 3 : i > len - 3 ? 3 : 4;
    const soaked = i < Math.round(len * 0.55);
    for (let k = 0; k < w; k++) {
      const x = x0 + wob + k;
      let col = k === 0 ? L.paper[3] : k === w - 1 ? L.paper[1] : L.paper[2];
      if (i % 3 === 2 && k > 0 && k < w - 1) col = L.paper[0];
      if (soaked) col = mix(col, BLOOD[2], k === w - 1 ? 0.85 : 0.6);
      c.set(x, y, col, PG);
    }
  }
}

/** Split skin: dark fissures from the hood edge into the forehead and temple, each with a wet red lip. */
function drawCracks(c: Canvas, s: Spec, skull: Pred) {
  const k = s.flesh;
  if (k < 0.2) return;
  const cracks: [Pt, number, number, number][] = [[[29, 13], 1.25, 7, 31], [[35, 12], 1.9, 6, 32], [[24, 22], 0.35, 5, 33]];
  for (const [from, dir, len, seed] of cracks) {
    const r = rng(seed);
    let [x, y] = from, a = dir;
    for (let i = 0; i < Math.round(len * Math.min(1, k * 1.6)); i++) {
      a += (r() - 0.5) * 1.1;
      x += Math.cos(a); y += Math.sin(a);
      const X = Math.round(x), Y = Math.round(y);
      if (!skull(X, Y) || c.partAt(X, Y) !== SK) continue;
      c.set(X, Y, FLESH[0], VN);
      if (c.partAt(X + 1, Y) === SK) c.set(X + 1, Y, FLESH[3], VN);
    }
  }
}

/** Blood on the face: a tear from the large eye and a trickle from the mouth. */
function drawFaceBlood(c: Canvas, s: Spec, e: Ex) {
  if (s.bleed < 0.1) return;
  const r = rng(91);
  const len = Math.round((5 + 8 * s.bleed) * (e.tear ? 1.35 : 0.9));
  let x = Math.round(s.eLx - 1);
  for (let i = 0; i < len; i++) {
    const y = Math.round(s.eLy + s.eLry + 1 + i);
    if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
    c.set(x, y, i % 4 === 3 ? BLOOD[1] : BLOOD[2], BL);
    if (i < len - 2 && i % 3 === 0) c.set(x + 1, y, BLOOD[0], BL);
  }
  const ey = Math.round(s.eLy + s.eLry + len);
  px(c, BL, [[x, ey], [x, ey + 1], [x - 1, ey + 1]], BLOOD[3]);
  const mxr = Math.round(s.mx - s.mw / 2 + 1);
  const mlen = Math.round(4 + 7 * s.bleed);
  for (let i = 0; i < mlen; i++) {
    const y = Math.round(s.my + 2 + i), xx = mxr + (i > 3 ? 1 : 0) + (i > 7 ? -1 : 0);
    c.set(xx, y, i > mlen - 3 ? BLOOD[3] : BLOOD[2], BL);
    if (i % 2 === 0) c.set(xx + 1, y, BLOOD[1], BL);
  }
}

/** Hood: open the forehead for brows, clear the eyes, pull the hair off the swollen half, stain the edge. */
function hoodEdit(c: Canvas, s: Spec, L: Look) {
  const clearIf = (f: (x: number, y: number) => boolean) => { for (let y = 8; y < 40; y++) for (let x = 18; x < 50; x++) if (c.partAt(x, y) === HR && f(x, y)) c.set(x, y, null, -1); };
  clearIf((x, y) => x >= 26 && x <= 38 && y >= 12.5 + Math.abs(x - 32) * 0.45 && y <= 17); // forehead and brows, in an arch
  clearIf((x, y) => x >= s.eLx - s.eLrx - 0.8 && x <= s.eLx + s.eLrx + 1 && Math.abs(y - s.eLy) <= s.eLry + 4.5); // the large eye and its brow
  if (s.bulge > 0.05) clearIf((x, y) => x >= 31 && x < 46 && y >= 10 && y <= 31);
  else if (s.eRy < 20) clearIf((x, y) => x >= s.eRx - s.eRrx - 1 && x <= s.eRx + s.eRrx + 1.5 && y >= 12 && y <= 22);
  if (s.eRy > 20) clearIf((x, y) => x >= s.eRx - s.eRrx - 1 && x <= s.eRx + s.eRrx + 1.5 && Math.abs(y - s.eRy) <= s.eRry + 2);
  line(c, HR, [27, 9], [22, 24], L.hair[3], { only: [HR] });
  line(c, HR, [28, 9], [23, 25], L.hair[0], { only: [HR] });
  line(c, HR, [37, 9], [41, 22], L.hair[3], { only: [HR] });
  if (s.bleed > 0.3) for (let y = 14; y < 34; y++) for (const x of [24, 25, 26]) if (c.partAt(x, y) === HR && (x + y) % 4 === 0) c.set(x, y, BLOOD[1], HR);
}

/** Hollows under the cheekbones and the brow, bruised sockets and a few spots of rot. No random noise. */
function decay(c: Canvas, L: Look, s: Spec, skull: Pred) {
  const sk = L.skin;
  const lean = s.cx - 32;
  px(c, SK, [[23, 26], [24, 27], [24, 28], [25, 29], [26, 30], [38, 30], [39, 28], [40, 27]].map(([x, y]) => [x + lean, y] as Pt), sk[0]);
  if (s.bruise > 0.5) {
    for (const [x, y] of [[26, 30], [27, 31], [36, 33], [28, 34], [30, 35]] as Pt[]) if (skull(x, y)) c.set(x, y, mix(sk[1], "#33423a", 0.7), SK);
    for (const [x, y] of [[34, 31], [29, 29], [25, 24]] as Pt[]) if (skull(x, y) && c.partAt(x, y) === SK) c.set(x, y, "#2b1d2a", SK);
  }
}

/** 0 until the face starts to empty (t = 0.5), 1 when it has. */
export const voidAt = (t: number) => Math.max(0, Math.min(1, (t - 0.5) * 2));

/**
 * The eldritch face: the skin around it stays, the face itself is a pocket of night with a few stars in it and
 * eyes that do not belong to a face. No teeth, no blood, no flesh. It grows with t so the change reads as an emptying.
 */
function drawVoid(c: Canvas, L: Look, s: Spec, e: Ex, t: number, blink: boolean, life: Life = {}) {
  const v = voidAt(t);
  if (v < 0.12) return;
  const cx = 32 + (s.cx - 32), cy = 22.5;
  const rx = 8.7 * v, ry = 12 * v;
  const inV = ellipse(cx, cy, rx, ry);
  const n = noise2(41), r = rng(5);
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
    if (c.partAt(x, y) < 0) continue;
    if (inV(x, y)) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      let col = mix("#03010a", "#1a0f38", Math.min(1, d * d));
      const cloud = n(x * 0.5, y * 0.5);
      if (cloud > 0.62 && (x + y) % 2 === 0) col = mix(col, "#3a2478", 0.6);
      if (r() < 0.04) {
        const star = r() < 0.5 ? "#a8f0ff" : "#d8c8ff";
        // a star is dark on one frame in five, each on its own beat, so the void glitters rather than flashes
        const off = life.twinkle !== undefined && (x * 31 + y * 17 + life.twinkle * 7) % 5 === 0;
        if (!off) col = star;
      }
      c.set(x, y, col, VD);
    } else if (inV(x + 1, y) || inV(x - 1, y) || inV(x, y + 1) || inV(x, y - 1)) {
      c.set(x, y, mix(L.skin[1], "#3a2a6a", 0.55), VD); // a thin, wet-looking rim
    }
  }
  // eyes that open as the void widens; the first is the largest and stands upright like a slit
  const eyes: { dx: number; dy: number; rx: number; ry: number; need: number; slit: boolean; tilt: number }[] = [
    { dx: 0, dy: 0.5, rx: 4.1, ry: 3.8, need: 0.3, slit: true, tilt: 0 },
    { dx: -4.3, dy: -6.2, rx: 2.4, ry: 2.2, need: 0.5, slit: false, tilt: 0.12 },
    { dx: 4.5, dy: -5.4, rx: 2.6, ry: 2.4, need: 0.55, slit: false, tilt: -0.1 },
    { dx: -4.3, dy: 5.8, rx: 2.2, ry: 2.0, need: 0.7, slit: false, tilt: -0.1 },
    { dx: 4.6, dy: 5.2, rx: 2.4, ry: 2.2, need: 0.72, slit: true, tilt: 0.1 },
  ];
  eyes.forEach((k, i) => {
    if (v < k.need) return;
    const grow = Math.min(1, (v - k.need) / 0.2 + 0.35);
    const lid = blink ? 1 : life.voidLid?.(i) ?? (e.extraOpen ? 0 : Math.min(0.55, e.lid[0] * 0.6));
    drawEye(c, L, { x: cx + k.dx * v, y: cy + k.dy * v, rx: Math.max(1.1, k.rx * v * grow), ry: Math.max(1.1, k.ry * v * grow) }, {
      lid, tilt: k.tilt - e.brow[0] * 0.04, pdx: e.pup[0] * 0.8, pdy: e.pup[1] * 0.8, ps: e.ps, glow: true, vslit: k.slit, bloodshot: 0, ring: 0, tint: "#ece6c4", catchLight: false,
    }, VD);
  });
  // ichor, not blood: thin violet-black runs from the bottom of the void down the chin
  if (v > 0.6) {
    const bottom = Math.round(cy + ry);
    for (const [dx, len] of [[-3, 5], [1, 7], [4, 4]] as Pt[]) {
      const x = Math.round(cx + dx);
      for (let i = 0; i < Math.round(len * v); i++) {
        const y = bottom + i;
        if (c.partAt(x, y) < 0) break;
        c.set(x, y, i === 0 ? TEND[3] : i % 3 === 2 ? TEND[2] : TEND[1], VD);
      }
      const end = bottom + Math.round(len * v);
      if (c.partAt(x, end) >= 0) c.set(x, end, TEND[0], VD);
    }
  }
}

/**
 * Per-frame life for the idle loop. Every field is optional and defaults to the still pose, so the atlas,
 * the transformation strip and the tests draw exactly what they did before this was added.
 */
export type Life = {
  breath?: number; // rows the chest, arms and book rise (0 or 1)
  headDy?: number; // extra vertical head offset, lagging the chest
  pulse?: number; // -1..1, swells the shoulder growth
  sway?: number; // radians, moves the shroud hem and tendrils
  twinkle?: number; // frame number, switches void stars on and off
  voidLid?: (eye: number) => number | undefined; // per-eye lid for the void and shroud eyes
  glitch?: { y0: number; y1: number; dx: number }[]; // horizontal scan-line tears, after the outline
  float?: number; // whole-figure vertical offset (the eldritch form hovers)
  frame?: number; // the idle frame, for props that keep their own beat (a lantern, a tail); the Archivist ignores it
};

export type HeadOpts = { t: number; expr: Expr; state: State; blink?: boolean; open?: number; look?: Partial<Ex>; gazeCamera?: boolean; life?: Life };

/** All the head pieces on their own canvas (so the head can move relative to the body). */
export function drawHead(o: HeadOpts): Canvas {
  const s = specAt(o.t);
  const L = ghostLook(o.t);
  const e: Ex = { ...EX[o.expr], ...(o.look ?? {}) };
  const c = new Canvas(W, H);
  const skull = skullPred(s);
  paint(c, SK, skull, L.skin, { base: 2, blur: 5, k: 2.6, dither: 0.2 });
  decay(c, L, s, skull);
  if (o.t < 0.05) {
    px(c, SK, [[32, 22], [32, 23], [32, 24]], L.skin[3]);
    px(c, SK, [[31, 25], [33, 25]], L.skin[0]);
    px(c, SK, [[32, 25], [30, 24]], L.skin[1]);
  } else if (s.split < 0.6) {
    px(c, SK, [[31, 26], [33, 26], [31, 27], [33, 27]], INK);
    px(c, SK, [[32, 23], [32, 24], [32, 25]], mix(L.skin[2], VEIN, 0.4));
  }
  drawCheekWound(c, s, skull);
  drawOpenFace(c, L, s, e, skull);
  drawCracks(c, s, skull);
  if (s.veins > 0.05) {
    const len = Math.round(3 + 8 * s.veins);
    veinWalk(c, [s.eLx - 1, s.eLy + s.eLry], 2.0, len, 11, VEIN, skull);
    veinWalk(c, [s.eLx - 3, s.eLy], 2.7, len - 2, 12, VEIN_RED, skull);
    if (s.split < 0.5) veinWalk(c, [s.eRx, s.eRy + s.eRry], 1.3, len - 1, 13, VEIN, skull);
  }
  const blink = o.blink === true;
  const v = voidAt(o.t);
  const pdx = o.gazeCamera ? 0 : e.pup[0], pdy = o.gazeCamera ? 0 : e.pup[1];
  const pinprick = 1 - 0.6 * Math.min(1, o.t * 2);
  const base: Omit<EyeOpt, "lid" | "tilt"> = { softLid: o.t < 0.2, pdx, pdy, ps: (o.gazeCamera ? 1.2 : e.ps) * pinprick, glow: e.glow, vslit: e.vslit, bloodshot: 0.2 + 0.7 * s.bruise, ring: s.bruise };
  const lidL = blink ? 1 : e.lid[0] * (1 - 0.45 * Math.min(1, o.t * 2));
  const eL = { x: s.eLx, y: s.eLy + e.lift[0] * 0.15, rx: s.eLrx, ry: s.eLry };
  if (v < 0.6) drawEye(c, L, eL, { ...base, lid: lidL, tilt: -e.brow[0] * 0.07, catchLight: true });
  // the right eye: normal in the person, closing as the face changes, sewn shut in the distorted form, gone in the opened face
  const sewn = o.t >= 0.36 && s.split < 0.25;
  if (s.split < 0.45 && v < 0.6) {
    const eR = { x: s.eRx, y: s.eRy + e.lift[1] * 0.15, rx: s.eRrx, ry: s.eRry };
    if (sewn) drawStitchedEye(c, L, eR, s.bleed > 0.5 || o.expr === "melancholy" || o.expr === "disturbed");
    else {
      const closing = Math.max(0, Math.min(1, (o.t - 0.2) / 0.16));
      drawEye(c, L, eR, { ...base, lid: blink ? 1 : Math.max(e.lid[1], closing * 0.85), tilt: e.brow[1] * 0.07 });
    }
  }
  drawCavityEyes(c, L, s, e, blink ? 1 : e.lid[0]);
  const open = o.open ?? e.open;
  const jawDx = s.my > 30 ? -1 : 0;
  if (v < 0.3) drawMouth(c, L, s, e, open, e.teeth || open > 0.3, jawDx, s.flesh > 0.3);
  drawTongue(c, L, s, o.state === "twitchA" ? 1 : o.state === "twitchB" ? 3 : 0);
  drawFaceBlood(c, s, e);
  if (s.bleed > 0.5 && v < 0.3) {
    // a nosebleed: two thin runs from the nostrils, the left one longer
    for (const [x, len] of [[31, 4], [33, 2]] as Pt[]) for (let i = 0; i < len; i++) c.set(x, 28 + i, i === len - 1 ? BLOOD[3] : BLOOD[2], BL);
  }
  drawHairFront(c, L);
  hoodEdit(c, s, L);
  drawVoid(c, L, s, e, o.t, blink, o.life);
  // brows go on last, over the hood, so the expression always reads
  if (s.split < 0.55 && v < 0.35) {
    const up = o.t < 0.2 ? 1 : 0;
    const bl = Math.round(s.eLy - s.eLry - 2.2 - up + e.lift[0]);
    const br = Math.round(s.eRy - s.eRry - 2.2 - up + e.lift[1]);
    const lx0 = Math.round(s.eLx - s.eLrx), lx1 = Math.round(s.eLx + s.eLrx - 1);
    const rx0 = Math.round(s.eRx - s.eRrx), rx1 = Math.round(s.eRx + s.eRrx - 1);
    // brow[i] > 0: inner end drops (anger); < 0: inner end rises (grief)
    drawBrow(c, [lx0, bl - Math.round(e.brow[0] * 0.5)], [lx1, bl + Math.round(e.brow[0])], L.brow, o.t < 0.2 ? 1 : 2);
    if (!sewn) drawBrow(c, [rx0, br + Math.round(e.brow[1])], [rx1, br - Math.round(e.brow[1] * 0.5)], L.brow, o.t > 0.3 || o.t < 0.2 ? 1 : 2);
    else drawBrow(c, [rx0, br + 1 + Math.round(e.brow[1] * 0.6)], [rx1, br + 1], L.brow, 1);
    if (o.expr === "angry" || o.expr === "disturbed") px(c, SK, [[29, bl - 1], [30, bl - 1], [31, bl - 1], [29, bl - 2]].map(([x, y]) => [x + (s.cx - 32), y] as Pt), mix(L.skin[2], INK, 0.45));
  }
  return c;
}

/* ---------- tendrils (eldritch only) ---------- */
export const TEND = ["#120b26", "#2a1f58", "#4a3a8c", "#7d6bd0"];
export function tendril(c: Canvas, x0: number, y0: number, a0: number, curl: number, len: number, r0: number, phase: number, grow: number) {
  const steps = Math.round(len * grow);
  let x = x0, y = y0, a = a0;
  for (let i = 0; i < steps; i++) {
    a += curl + Math.sin(i * 0.33 + phase) * 0.09;
    x += Math.cos(a) * 0.7; y += Math.sin(a) * 0.7;
    const r = Math.max(0.7, r0 * (1 - i / len) + 0.5);
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d > r || (c.partAt(xx, yy) >= 0 && ORDER[c.partAt(xx, yy)] >= 1)) continue;
      const lit = (xx + 0.5 - x) * -0.6 + (yy + 0.5 - y) * -0.8; // light from the upper left
      c.set(xx, yy, TEND[d > r - 0.7 ? 0 : lit > r * 0.25 ? 3 : lit > -r * 0.2 ? 2 : 1], TD);
    }
    // pale suckers along the inner curve
    if (i % 4 === 2 && r > 1.2) {
      const nx = -Math.sin(a) * Math.sign(curl || 1) * (r - 0.4), ny = Math.cos(a) * Math.sign(curl || 1) * (r - 0.4);
      const sx = Math.round(x + nx), sy = Math.round(y + ny);
      if (sx >= 0 && sy >= 0 && sx < W && sy < H && c.partAt(sx, sy) === TD) c.set(sx, sy, "#d9ccf2", TD);
    }
  }
}
function drawTendrils(c: Canvas, t: number, sway = 0) {
  const v = voidAt(t);
  if (v < 0.3) return;
  const g = Math.min(1, (v - 0.3) / 0.6);
  // behind the shoulders, curling up beside the head; none of them crosses the face or the book
  tendril(c, 12, 66, -1.9, 0.045, 54, 4.2, 0.0 + sway, g);
  tendril(c, 9, 74, -2.35, 0.05, 44, 3.0, 1.7 + sway, g);
  tendril(c, 52, 64, -1.25, -0.04, 56, 4.2, 2.4 + sway, g);
  tendril(c, 55, 73, -0.85, -0.055, 42, 2.8, 4.1 + sway, g);
}

/* ---------- gore on the body (the gory form only) ---------- */
/** Spatter on the coat, a gash across the throat, and blood running off the hem into the air below it. */
function drawGore(c: Canvas, k: number) {
  if (k < 0.3) return;
  const on = (x: number, y: number, parts: number[]) => parts.includes(c.partAt(x, y));
  // spatter: small clusters thrown across the chest, sleeves and book, heavier toward the wound side
  const r = rng(404);
  for (let i = 0; i < Math.round(26 * k); i++) {
    const x = Math.round(18 + r() * 30 + (r() < 0.4 ? 6 : 0)), y = Math.round(40 + r() * 22);
    if (!on(x, y, [P.coat, P.sleeveL, P.sleeveR, P.book, P.collar])) continue;
    c.set(x, y, r() < 0.3 ? BLOOD[3] : BLOOD[2], BL);
    if (r() < 0.45 && on(x + 1, y, [P.coat, P.sleeveL, P.sleeveR, P.book])) c.set(x + 1, y, BLOOD[1], BL);
    if (r() < 0.3 && on(x, y + 1, [P.coat, P.sleeveL, P.sleeveR, P.book])) c.set(x, y + 1, BLOOD[1], BL);
  }
  // the throat: a ragged gash with a lip of raw flesh, and two runs down onto the collar
  for (let x = 28; x <= 36; x++) {
    const y = 35 + (x % 3 === 0 ? 1 : 0);
    if (!on(x, y, [P.neck, P.collar])) continue;
    c.set(x, y, FLESH[0], FL);
    if (on(x, y - 1, [P.neck])) c.set(x, y - 1, FLESH[3], FL);
  }
  for (const [x, len] of [[30, 6], [34, 4]] as Pt[]) for (let i = 1; i <= len; i++) if (c.partAt(x, 35 + i) >= 0) c.set(x, 35 + i, i === len ? BLOOD[3] : BLOOD[2], BL);
  // blood runs off the hem: drops hang below the cloth, each ending in a bright bead
  for (const [x, len] of [[19, 3], [26, 5], [33, 2], [40, 4], [46, 3]] as Pt[]) {
    let bottom = -1;
    for (let y = H - 1; y > 50; y--) if (c.partAt(x, y) === P.coat || c.partAt(x, y) === BL) { bottom = y; break; }
    if (bottom < 0) continue;
    for (let i = 1; i <= len && bottom + i < H - 1; i++) c.set(x, bottom + i, i === len ? BLOOD[3] : BLOOD[2], BL);
  }
}

/* ---------- body ---------- */
const bodyCache = new Map<number, Canvas>();
export function drawBodyV4(t: number, life: Life = {}): Canvas {
  // only the still pose is cached; idle-loop frames vary with their life
  const still = life.sway === undefined && life.pulse === undefined && life.voidLid === undefined;
  const key = Math.round(t * 1000);
  const hit = still ? bodyCache.get(key) : undefined;
  if (hit) return hit.clone();
  const s = specAt(t);
  const L = ghostLook(t);
  const c = new Canvas(W, H);
  drawBody(c, L, t < 0.05 ? "human" : "distorted");
  drawTendrils(c, t, life.sway ?? 0);
  // Distinct silhouettes at the three story stages. The Archivist's book and
  // face are deliberately left unobscured: at t=1 the coat becomes a loose
  // spectral shroud with negative-space tears rather than a bloodier human.
  const otherness = Math.min(1, Math.max(0, (t - 0.53) / 0.47));
  if (otherness > 0.01) {
    const leftShroud = poly([[16, 39], [11, 43], [7, 49], [3, 57], [9, 55], [5, 67], [13, 62], [10, 76], [20, 65], [21, 48]]);
    const rightShroud = poly([[46, 38], [53, 42], [57, 49], [61, 56], [54, 55], [60, 69], [51, 64], [55, 76], [43, 66], [42, 46]]);
    const shroudRamp = [L.coat[0], L.coat[1], L.coat[2], L.coat[3], L.skin[3]];
    // Gradually reveal the shroud during intermediate transformation frames.
    const reveal = (x: number, y: number) => ((x * 13 + y * 7) % 23) / 23 < otherness;
    // the hem drifts in a wind nobody else feels: the lower the cloth, the further it moves
    const drift = (y: number) => (life.sway === undefined ? 0 : Math.round(Math.sin(life.sway + y * 0.18) * Math.max(0, y - 44) / 22));
    paint(c, TD, (x, y) => leftShroud(x + drift(y), y) && reveal(x + drift(y), y), shroudRamp, { base: 1, blur: 2, k: 2.0 });
    paint(c, TD, (x, y) => rightShroud(x - drift(y), y) && reveal(x - drift(y), y), shroudRamp, { base: 1, blur: 2, k: 2.0 });
    if (otherness > 0.6) {
      // Hollow rents that read as missing cloth, not yet more red wounds.
      for (const tear of [ellipse(11, 55, 2.4, 4), ellipse(54, 58, 2.5, 5), ellipse(14, 67, 2, 4)])
        for (let y = 40; y < 76; y++) for (let x = 2; x < 62; x++)
          if (tear(x,y) && c.partAt(x,y) === TD) c.set(x,y,null,-1);
      line(c, TD, [11, 45], [5, 57], shroudRamp[4], { only: [TD] });
      line(c, TD, [54, 44], [60, 57], shroudRamp[3], { only: [TD] });
      // something looks out through the holes in the cloth
      const holes: EyeBox[] = [{ x: 11, y: 55.5, rx: 1.6, ry: 1.5 }, { x: 54, y: 58.5, rx: 1.7, ry: 1.6 }, { x: 14, y: 67.5, rx: 1.3, ry: 1.3 }];
      holes.forEach((box, i) => {
        if (otherness < 0.75 + i * 0.08) return;
        drawEye(c, L, box, { lid: life.voidLid?.(5 + i) ?? 0.15, tilt: 0, pdx: 0.2, pdy: 0, ps: 0.9, glow: true, vslit: true, bloodshot: 0, ring: 0, tint: "#ece6c4" }, TD);
      });
    }
  }
  // a boil on the right shoulder that grows an eye
  if (s.growth > 0.1) {
    const swell = 1 + 0.12 * (life.pulse ?? 0);
    const g = ellipse(46.2, 43.5, (2.5 + 2.6 * s.growth) * swell, (3 + 2.8 * s.growth) * swell);
    paint(c, FL, g, FLESH, { base: 2, blur: 2, k: 2, dither: 0.3 });
    for (let i = 0; i < 4; i++) c.set(Math.round(44 + i * 1.5), Math.round(40 + (i % 2) * 5), FLESH[4], FL);
    if (s.growth > 0.7) drawEye(c, L, { x: 47, y: 43.5, rx: 2.3, ry: 2.2 }, { lid: 0.6, tilt: 0, pdx: -0.3, pdy: 0.3, ps: 0.8, glow: false, vslit: false, bloodshot: 0.8, ring: 0.6, tint: "#d9d4a8" });
    veinWalk(c, [43, 41], 0.4, 6, 71, VEIN, (x, y) => c.partAt(x, y) === P.coat || c.partAt(x, y) === P.sleeveR);
  }
  // blood: it runs from the mouth down the collar and soaks the page edge, then drips down the coat
  if (s.bleed > 0.1) {
    // pages: soaked red toward the bottom
    const wet = Math.round(14 * s.bleed);
    for (let y = 58 - wet; y <= 58; y++) for (const xx of [41, 42]) if (c.partAt(xx, y) === P.pages) c.set(xx, y, (y + xx) % 3 === 0 ? BLOOD[3] : BLOOD[2], BL);
    // streaks off the page edge onto the coat
    const streaks: [number, number][] = [[41, 12], [43, 8], [39, 6]];
    for (const [sx, len] of streaks) for (let i = 0; i < Math.round(len * s.bleed); i++) { const y = 59 + i; if (c.partAt(sx, y) === P.coat) c.set(sx, y, i % 4 === 3 ? BLOOD[1] : BLOOD[2], BL); }
    // blood on the knuckles
    for (const [kx, ky] of [[24, 46], [25, 45], [39, 46], [38, 45], [26, 44]] as Pt[]) if (c.partAt(kx, ky) === P.hands) c.set(kx, ky, BLOOD[2], BL);
    // wet hem
    for (let xx = 14; xx < 52; xx += 3) { const y = 73 + ((xx * 5) % 4); if (c.partAt(xx, y) === P.coat) c.set(xx, y, BLOOD[1], BL); }
    drawGore(c, s.bleed);
  }
  if (t >= 0.05) {
    dissolve(c, t < 0.75 ? 62 : 58, 1.35 + 0.55 * Math.max(0, t - 0.5) * 2, t < 0.75 ? 11 : 23);
    addScraps(c, L, t < 0.75 ? [[8, 60, 3, 4], [53, 52, 3, 3], [12, 70, 2, 2]] : [[6, 30, 4, 5], [54, 24, 3, 4], [9, 58, 3, 3], [52, 66, 3, 3]]);
  }
  bodyCache.set(key, c.clone());
  return c;
}

/* ---------- compose a frame ---------- */
export type Move = { dx: number; dy: number; shear: number };
export const MOVES: Record<State, Move> = {
  idle: { dx: 0, dy: 0, shear: 0 },
  speak: { dx: 0, dy: 0, shear: 0 },
  blink: { dx: 0, dy: 0, shear: 0 },
  twitchA: { dx: -3, dy: 1, shear: -0.27 },
  twitchB: { dx: 3, dy: -1, shear: 0.3 },
  freeze: { dx: 2, dy: 1, shear: 0.44 },
};

function finish(c: Canvas, L: Look) {
  outline(c, { outer: () => L.outer, inner: (_p, col) => mix(col, L.outer, 0.62), order: (p) => ORDER[p] ?? p, sepParts: SEP });
}

/** Rows 0..upTo-1 rise by `by` pixels; the row at upTo stretches to close the gap (the hem stays put). */
export function lift(c: Canvas, upTo: number, by: number) {
  if (by <= 0) return;
  for (let y = 0; y < upTo; y++) for (let x = 0; x < c.w; x++) c.set(x, y, c.get(x, y + by), c.partAt(x, y + by));
}

/** Wet blood: a bright catch-light where a run starts, a dark clotted edge on its shadow side. */
export function wetBlood(c: Canvas) {
  const src = c.clone();
  const isBlood = (x: number, y: number) => src.partAt(x, y) === BL;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!isBlood(x, y)) continue;
    // only runs get shading; lone specks stay as they are
    const run = isBlood(x, y + 1) || isBlood(x, y - 1);
    if (!run) continue;
    if (!isBlood(x, y - 1) && !isBlood(x - 1, y)) c.set(x, y, "#e2606b", BL);
    else if (!isBlood(x + 1, y) && !isBlood(x, y + 1) && src.get(x, y) !== BLOOD[3]) c.set(x, y, BLOOD[0], BL);
  }
}

/** Moonlight from the upper left catches the top and left edges of the cloth and the hood. */
const RIM_PARTS = [P.coat, P.hairBack, P.hairFront, P.sleeveL, TD];
export function rimLight(c: Canvas, t: number, parts: number[] = RIM_PARTS) {
  const moon = t > 0.6 ? "#9d8ae0" : "#8fa6c8";
  const src = c.clone();
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!parts.includes(src.partAt(x, y))) continue;
    if (src.partAt(x - 1, y) < 0 || src.partAt(x, y - 1) < 0) c.set(x, y, mix(src.get(x, y)!, moon, 0.38), src.partAt(x, y));
  }
}

/** Scan-line tears: a few rows of the finished frame jump sideways, outline and all. */
export function tear(c: Canvas, bands: { y0: number; y1: number; dx: number }[]) {
  for (const { y0, y1, dx } of bands) for (let y = y0; y <= y1; y++) {
    const row = Array.from({ length: c.w }, (_, x) => [c.get(x, y), c.partAt(x, y)] as const);
    for (let x = 0; x < c.w; x++) { const [col, part] = row[x - dx] ?? [null, -1]; c.set(x, y, col, col ? part : -1); }
  }
}

export function shiftY(c: Canvas, dy: number): Canvas {
  if (!dy) return c;
  const o = new Canvas(c.w, c.h);
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) { const v = c.get(x, y); if (v) o.set(x, y + dy, v, c.partAt(x, y)); }
  return o;
}

export function drawFrame(t: number, expr: Expr, state: State, extra: { move?: Move; open?: number; blink?: boolean; look?: Partial<Ex>; life?: Life } = {}): Canvas {
  const L = ghostLook(t);
  const life = extra.life ?? {};
  const body = drawBodyV4(t, life);
  lift(body, 62, life.breath ?? 0);
  const mv0 = extra.move ?? MOVES[state];
  const mv = { ...mv0, dy: mv0.dy - (life.breath ?? 0) - (life.headDy ?? 0) };
  const head = drawHead({
    t, expr, state,
    blink: extra.blink ?? state === "blink",
    open: extra.open ?? (state === "speak" ? Math.min(1, EX[expr].open + 0.55) : state === "twitchB" ? Math.max(EX[expr].open, 0.5) : state === "freeze" ? Math.max(EX[expr].open, 0.4) : undefined),
    gazeCamera: state === "freeze",
    look: extra.look,
    life,
  });
  const pivot = 24;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = head.partAt(x, y);
    if (p < 0) continue;
    body.set(x + mv.dx + Math.round(mv.shear * (y - pivot)), y + mv.dy, head.get(x, y), p);
  }
  if (t > 0.15 && t < 0.85) wetBlood(body);
  rimLight(body, t);
  finish(body, L);
  if (life.glitch) tear(body, life.glitch);
  return shiftY(body, life.float ?? 0);
}

/* ---------- animation 1: blood drip strips ---------- */
export const DRIP = { w: 8, frames: 13, fallA: 8, fallB: 12 };
export function dripStrip(fall: number, frames: number): Canvas {
  const fh = fall + 7;
  const strip = new Canvas(DRIP.w * frames, fh);
  const put = (f: number, x: number, y: number, col: string) => strip.set(f * DRIP.w + x, y, col, 1);
  const bead = (f: number, y: number, h: number) => {
    // a bead 3 wide: dark rim, red body, one bright catch-light
    for (let k = 0; k < h; k++) {
      put(f, 2, y + k, BLOOD[1]); put(f, 4, y + k, BLOOD[1]);
      put(f, 3, y + k, BLOOD[k === 1 ? 3 : 2]);
    }
    put(f, 3, y + h, BLOOD[1]);
  };
  for (let f = 0; f < frames; f++) {
    const fallStart = 4;
    if (f < fallStart) {
      // forming: a thread, then a bead that swells and hangs
      const h = [1, 2, 3, 4][f];
      for (let y = 0; y < 2; y++) put(f, 3, y, BLOOD[2]);
      bead(f, 1, h);
    } else if (f < fallStart + 6) {
      const k = f - fallStart + 1;
      const y = Math.round(2 + (fall - 3) * ((k / 6) ** 2));
      if (k <= 2) { put(f, 3, 0, BLOOD[1]); put(f, 3, 1, BLOOD[2]); } // the thread snaps back
      bead(f, y, 3);
    } else if (f === fallStart + 6) {
      // impact: a flat smear, flecks thrown up
      const y = fall + 2;
      for (let x = 0; x < 8; x++) put(f, x, y + (x === 0 || x === 7 ? 1 : 0), x % 2 ? BLOOD[3] : BLOOD[2]);
      put(f, 1, y - 2, BLOOD[2]); put(f, 6, y - 3, BLOOD[3]); put(f, 3, y - 1, BLOOD[1]); put(f, 4, y - 2, BLOOD[2]);
    } else if (f === fallStart + 7) {
      const y = fall + 2;
      for (let x = 1; x < 7; x++) put(f, x, y, BLOOD[1]);
      put(f, 0, y + 1, BLOOD[0]); put(f, 7, y + 1, BLOOD[0]);
    }
  }
  return strip;
}

/* ---------- animation 3: the transformation ---------- */
export type TFrame = { t: number; expr: Expr; move: Move; open?: number; blink?: boolean; ms: number; note: string };
export const TRANSFORM: TFrame[] = [
  { t: 0.0, expr: "neutral", move: MOVES.idle, ms: 700, note: "the person" },
  { t: 0.06, expr: "melancholy", move: { dx: 0, dy: 1, shear: 0.04 }, ms: 260, note: "something is wrong behind the eyes" },
  { t: 0.14, expr: "disturbed", move: { dx: -1, dy: 0, shear: -0.1 }, ms: 160, note: "the first flinch" },
  { t: 0.24, expr: "disturbed", move: { dx: 2, dy: 1, shear: 0.2 }, open: 0.9, ms: 150, note: "the eyes drift apart" },
  { t: 0.34, expr: "disturbed", move: { dx: -2, dy: 0, shear: -0.2 }, open: 1, ms: 150, note: "the jaw gives" },
  { t: 0.44, expr: "angry", move: { dx: 1, dy: 1, shear: 0.14 }, open: 0.8, ms: 190, note: "veins; the face stretches" },
  { t: 0.5, expr: "neutral", move: { dx: 1, dy: 0, shear: 0.3 }, ms: 380, note: "distorted: it stops. It looks at you." },
  { t: 0.6, expr: "disturbed", move: { dx: -1, dy: 0, shear: -0.18 }, open: 0.9, ms: 170, note: "the skin goes slack" },
  { t: 0.72, expr: "disturbed", move: { dx: 2, dy: -1, shear: 0.22 }, open: 1, ms: 170, note: "the face empties" },
  { t: 0.84, expr: "eldritch", move: { dx: -1, dy: 1, shear: -0.12 }, open: 1, ms: 190, note: "new eyes open" },
  { t: 0.94, expr: "eldritch", move: { dx: 0, dy: 0, shear: 0.06 }, ms: 190, note: "it settles" },
  { t: 1.0, expr: "neutral", move: MOVES.idle, ms: 700, note: "eldritch" },
];

/* ---------- animation 4: the idle loop ---------- */
/**
 * 24 frames that play on a loop while the ghost waits. Each form has its own life:
 *   human:     slow breathing with the head a beat behind the chest, a glance aside, one blink.
 *   distorted: ragged, hitching breath, a twitch with scan-line tears, the shoulder growth pulsing, a heavy blink.
 *   horror:    no breath; it hovers, the shroud drifts, stars in the void glitter and its eyes blink out of step.
 */
export const IDLE = { frames: 24, ms: 180 };
const within = (f: number, a: number, b: number) => (f >= a && f <= b ? 1 : 0);

/** What one idle frame asks of the figure. The other ghosts (ghost-variants.mts) play the same schedule. */
export type IdlePlan = { move?: Move; blink?: boolean; look: Partial<Ex>; life: Life };

export function idlePlan(t: number, expr: Expr, f: number): IdlePlan {
  const ph = (f / IDLE.frames) * Math.PI * 2;
  const base = EX[expr];
  if (t < 0.25) {
    const breath = within(f, 6, 17);
    const head = within(f, 8, 19);
    const look: Partial<Ex> = {};
    if (f >= 9 && f <= 13) look.pup = [-0.7, 0.1];
    if (f === 19 || f === 21) look.lid = [Math.max(0.75, base.lid[0]), Math.max(0.75, base.lid[1])];
    return { blink: f === 20, look, life: { breath, headDy: head - breath, frame: f } };
  }
  if (t < 0.75) {
    const breath = within(f, 3, 8) || within(f, 13, 15);
    const look: Partial<Ex> = {};
    if (f === 5 || f === 6) look.pup = [0.45, -0.2];
    if (f === 21) look.lid = [1.35, 1.35];
    const glitch = f === 11 ? [{ y0: 18, y1: 20, dx: 2 }] : f === 17 ? [{ y0: 27, y1: 28, dx: -2 }, { y0: 52, y1: 52, dx: 1 }] : undefined;
    const move = f === 11 ? { dx: 1, dy: 0, shear: 0.12 } : f === 12 ? { dx: -1, dy: 0, shear: -0.05 } : undefined;
    return { move, blink: f === 22, look, life: { breath, pulse: Math.sin(ph * 2), glitch, frame: f } };
  }
  const voidLid = (eye: number) => {
    const start = (eye * 5 + 2) % IDLE.frames;
    const k = (f - start + IDLE.frames) % IDLE.frames;
    return k === 0 || k === 1 ? 1 : k === 2 ? 0.6 : undefined;
  };
  return { look: {}, life: { float: -within(f, 12, 23), sway: ph, twinkle: f, voidLid, glitch: f === 7 ? [{ y0: 14, y1: 15, dx: 2 }] : undefined, frame: f } };
}

export function idleFrame(t: number, expr: Expr, f: number): Canvas {
  const plan = idlePlan(t, expr, f);
  return drawFrame(t, expr, "idle", { move: plan.move, blink: plan.blink, look: plan.look, life: plan.life });
}

/* ---------- build ---------- */
export function buildAll() {
  const OUT = "public/sprites/ghosts";
  const PREV = "/tmp/gitghost-art";
  const manifest: Record<string, unknown> = { width: W, height: H, forms: FORMS, exprs: EXPRS, states: STATES, cols: EXPRS.length, rows: STATES.length };
  for (const form of FORMS) {
    const atlas = new Canvas(W * EXPRS.length, H * STATES.length);
    EXPRS.forEach((expr, col) => STATES.forEach((state, row) => {
      const f = drawFrame(FORM_T[form], expr, state);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f.get(x, y); if (v) atlas.set(col * W + x, row * H + y, v); }
    }));
    writeFile(`${OUT}/atlas-${form}.png`, canvasPng(atlas, 1, null));
  }
  const tf = new Canvas(W * TRANSFORM.length, H);
  TRANSFORM.forEach((fr, i) => {
    const f = drawFrame(fr.t, fr.expr, "idle", { move: fr.move, open: fr.open, blink: fr.blink });
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f.get(x, y); if (v) tf.set(i * W + x, y, v); }
  });
  writeFile(`${OUT}/transform.png`, canvasPng(tf, 1, null));
  for (const form of FORMS) {
    const idle = new Canvas(W * IDLE.frames, H * EXPRS.length);
    EXPRS.forEach((expr, row) => {
      for (let f = 0; f < IDLE.frames; f++) {
        const fr = idleFrame(FORM_T[form], expr, f);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fr.get(x, y); if (v) idle.set(f * W + x, row * H + y, v); }
      }
    });
    writeFile(`${OUT}/idle-${form}.png`, canvasPng(idle, 1, null));
  }
  writeFile(`${OUT}/drip-a.png`, canvasPng(dripStrip(DRIP.fallA, DRIP.frames), 1, null));
  writeFile(`${OUT}/drip-b.png`, canvasPng(dripStrip(DRIP.fallB, DRIP.frames), 1, null));
  manifest.transform = TRANSFORM.map((t) => ({ t: t.t, ms: t.ms, note: t.note }));
  manifest.drip = DRIP;
  manifest.idle = IDLE;
  const json = JSON.stringify(manifest, null, 1) + "\n";
  writeFile(`${OUT}/manifest.json`, json);
  writeFile("src/components/game/art.manifest.json", json);

  // previews for the artist (not shipped): forms, expressions per form, and strips, at the in-game 4x scale
  const BG = "#0c101c";
  const sheet = (cells: Canvas[], cols: number, scale: number) => {
    const rows = Math.ceil(cells.length / cols);
    const s = new Canvas(W * cols, H * rows);
    cells.forEach((cc, i) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = cc.get(x, y); if (v) s.set((i % cols) * W + x, Math.floor(i / cols) * H + y, v); } });
    return canvasPng(s, scale, BG);
  };
  writeFile(`${PREV}/forms.png`, sheet(FORMS.map((f) => drawFrame(FORM_T[f], "neutral", "idle")), 3, 4));
  for (const form of FORMS) writeFile(`${PREV}/expr-${form}.png`, sheet(EXPRS.map((e) => drawFrame(FORM_T[form], e, "idle")), 6, 3));
  writeFile(`${PREV}/states.png`, sheet(STATES.map((s) => drawFrame(0.5, "neutral", s)), 6, 3));
  writeFile(`${PREV}/transform.png`, sheet(TRANSFORM.map((fr) => drawFrame(fr.t, fr.expr, "idle", { move: fr.move, open: fr.open })), 6, 3));
  for (const form of FORMS) writeFile(`${PREV}/idle-${form}.png`, sheet(Array.from({ length: IDLE.frames }, (_, f) => idleFrame(FORM_T[form], "neutral", f)), 12, 3));
}

if (process.argv[1]?.endsWith("ghost-archivist.mts")) {
  buildAll();
  console.log("wrote public/sprites/ghosts and /tmp/gitghost-art");
}
void diff; void inter; void poly; void humanHead; void H;
