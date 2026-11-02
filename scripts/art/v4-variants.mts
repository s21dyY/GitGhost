/**
 * GitGhost V5.3: two more base ghosts, drawn in code on the same 64 x 80 grid as the Archivist.
 *   watchkeeper: a man in a greatcoat and peaked cap, holding a lantern with a cracked blue pane.
 *   hound:       a gaunt seated dog with a collar and a small brass tag.
 * Each has the same three forms as the Archivist (human, gory, eldritch), the same 6 expressions x 6 states atlas
 * layout and the same 12-frame transformation, so the game treats them identically. Expressions are lighter than
 * the Archivist's: eyes, lids, brows and the mouth change; the rest of the body holds still.
 *
 * One morph value t drives everything: 0 = person/animal, 0.5 = gory, 1 = eldritch. Gore peaks at 0.5 and drains away;
 * the void takes the face after that, exactly as for the Archivist, so the last two forms never read as the same thing.
 *
 * Run: node scripts/art/v4-variants.mts   (writes public/sprites/v4/atlas-<kind>-<form>.png and transform-<kind>.png)
 */
import { Canvas, canvasPng, ellipse, fill, line, mix, noise2, outline, paint, poly, px, rect, rng, union, writeFile, type Pred } from "./kit.mts";
import { INK, ORDER, W, H, dissolve, type Look } from "./archivist.mts";
import { BLOOD, BL, EX, EXPRS, EY, FLESH, FORMS, FORM_T, FL, GR, MOVES, STATES, TD, TEETH, TH, TRANSFORM, VD, drawEye, tendril, voidAt, type Expr, type Form, type State } from "./v4-archivist.mts";

export type Kind = "watchkeeper" | "hound" | "bellwraith";
export const KINDS: Kind[] = ["watchkeeper", "hound", "bellwraith"];

const SK = 4;
const COAT = 40, SLEEVE = 41, HAND = 42, LANT = 43, GLOW = 44, CAP = 45, SCARF = 46, FUR = 47, EAR = 48, COLLAR = 49, BONE = 50, TAG = 51, TUBE = 52;
Object.assign(ORDER, { [COAT]: 1, [SLEEVE]: 6, [HAND]: 8, [LANT]: 7, [GLOW]: 9.5, [CAP]: 5, [SCARF]: 3, [FUR]: 1, [EAR]: 2, [COLLAR]: 3, [BONE]: 1.2, [TAG]: 8, [TUBE]: 0.6 });
const SEP = [COAT, SLEEVE, HAND, LANT, CAP, SCARF, FUR, EAR, COLLAR, SK, TAG, TUBE];

type Pal = { skin: string[]; cloth: string[]; trim: string[] };
const WK: Pal[] = [
  { skin: ["#262c34", "#45505a", "#78837f", "#a2aba3", "#c6ccc2"], cloth: ["#0d1417", "#1a262c", "#2b3d46", "#41596a", "#617f90"], trim: ["#1a0f12", "#3a1d24", "#5e2f3a", "#8a4a58", "#b3707e"] },
  { skin: ["#281811", "#533027", "#86463a", "#b96a51", "#d39a70"], cloth: ["#150d0b", "#311513", "#581b18", "#86251d", "#ae4a2c"], trim: ["#20220f", "#42431c", "#747b29", "#a4a944", "#cfbc64"] },
  { skin: ["#071911", "#103323", "#215841", "#4a9270", "#a1d5a0"], cloth: ["#070e0b", "#102218", "#163d2b", "#296849", "#55a67b"], trim: ["#0b1910", "#213a1c", "#486d2b", "#80af4a", "#c4da79"] },
];
const HD: Pal[] = [
  { skin: ["#2a303a", "#4a5461", "#7a8794", "#a9b4bd", "#cfd7dc"], cloth: ["#241410", "#3d2418", "#5a3a28", "#7a5238", "#9a6e4c"], trim: ["#3a2a12", "#6e5020", "#a07c34", "#d0aa5a", "#ecd088"] },
  { skin: ["#211b11", "#443324", "#775034", "#a56c42", "#c29a65"], cloth: ["#210d0b", "#4a1712", "#79251c", "#a73c28", "#cc7147"], trim: ["#21170b", "#52400e", "#8f751e", "#bd9d36", "#ead272"] },
  { skin: ["#0a1710", "#153325", "#245e3f", "#4e9870", "#b2d98b"], cloth: ["#091710", "#143122", "#265238", "#437f50", "#91c77a"], trim: ["#111e0c", "#31401b", "#607e2b", "#9cb54b", "#d6df8b"] },
];
const BW: Pal[] = [
  { skin: ["#20221c", "#464a35", "#777c56", "#adb08a", "#ded8ac"], cloth: ["#14120d", "#292319", "#4a3926", "#6b4c2b", "#977348"], trim: ["#29210c", "#594018", "#996b21", "#c59636", "#f0c761"] },
  { skin: ["#23180f", "#493019", "#784225", "#a65e39", "#c88353"], cloth: ["#1a100c", "#35180f", "#642116", "#8a2a1a", "#ae4829"], trim: ["#2e260e", "#534419", "#857b28", "#aaa63e", "#d3ca6c"] },
  { skin: ["#0b1b13", "#153b25", "#24603a", "#57905b", "#b6c978"], cloth: ["#080f0b", "#102819", "#18472a", "#2c7542", "#69b070"], trim: ["#1b190a", "#3b4115", "#798b29", "#b4c754", "#e9e4a2"] },
];
const PALS: Record<Kind, Pal[]> = { watchkeeper: WK, hound: HD, bellwraith: BW };
const mixArr = (a: string[], b: string[], t: number) => a.map((v, i) => mix(v, b[i], t));
function palAt(kind: Kind, t: number): Pal {
  const p = PALS[kind];
  const [a, b, u] = t <= 0.5 ? [p[0], p[1], t / 0.5] : [p[1], p[2], (t - 0.5) / 0.5];
  return { skin: mixArr(a.skin, b.skin, u), cloth: mixArr(a.cloth, b.cloth, u), trim: mixArr(a.trim, b.trim, u) };
}
/** A Look for drawEye: only the eye colours matter here. */
function eyeLook(p: Pal, t: number): Look {
  return {
    skin: p.skin, hair: p.cloth, coat: p.cloth, paper: p.skin, cover: p.cloth, brass: p.trim,
    iris: t > 0.5 ? "#7ff0d6" : "#3b5a62", sclera: t > 0.5 ? "#e6e0c0" : "#c9c7b9", lid: p.skin[1], ring: t > 0.5 ? "#1c1040" : "#4b3a48", brow: p.cloth[0],
    mouth: p.skin[0], lip: p.skin[2], outer: "#05070d",
  };
}
/** How much gore is on show: rises to 1 at t = 0.5, drains away as the void arrives. */
const gore = (t: number) => Math.min(1, t / 0.5) * (1 - voidAt(t));

const bloodDrop = (c: Canvas, x: number, y: number, len: number, seed: number) => {
  const r = rng(seed);
  for (let i = 0; i < len; i++) {
    if (r() < 0.12) x += r() < 0.5 ? -1 : 1;
    c.set(x, y + i, i % 4 === 3 ? BLOOD[1] : BLOOD[2], BL);
  }
  px(c, BL, [[x, y + len], [x, y + len + 1]], BLOOD[3]);
};

/** A mouth: a line when shut, a dark cavity with teeth when open. */
function mouth(c: Canvas, L: Look, cx: number, y0: number, hw: number, open: number, maxH: number, curve: number, teeth: boolean, part = SK) {
  y0 = Math.round(y0);
  const h = Math.round(open * maxH);
  const x0 = Math.floor(cx - hw), x1 = Math.ceil(cx + hw);
  for (let x = x0; x <= x1; x++) {
    const u = (x + 0.5 - cx) / hw;
    if (Math.abs(u) > 1) continue;
    const top = y0 + Math.round(u * u * -curve);
    if (h <= 0) { c.set(x, top, L.mouth, part); if (Math.abs(u) < 0.6) c.set(x, top + 1, mix(L.lip, L.skin[1], 0.4), part); continue; }
    const hh = Math.max(1, Math.round(h * (1 - u * u) ** 0.7));
    for (let y = top; y < top + hh; y++) c.set(x, y, y > top + hh - 2 && hh > 3 ? FLESH[2] : FLESH[0], GR);
    if (teeth && hh >= 3) { c.set(x, top, x % 2 ? TEETH[3] : TEETH[2], TH); if (hh >= 5) c.set(x, top + hh - 1, x % 2 ? TEETH[1] : TEETH[2], TH); }
  }
}

/** The face of the last form: a pocket of night with stars and eyes that do not belong to a face. */
function voidFace(c: Canvas, L: Look, cx: number, cy: number, RX: number, RY: number, t: number, eyes: { dx: number; dy: number; rx: number; ry: number; need: number; slit: boolean; tilt: number }[], e: (typeof EX)[Expr], blink: boolean) {
  const v = voidAt(t);
  if (v < 0.12) return;
  const rx = RX * v, ry = RY * v;
  const inV = ellipse(cx, cy, rx, ry);
  const n = noise2(41), r = rng(5);
  for (let y = Math.floor(cy - ry) - 1; y <= Math.ceil(cy + ry) + 1; y++) for (let x = Math.floor(cx - rx) - 1; x <= Math.ceil(cx + rx) + 1; x++) {
    if (c.partAt(x, y) < 0) continue;
    if (inV(x, y)) {
      const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry);
      let col = mix("#03010a", "#1a0f38", Math.min(1, d * d));
      if (n(x * 0.5, y * 0.5) > 0.62 && (x + y) % 2 === 0) col = mix(col, "#3a2478", 0.6);
      if (r() < 0.04) col = r() < 0.5 ? "#a8f0ff" : "#d8c8ff";
      c.set(x, y, col, VD);
    } else if (inV(x + 1, y) || inV(x - 1, y) || inV(x, y + 1) || inV(x, y - 1)) c.set(x, y, mix(L.skin[1], "#3a2a6a", 0.55), VD);
  }
  for (const k of eyes) {
    if (v < k.need) continue;
    const grow = Math.min(1, (v - k.need) / 0.2 + 0.35);
    drawEye(c, L, { x: cx + k.dx * v, y: cy + k.dy * v, rx: Math.max(1.1, k.rx * v * grow), ry: Math.max(1.1, k.ry * v * grow) }, {
      lid: blink ? 1 : e.extraOpen ? 0 : Math.min(0.55, e.lid[0] * 0.6), tilt: k.tilt - e.brow[0] * 0.04, pdx: e.pup[0] * 0.8, pdy: e.pup[1] * 0.8, ps: e.ps,
      glow: true, vslit: k.slit, bloodshot: 0, ring: 0, tint: "#ece6c4", catchLight: false,
    }, VD);
  }
}

/** A curved tube (a tail, a limb). Light from the upper left. */
function tube(c: Canvas, part: number, x0: number, y0: number, a0: number, curl: number, len: number, r0: number, ramp: string[]) {
  let x = x0, y = y0, a = a0;
  for (let i = 0; i < len; i++) {
    a += curl; x += Math.cos(a) * 0.7; y += Math.sin(a) * 0.7;
    const r = Math.max(1, r0 * (1 - (i / len) * 0.6));
    for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
      const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y);
      if (d > r) continue;
      const lit = (xx + 0.5 - x) * -0.6 + (yy + 0.5 - y) * -0.8;
      c.set(xx, yy, ramp[d > r - 0.7 ? 1 : lit > r * 0.25 ? 3 : lit > -r * 0.2 ? 2 : 1], part);
    }
  }
}

/* =================================================================== WATCHKEEPER */

function wkHead(t: number, expr: Expr, state: State, blink: boolean, open?: number): Canvas {
  const p = palAt("watchkeeper", t), L = eyeLook(p, t), e = EX[expr];
  const g = gore(t), v = voidAt(t);
  const c = new Canvas(W, H);
  const jaw = poly([[24, 19], [40, 19], [38.6, 28], [35, 30.6], [29, 30.6], [25.4, 28]]);
  const skull: Pred = union(ellipse(32, 18.5, 8.8, 10), jaw, rect(28, 29, 36, 34));
  paint(c, SK, skull, p.skin, { base: 2, blur: 4, k: 2.4, dither: 0.2 });
  const r = rng(17);
  if (t < 0.3) for (let y = 24; y < 31; y++) for (let x = 25; x < 40; x++) if (c.partAt(x, y) === SK && r() < 0.16) c.set(x, y, p.skin[1], SK);
  px(c, SK, [[32, 21], [32, 22], [32, 23]], p.skin[3]);
  px(c, SK, [[31, 24], [33, 24]], p.skin[0]);
  // eyes: the left stays; the right socket empties as the gore rises
  const base = { softLid: t < 0.2, pdx: e.pup[0], pdy: e.pup[1], ps: e.ps * (1 - 0.5 * Math.min(1, t * 2)), glow: e.glow && t > 0.4, vslit: false, bloodshot: 0.15 + 0.7 * g, ring: 0.3 + 0.7 * g };
  if (v < 0.6) {
    drawEye(c, L, { x: 28.2, y: 19.7, rx: 2.7, ry: 1.95 }, { ...base, lid: blink ? 1 : e.lid[0] * 0.9, tilt: -e.brow[0] * 0.06, catchLight: true });
    if (g > 0.45) {
      fill(c, EY, ellipse(35.8, 19.9, 3.1, 2.7), "#0b0508");
      px(c, EY, [[35, 19], [36, 20]], FLESH[1]);
      bloodDrop(c, 35, 22, Math.round(6 + 7 * g), 3);
    } else drawEye(c, L, { x: 35.8, y: 19.7, rx: 2.7, ry: 1.95 }, { ...base, lid: blink ? 1 : e.lid[1] * 0.9, tilt: e.brow[1] * 0.06, catchLight: true });
  }
  // gory face: torn cheek with teeth showing through, a jaw that hangs, blood from both
  if (g > 0.15) {
    paint(c, FL, ellipse(26.6, 25.2, 3.4 * g + 0.5, 4 * g + 0.5), FLESH, { base: 2, blur: 2, k: 2.2, dither: 0.25, clip: (x, y) => c.partAt(x, y) === SK });
    if (g > 0.55) { for (let x = 24; x <= 28; x++) { c.set(x, 24, x % 2 ? TEETH[3] : TEETH[2], TH); c.set(x, 26, x % 2 ? TEETH[1] : TEETH[2], TH); c.set(x, 25, FLESH[0], GR); } }
    bloodDrop(c, 25, 29, Math.round(5 + 8 * g), 8);
  }
  const mo = open ?? Math.max(e.open, g * 0.65);
  if (v < 0.3) mouth(c, L, 32 - g, 27.5 + g, 3.2 + 2.4 * g, mo, 3 + 6 * g, e.curve * 0.5, e.teeth || mo > 0.3 || g > 0.3);
  if (g > 0.35) bloodDrop(c, Math.round(29 - g), 30 + Math.round(g * 4), Math.round(4 + 7 * g), 12);
  voidFace(c, L, 32, 19.5, 7.6, 9.4, t, [
    { dx: 0, dy: 0.4, rx: 3.5, ry: 3.2, need: 0.3, slit: true, tilt: 0 },
    { dx: -3.7, dy: -4.8, rx: 2, ry: 1.9, need: 0.5, slit: false, tilt: 0.12 },
    { dx: 3.9, dy: -4.0, rx: 2.2, ry: 2, need: 0.6, slit: false, tilt: -0.1 },
    { dx: 0, dy: 5.4, rx: 1.9, ry: 1.7, need: 0.78, slit: false, tilt: 0 },
  ], e, blink);
  // The torn cheek has a second ragged edge, veins and dangling soft tissue.
  if (g > 0.45) {
    for (let i = 0; i < 11; i++) {
      const x = 22 + Math.round(Math.sin(i * 1.8) * 2), y = 23 + i;
      c.set(x, y, i % 3 === 0 ? "#d09373" : "#5c1318", FL);
    }
    for (const [x,y] of [[22,31],[21,34],[23,37],[24,39],[27,41]] as [number,number][]) c.set(x,y,"#ae3024",BL);
  }
  // Eldritch: the cap splits, and the void grows a crooked halo of optical organs.
  if (v > 0.5) {
    for (let i = 0; i < 7; i++) {
      const a = -Math.PI + i * Math.PI / 6;
      const x = Math.round(32 + Math.cos(a) * (12 + 4*v));
      const y = Math.round(18 + Math.sin(a) * (13 + 4*v));
      fill(c, VD, ellipse(x,y,1.1+v,1.2+v),"#08180e");
      c.set(x,y,i%2?"#b9db76":"#e0f0a5",EY);
    }
  }
  // the cap, over everything: crown, band, visor
  paint(c, CAP, union(ellipse(32, 10.6, 11, 5.4), rect(21, 10, 43, 14)), p.cloth, { base: 2, blur: 3, k: 2.2, dither: 0.2 });
  paint(c, CAP, rect(21, 13, 43, 14), p.trim, { base: 1, blur: 1, k: 1 });
  paint(c, CAP, rect(22, 15, 42, 16), p.cloth, { base: 0, blur: 1, k: 1 });
  px(c, CAP, [[31, 12], [32, 12], [33, 12]], "#b08a48");
  if (g > 0.5) px(c, CAP, [[24, 13], [25, 14], [25, 15], [40, 13]], BLOOD[2]);
  // brows, on top of the cap line
  if (v < 0.35) {
    const by = 17 + (t > 0.2 ? 0 : 1);
    line(c, SK, [25, by - Math.round(e.brow[0] * 0.5)], [30, by + Math.round(e.brow[0])], p.cloth[0]);
    line(c, SK, [34, by + Math.round(e.brow[1])], [39, by - Math.round(e.brow[1] * 0.5)], p.cloth[0]);
  }
  void state;
  return c;
}

function wkBody(t: number): Canvas {
  const p = palAt("watchkeeper", t), L = eyeLook(p, t);
  const g = gore(t), v = voidAt(t);
  const c = new Canvas(W, H);
  paint(c, COAT, poly([[17, 35], [47, 35], [50, 48], [54, 77], [10, 77], [14, 48]]), p.cloth, { base: 2, blur: 4, k: 2.4, dither: 0.25 });
  // lapels and a double row of brass buttons
  paint(c, COLLAR, poly([[24, 35], [31, 35], [30, 50], [23, 43]]), p.cloth, { base: 3, blur: 2, k: 1.6 });
  paint(c, COLLAR, poly([[40, 35], [33, 35], [34, 50], [41, 43]]), p.cloth, { base: 3, blur: 2, k: 1.6 });
  for (const y of [42, 50, 58, 66]) px(c, COAT, [[29, y], [35, y]], "#b08a48");
  // scarf
  paint(c, SCARF, union(rect(25, 31, 39, 36), poly([[34, 35], [39, 35], [40, 49], [35, 48]])), p.trim, { base: 2, blur: 2, k: 2 });
  // arms; the right hand carries the lantern
  paint(c, SLEEVE, poly([[11, 37], [18, 36], [17, 62], [11, 63]]), p.cloth, { base: 2, blur: 2, k: 2 });
  paint(c, SLEEVE, poly([[46, 36], [53, 38], [56, 52], [49, 54]]), p.cloth, { base: 2, blur: 2, k: 2 });
  paint(c, HAND, ellipse(14.5, 65, 2.9, 3.1), p.skin, { base: 2, blur: 2, k: 2 });
  paint(c, HAND, ellipse(50.5, 57, 3, 3), p.skin, { base: 2, blur: 2, k: 2 });
  const metal = ["#0d1116", "#1a1f26", "#2e3640", "#46515c", "#6a7886"];
  paint(c, LANT, rect(46, 53, 54, 64), metal, { base: 2, blur: 1, k: 1.4 });
  line(c, LANT, [47, 50], [47, 53], metal[3]); line(c, LANT, [53, 50], [53, 53], metal[3]); line(c, LANT, [47, 49], [53, 49], metal[3]);
  const glass = mix("#9ab9ae", "#cbb8ff", v);
  fill(c, GLOW, rect(47, 55, 53, 62), mix(glass, "#4a7aa8", 0.35 * (1 - v)));
  px(c, GLOW, [[49, 57], [50, 58], [50, 59], [51, 60], [51, 61]], INK); // the crack
  px(c, GLOW, [[48, 56], [49, 56], [52, 58]], glass);
  if (g > 0.3) {
    // the coat torn open over the chest, ribs bare
    const open = poly([[28, 41], [36, 41], [38, 59], [26, 59]]);
    fill(c, GR, open, "#2a080e", { clip: () => true });
    for (const [y, w] of [[44, 4], [48, 5], [52, 5], [56, 4]] as [number, number][]) for (let x = 32 - w; x <= 32 + w; x++) if (open(x, y)) c.set(x, y + (Math.abs(x - 32) > 3 ? 1 : 0), x % 2 ? "#cfc8ad" : "#9a937a", BONE);
    for (let y = 41; y < 59; y++) { c.set(32, y, "#7a7360", BONE); }
    bloodDrop(c, 27, 59, Math.round(14 * g), 21); bloodDrop(c, 37, 59, Math.round(10 * g), 22); bloodDrop(c, 31, 59, Math.round(16 * g), 23);
    px(c, HAND, [[14, 66], [15, 64], [49, 58], [51, 58]], BLOOD[2]);
  }
  if (t >= 0.05) dissolve(c, t < 0.75 ? 66 : 62, 1.3 + 0.5 * Math.max(0, t - 0.5) * 2, 31);
  if (v > 0.3) {
    const k = Math.min(1, (v - 0.3) / 0.6);
    tendril(c, 12, 66, -1.95, 0.045, 54, 4.2, 0, k); tendril(c, 9, 74, -2.4, 0.05, 44, 3, 1.7, k);
    tendril(c, 52, 66, -1.2, -0.04, 52, 4, 2.4, k); tendril(c, 55, 74, -0.8, -0.055, 42, 2.8, 4.1, k);
  }
  // Gory transformation visibly breaks the upright outline: one swollen shoulder,
  // dragging arm and a split coat. Organic red and pale cartilage clusters.
  if (g > 0.2) {
    paint(c, FL, ellipse(13, 42, 6.5*g, 11*g), FLESH, {base:2, blur:2,k:1.5});
    paint(c, GR, poly([[12,48],[17,51],[13,65],[7,73],[6,70]]), ["#290708","#5a1115","#9d3324","#c16f4b"], {base:2, blur:2,k:1.5, clip:()=>g>0.45});
    for (let i=0;i<7;i++) c.set(12+(i%3),48+i*3,i%2?"#d7c59c":"#831b1a",BONE);
  }
  // After the gore fades, lantern-light is eaten by an asymmetrical branch of void.
  if (v > 0.5) {
    tendril(c, 35, 38, -1.65, 0.036, 29, 3.8, 1.4, v);
    tendril(c, 25, 50, -2.35, -0.028, 27, 3, 2.1, v);
    fill(c, VD, ellipse(50,58,5*v,7*v),"#06190d");
    for (const [x,y] of [[49,55],[52,58],[48,61]] as [number,number][]) c.set(x,y,"#d2e79b",EY);
  }
  void L;
  return c;
}

/* =================================================================== HOUND */

function hdHead(t: number, expr: Expr, state: State, blink: boolean, open?: number): Canvas {
  const p = palAt("hound", t), L = eyeLook(p, t), e = EX[expr];
  const g = gore(t), v = voidAt(t);
  const c = new Canvas(W, H);
  // Longer, gaunter canine head with a sloping skull and a nervous asymmetry.
  const skull: Pred = union(
    ellipse(31.3, 21.4, 8.8, 7.2),
    ellipse(31.8, 28.8, 6.6, 5.4),
    poly([[25, 26], [38, 26], [40, 36], [34, 39], [28, 39], [23.5, 32]])
  );
  paint(c, SK, skull, p.skin, { base: 2, blur: 4, k: 2.5, dither: 0.25 });
  // Ears: one alert, one already beginning to droop or tear.
  paint(c, EAR, poly([[22.5, 18], [20.2, 2], [30.4, 12.6]]), p.skin, { base: 1, blur: 2, k: 2 });
  paint(c, EAR, poly([[39.8, 18], [43.8, 5], [35.2, 15.4]]), p.skin, { base: 1, blur: 2, k: 2 });
  fill(c, EAR, poly([[24.2, 16.7], [22.5, 7.4], [28.6, 13.2]]), mix(p.skin[1], "#7a4a58", 0.35));
  fill(c, EAR, poly([[39.2, 16.4], [41.3, 9.1], [36.6, 14.2]]), mix(p.skin[1], "#7a4a58", 0.4));
  if (g > 0.42) {
    line(c, BL, [22, 13], [23, 22], BLOOD[2]);
    px(c, EAR, [[22, 12], [22, 14], [23, 15]], "#05070d");
  }
  // Brow ridge and muzzle bridge make the face more severe.
  px(c, SK, [[29, 24], [30, 24], [31, 25], [32, 25], [33, 24]], p.skin[0]);
  line(c, SK, [29, 18], [25, 19 + Math.round(e.brow[0])], p.skin[0]);
  line(c, SK, [35, 18], [39, 18 + Math.round(e.brow[1])], p.skin[0]);
  const base = { softLid: t < 0.18, pdx: e.pup[0], pdy: e.pup[1], ps: e.ps * (1 - 0.18 * g), glow: e.glow && t > 0.42, vslit: false, bloodshot: 0.08 + 0.65 * g, ring: 0.24 + 0.65 * g };
  if (v < 0.6) {
    drawEye(c, L, { x: 27.7, y: 21.2, rx: 2.25, ry: 1.85 }, { ...base, lid: blink ? 1 : e.lid[0] * 0.88, tilt: -0.14 - e.brow[0] * 0.05, catchLight: true });
    if (g > 0.52) {
      fill(c, EY, ellipse(35.8, 20.8, 2.6, 2.2), "#0b0508");
      line(c, BL, [36, 22], [38, 28], FLESH[2]);
      drawEye(c, L, { x: 38.1, y: 28.6, rx: 1.8, ry: 1.7 }, { ...base, lid: 0, tilt: 0.1, bloodshot: 0.88, tint: "#d9d4a8" });
    } else {
      drawEye(c, L, { x: 35.7, y: 20.7, rx: 2.45, ry: 1.95 }, { ...base, lid: blink ? 1 : e.lid[1] * 0.82, tilt: 0.08 + e.brow[1] * 0.04, catchLight: true });
    }
  }
  // Long, narrow muzzle and a more canine nose.
  fill(c, SK, poly([[28, 29], [36, 29], [38, 34], [33, 36], [28, 36], [25, 33]]), p.skin[2]);
  fill(c, SK, ellipse(32, 30.9, 2.9, 1.9), "#090a10");
  px(c, SK, [[31, 30], [32, 30], [33, 30]], "#525d69");
  const mo = open ?? Math.max(e.open, g * 0.72);
  if (v < 0.62) {
    px(c, SK, [[32, 33], [32, 34], [31, 34]], p.skin[0]);
    mouth(c, L, 31.8, 35.1, 4.8 + 1.6 * g, mo, 3.6 + 5.8 * g, e.curve * 0.6 - 0.1, e.teeth || mo > 0.3 || g > 0.28);
    if (g > 0.38) {
      for (const x of [28, 29, 35, 36]) { c.set(x, 35, TEETH[3], TH); c.set(x, 36, TEETH[2], TH); }
    }
  }
  // Corruption drags the right side of the muzzle downward and opens the cheek.
  if (g > 0.22) {
    paint(c, FL, ellipse(36.2, 28.2, 2.2 + 2.8 * g, 2.2 + 3.4 * g), FLESH, { base: 2, blur: 2, k: 2, dither: 0.25, clip: (x, y) => c.partAt(x, y) === SK });
    if (g > 0.44) {
      for (let yy = 27; yy <= 32; yy += 2) {
        c.set(37, yy, yy % 4 ? TEETH[2] : TEETH[3], TH);
        c.set(38, yy + 1, yy % 4 ? FLESH[1] : TEETH[1], TH);
      }
    }
    bloodDrop(c, 35, 35, Math.round(4 + 8 * g), 33);
  }
  // Eldritch phase: face becomes a narrow void mask with too many eyes.
  voidFace(c, L, 31.6, 19.4, 7.6, 6.8, t, [
    { dx: 0, dy: 0.2, rx: 3.2, ry: 2.8, need: 0.32, slit: true, tilt: 0 },
    { dx: -4.8, dy: -0.8, rx: 1.8, ry: 1.7, need: 0.5, slit: false, tilt: 0.12 },
    { dx: 4.9, dy: -0.6, rx: 1.9, ry: 1.7, need: 0.56, slit: false, tilt: -0.12 },
    { dx: 0.6, dy: 4.7, rx: 1.7, ry: 1.5, need: 0.82, slit: false, tilt: 0 },
  ], e, blink);
  if (v > 0.52) {
    fill(c, VD, ellipse(31.5, 31.5, 3.4 * v, 4.8 * v), "#06130e");
    for (const [x, y] of [[28, 30], [31, 33], [34, 31]] as [number, number][]) c.set(x, y, "#dbe8a2", EY);
  }
  // Fine-scale face modelling: under-eye shadows, cheek folds, whisker pits.
  if (v < 0.55) {
    for (const [x, y] of [[24,22],[25,23],[26,24],[29,26],[30,27],[37,24],[38,25],[39,26],[29,30],[35,30],[26,32],[37,33]] as [number,number][]) {
      if (c.partAt(x,y) === SK) c.set(x,y,p.skin[(x+y)%3===0?0:1],SK);
    }
    for (const [x,y] of [[27,30],[28,31],[36,30],[37,31],[29,33],[35,33]] as [number,number][]) {
      if (c.partAt(x,y) === SK) c.set(x,y,p.skin[3],SK);
    }
  }
  if (g > 0.3) {
    // Torn wound has multiple values, not a flat red line. Sharp pale edge,
    // dark recess, and bruising under the irregular exposed tissue.
    for (let i=0; i<9; i++) {
      const x=36+Math.round(Math.sin(i*1.7)*g), y=25+i;
      c.set(x,y,i%3===0?"#c7a182":i%2?"#4d1420":"#8f3940",FL);
      if (i%2===0) c.set(x+1,y+1,"#271019",GR);
    }
    px(c, FL, [[33,28],[34,29],[35,31],[37,34]],"#e0b19c");
    px(c, BL, [[34,35],[36,36],[35,38],[37,40]],"#6f121b");
  }
  if (v > 0.52) {
    // The head's outline frays into branching fissures.
    line(c, VD, [24,19],[20,15],"#263e3b");
    line(c, VD, [21,15],[20,11],"#466e62");
    line(c, VD, [40,23],[45,19],"#263e3b");
    px(c, EY, [[20,11],[45,19],[25,34]],"#b8d9a4");
  }
  void state;
  return c;
}

function hdBody(t: number): Canvas {
  const p = palAt("hound", t);
  const g = gore(t), v = voidAt(t);
  const c = new Canvas(W, H);
  const furOpts = { base: 2, blur: 5, k: 2.45, dither: 0.32 };
  // Leaner posture: narrow chest, lifted haunches, stalking front half.
  const torso = union(
    ellipse(31.5, 53, 10.2, 12.4),
    ellipse(33.5, 65.2, 17.8, 9.6),
    rect(24, 56, 28, 76),
    rect(35, 58, 40, 76),
    ellipse(26.2, 76, 3.3, 2.2),
    ellipse(37.1, 76, 3.2, 2.2),
    ellipse(18.2, 75.2, 3.9, 2.4),
    ellipse(46.5, 76.3, 4.1, 2.6),
    poly([[22, 48], [26, 42], [30, 42], [31, 50], [24, 55]]),
    poly([[37, 48], [43, 47], [48, 54], [43, 58], [36, 55]])
  );
  paint(c, FUR, torso, p.skin, furOpts);
  // Chest ruff and fur noise.
  const r = rng(61);
  for (let i = 0; i < 28; i++) {
    const x = 18 + Math.floor(r() * 28), y = 39 + Math.floor(r() * 20);
    if (c.partAt(x, y) === FUR) c.set(x, y, p.skin[(i % 5 === 0) ? 4 : 3], FUR);
  }
  // Tail: a little higher, more tense.
  tube(c, TUBE, 48, 70, -0.7, -0.042, 34, 2.7, p.skin);
  // Collar and tag, slightly diagonal for life.
  paint(c, COLLAR, poly([[23, 37], [42, 39], [41, 42], [22, 40]]), p.cloth, { base: 2, blur: 1, k: 1.6 });
  fill(c, TAG, ellipse(31, 42.2, 1.9, 2.1), p.trim[3]);
  px(c, TAG, [[31, 41]], p.trim[4]);
  // One front limb feels weight-bearing; one rear limb is too far back.
  fill(c, FUR, poly([[16, 63], [20, 61], [19, 76], [15, 77]]), p.skin[1]);
  fill(c, FUR, poly([[46, 62], [49, 64], [50, 77], [46, 77]]), p.skin[1]);
  if (g > 0.22) {
    // Open flank and an altered shoulder make the corruption read through the whole body.
    const wound = poly([[36, 53], [45, 55], [46, 69], [39, 72], [34, 64]]);
    fill(c, GR, wound, "#2a080e", { clip: (x, y) => c.partAt(x, y) === FUR });
    for (const y of [56, 59, 62, 65, 68]) {
      for (let x = 36; x <= 44; x++) if (wound(x, y) && c.partAt(x, y) >= 0) c.set(x, y, x % 2 ? "#cfc8ad" : "#9a937a", BONE);
    }
    paint(c, FL, ellipse(22.5, 48, 3.8 * g, 7.4 * g), FLESH, { base: 2, blur: 2, k: 1.8, clip: (x, y) => c.partAt(x, y) === FUR });
    bloodDrop(c, 38, 71, Math.round(5 + 5 * g), 41);
    bloodDrop(c, 42, 69, Math.round(5 + 4 * g), 42);
    bloodDrop(c, 23, 52, Math.round(3 + 8 * g), 43);
  }
  if (t >= 0.05) dissolve(c, t < 0.75 ? 70 : 66, 1.25 + 0.5 * Math.max(0, t - 0.5) * 2, 51);
  if (v > 0.28) {
    const k = Math.min(1, (v - 0.28) / 0.62);
    // A chest aperture and lengthening neck push the eldritch silhouette away from a normal dog.
    const vc = ellipse(30.8, 50.5, 4.8 * k, 7.2 * k);
    for (let y = 39; y < 64; y++) for (let x = 20; x < 42; x++) if (vc(x, y) && c.partAt(x, y) === FUR) c.set(x, y, mix("#03010a", "#1a0f38", ((x - 31) / 5.5) ** 2 + ((y - 50.5) / 7.5) ** 2), VD);
    if (k > 0.45) {
      drawEye(c, eyeLook(p, t), { x: 30.8, y: 50.5, rx: 2.3 * k, ry: 2.8 * k }, { lid: 0, tilt: 0, pdx: 0, pdy: 0, ps: 1, glow: true, vslit: true, bloodshot: 0, ring: 0, tint: "#ece6c4" }, VD);
      for (const [x, y] of [[28, 47], [33, 54]] as [number, number][]) c.set(x, y, "#dce79d", EY);
    }
    tendril(c, 14, 69, -2.18, 0.05, 44, 3.8, 0, k);
    tendril(c, 11, 76, -2.55, 0.05, 34, 2.8, 1.5, k);
    tendril(c, 49, 68, -0.95, -0.05, 45, 3.6, 2.4, k);
    tendril(c, 54, 74, -0.55, -0.06, 32, 2.7, 4, k);
    if (k > 0.55) {
      fill(c, VD, poly([[24, 39], [28, 34], [31, 36], [29, 44], [24, 44]]), "#07120e");
      c.set(27, 39, "#d5e59a", EY);
    }
  }
  // Material-aware shadows: broken fur clumps, underbelly and shoulder creases.
  // Deterministic details, clipped to the original silhouette.
  const textured = noise2(89);
  for (let y=44; y<76; y++) for (let x=15; x<49; x++) {
    if (c.partAt(x,y)!==FUR) continue;
    const n=textured(x*0.68,y*0.51);
    if (n>0.69 && (x+y)%3===0) c.set(x,y,p.skin[1],FUR);
    else if (n<0.24 && (x+2*y)%4===0) c.set(x,y,p.skin[3],FUR);
  }
  for (const [x,y] of [[24,47],[25,48],[26,49],[22,54],[23,55],[42,55],[43,57],[41,60],[27,69],[28,70]] as [number,number][]) {
    if (c.partAt(x,y)===FUR) c.set(x,y,p.skin[0],FUR);
  }
  if (g>0.22) {
    // Additional deep shadow around the existing open flank, small torn
    // edges and exposed ribs. These do not replace the existing wound.
    const edge = [[35,54],[36,53],[41,54],[44,56],[45,59],[46,63],[45,68],[40,71],[36,67]] as [number,number][];
    for (const [x,y] of edge) {
      c.set(x,y,"#170a11",GR);
      c.set(x-1,y+1, g>0.65?"#7f2b35":p.skin[1],FL);
    }
    for (const [x,y] of [[37,57],[38,60],[38,63],[39,66],[40,69]] as [number,number][]) {
      c.set(x,y,"#eee0be",BONE);
      c.set(x+1,y+1,"#877d6b",BONE);
    }
    for (let i=0;i<11;i++) {
      const x=20+Math.floor(i*1.6), y=47+(i%4)*2;
      if (c.partAt(x,y)===FUR) c.set(x,y,i%3===0?"#b56b60":"#5d222c",FL);
    }
    px(c,BL,[[39,72],[40,74],[42,75],[24,58],[25,60]],"#8b1721");
  }
  if (v>0.42) {
    // Cracked, void-dark hide around the added eye.
    for (const [a,bb] of [ [[25,47],[22,42]],[[36,48],[41,43]],[[25,57],[21,61]],[[38,56],[44,59]] ] as [[number,number],[number,number]][]) {
      line(c,VD,a,bb,"#0a1c19");
    }
    px(c,EY,[[24,43],[42,44],[22,62]],"#8fb99a");
  }
  return c;
}


/* =================================================================== BELLWRAITH
   An adult ritual bell-bearer: tall triangular veil, bronze bell, one-sided
   gory rupture, then a many-eyed green corona. Entirely cosmetic original art.
*/
function bwHead(t: number, expr: Expr, state: State, blink: boolean, open?: number): Canvas {
  const p=palAt("bellwraith",t), L=eyeLook(p,t), e=EX[expr];
  const g=gore(t), v=voidAt(t), c=new Canvas(W,H);
  // A stepped, towering funeral veil, a silhouette unlike the human sprites.
  const hood=poly([[32,2],[24,7],[19,16],[19,37],[45,37],[45,16],[39,7]]);
  paint(c, CAP, hood,p.cloth,{base:2,blur:3,k:2.4,dither:0.25});
  paint(c, SK, poly([[27,15],[38,14],[40,27],[35,34],[28,33],[24,25]]),p.skin,{base:2,blur:2,k:2});
  fill(c, EY,ellipse(28,23,2.3,1.7),"#100d0a");
  fill(c, EY,ellipse(36,21,2.4,1.8),"#100d0a");
  if (!blink) {
    c.set(28+Math.round(e.pup[0]),23,"#ebd18a",EY);
    c.set(36+Math.round(e.pup[0]),21,"#ebd18a",EY);
  }
  line(c,SK,[28,30],[36,29],p.skin[0]);
  // Pierced, hanging cloth strips mark the veiled identity.
  line(c,CAP,[21,11],[16,41],p.trim[2]);
  line(c,CAP,[41,10],[49,39],p.cloth[3]);
  if(g>0.1){
    paint(c,FL,poly([[30,15],[39,14],[41,28],[34,37],[30,32]]),FLESH,{base:2,blur:2,k:1.9});
    fill(c,GR,ellipse(36,25,4*g,9*g),"#250607");
    for(let i=0;i<7;i++){
      c.set(33+(i%3),20+i*2,i%2?"#e0c7a0":"#a53026",TH);
    }
    bloodDrop(c,38,33,Math.round(7*g),48);
    fill(c,CAP,poly([[17,25],[23,22],[21,38],[15,43]]),"#561917");
  }
  if(v>0.1){
    const r=7*v;
    fill(c,VD,ellipse(32,22,r+1,11*v),"#04150b");
    for(let i=0;i<9;i++){
      const a=i*2*Math.PI/9, xx=Math.round(32+Math.cos(a)*8*v),yy=Math.round(21+Math.sin(a)*11*v);
      fill(c,EY,ellipse(xx,yy,1.3*v+0.5,1.4*v+0.5),"#c1d56b");
      c.set(xx,yy,"#061c0d",EY);
    }
    for(let i=0;i<6;i++){
      const a=i*Math.PI/5;
      line(c,VD,[32+Math.round(10*Math.cos(a)),14-Math.round(8*Math.sin(a))],[32+Math.round(19*v*Math.cos(a)),12-Math.round(15*v*Math.sin(a))],p.trim[3]);
    }
  }
  void state; void open; void L;
  return c;
}
function bwBody(t: number): Canvas {
  const p=palAt("bellwraith",t),g=gore(t),v=voidAt(t),c=new Canvas(W,H);
  // Narrow at the neck, broad torn funeral train, sharply triangular.
  paint(c,COAT,poly([[26,34],[39,34],[45,43],[53,77],[9,77],[18,43]]),p.cloth,{base:2,blur:4,k:2.6,dither:0.25});
  paint(c,SCARF,poly([[26,34],[33,42],[37,34],[39,36],[32,53],[24,36]]),p.trim,{base:1,blur:2,k:2});
  for(let y=48;y<76;y+=5){line(c,COAT,[16,y],[12,y+1],p.cloth[3]);line(c,COAT,[43,y],[49,y+2],p.cloth[0]);}
  // Hanging left sleeve and lifted right arm carrying a heavy bronze bell.
  paint(c,SLEEVE,poly([[19,39],[24,41],[18,63],[11,67],[10,61]]),p.cloth,{base:2,blur:1,k:2});
  paint(c,SLEEVE,poly([[41,38],[47,40],[53,48],[51,54],[44,49]]),p.cloth,{base:2,blur:1,k:2});
  line(c,HAND,[49,49],[50,54],p.skin[3]);
  line(c,LANT,[50,49],[50,58],p.trim[4]);
  paint(c,LANT,poly([[45,57],[55,57],[57,66],[43,66]]),p.trim,{base:2,blur:1,k:2});
  fill(c,LANT,rect(42,66,58,68),p.trim[1]);
  fill(c,GLOW,ellipse(50,62,2.5,3),"#21180a");
  c.set(50,68,p.trim[4],GLOW);
  if(g>0.15){
    fill(c,GR,poly([[26,43],[36,42],[39,63],[28,66],[24,57]]),"#35080a");
    for(let y=46;y<=61;y+=4)line(c,BONE,[27,y],[37,y+1],"#e1c2a0");
    bloodDrop(c,28,61,Math.round(12*g),51);
    fill(c,FL,ellipse(13,60,4*g,9*g),"#96341e");
  }
  if(v>0.15){
    const k=v;
    for(let i=0;i<5;i++)tendril(c,22+i*4,47,-2.5+i*0.22,0.04+(i%2)*0.012,25+i*3,2.2,i,k);
    fill(c,VD,ellipse(32,56,7*k,11*k),"#04150b");
    for(const [x,y] of [[28,53],[34,58],[32,50],[37,55]] as [number,number][]) c.set(x,y,"#e6e69a",EY);
  }
  return c;
}

/* =================================================================== compose + build */

const HEAD = { watchkeeper: wkHead, hound: hdHead, bellwraith: bwHead } as const;
const BODY = { watchkeeper: wkBody, hound: hdBody, bellwraith: bwBody } as const;
const PIVOT: Record<Kind, number> = { watchkeeper: 30, hound: 30, bellwraith: 30 };
const bodyCache = new Map<string, Canvas>();

export function drawVariant(kind: Kind, t: number, expr: Expr, state: State, extra: { move?: (typeof MOVES)[State]; open?: number; blink?: boolean } = {}): Canvas {
  const key = `${kind}:${Math.round(t * 1000)}`;
  let body = bodyCache.get(key)?.clone();
  if (!body) { body = BODY[kind](t); bodyCache.set(key, body.clone()); }
  const mv = extra.move ?? MOVES[state];
  const blink = extra.blink ?? state === "blink";
  const open = extra.open ?? (state === "speak" ? Math.min(1, EX[expr].open + 0.55) : state === "twitchB" ? Math.max(EX[expr].open, 0.5) : state === "freeze" ? Math.max(EX[expr].open, 0.4) : undefined);
  const head = HEAD[kind](t, expr, state, blink, open);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const part = head.partAt(x, y);
    if (part < 0) continue;
    body.set(x + mv.dx + Math.round(mv.shear * (y - PIVOT[kind])), y + mv.dy, head.get(x, y), part);
  }
  const L = eyeLook(palAt(kind, t), t);
  outline(body, { outer: () => L.outer, inner: (_p, col) => mix(col, L.outer, 0.62), order: (part) => ORDER[part] ?? part, sepParts: SEP });
  return body;
}

/** Optional 12-frame transparent wound-drip strip (12 × 64×80 frames).
 * Overlay it on the Hound sprite with a steps(12) background-position animation.
 * A separate strip avoids changing the established 6×6 atlas contract.
 */
export function buildHoundDripStrip(): Canvas {
  const n=12;
  const strip=new Canvas(W*n,H);
  for(let f=0;f<n;f++) {
    const t=f/n;
    const c=new Canvas(W,H);
    // A bead grows from the flank, detaches, falls, and splashes.
    const y=t<0.25?70: t<0.75?72+Math.round((t-0.25)*12):77;
    const x=40+(f%4===3?1:0);
    if(t<0.75) {
      c.set(x,Math.min(79,y),t<0.25?BLOOD[2]:BLOOD[3],BL);
      if(t>0.28) c.set(x,Math.min(79,y-1),BLOOD[1],BL);
    } else {
      for(const [sx,sy] of [[38,77],[40,78],[42,77],[41,79]] as [number,number][]) c.set(sx,sy,BLOOD[f%2?2:3],BL);
    }
    // Smaller drop near the jaw on a different cadence.
    const jawY=39+(f%6);
    if(f%6>1) c.set(35,jawY,BLOOD[2],BL);
    for(let y0=0;y0<H;y0++) for(let x0=0;x0<W;x0++) {
      const color=c.get(x0,y0);
      if(color) strip.set(f*W+x0,y0,color);
    }
  }
  return strip;
}

export function buildVariants() {
  const OUT = "public/sprites/v4", PREV = "/tmp/gitghost-v4";
  const BG = "#0c101c";
  const sheet = (cells: Canvas[], cols: number, scale: number) => {
    const rows = Math.ceil(cells.length / cols);
    const s = new Canvas(W * cols, H * rows);
    cells.forEach((cc, i) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = cc.get(x, y); if (v) s.set((i % cols) * W + x, Math.floor(i / cols) * H + y, v); } });
    return canvasPng(s, scale, BG);
  };
  writeFile(`${OUT}/drip-hound.png`, canvasPng(buildHoundDripStrip(), 1, null));
  for (const kind of KINDS) {
    for (const form of FORMS as Form[]) {
      const atlas = new Canvas(W * EXPRS.length, H * STATES.length);
      EXPRS.forEach((expr, col) => STATES.forEach((state, row) => {
        const f = drawVariant(kind, FORM_T[form], expr, state);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f.get(x, y); if (v) atlas.set(col * W + x, row * H + y, v); }
      }));
      writeFile(`${OUT}/atlas-${kind}-${form}.png`, canvasPng(atlas, 1, null));
    }
    const tf = new Canvas(W * TRANSFORM.length, H);
    TRANSFORM.forEach((fr, i) => {
      const f = drawVariant(kind, fr.t, fr.expr, "idle", { move: fr.move, open: fr.open, blink: fr.blink });
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = f.get(x, y); if (v) tf.set(i * W + x, y, v); }
    });
    writeFile(`${OUT}/transform-${kind}.png`, canvasPng(tf, 1, null));
    writeFile(`${PREV}/${kind}-forms.png`, sheet((FORMS as Form[]).map((f) => drawVariant(kind, FORM_T[f], "neutral", "idle")), 3, 4));
    writeFile(`${PREV}/${kind}-transform.png`, sheet(TRANSFORM.map((fr) => drawVariant(kind, fr.t, fr.expr, "idle", { move: fr.move, open: fr.open })), 6, 3));
    for (const form of FORMS as Form[]) writeFile(`${PREV}/${kind}-expr-${form}.png`, sheet(EXPRS.map((e) => drawVariant(kind, FORM_T[form], e, "idle")), 6, 3));
  }
}

if (process.argv[1]?.endsWith("v4-variants.mts")) {
  buildVariants();
  console.log("wrote variant atlases to public/sprites/v4 and previews to /tmp/gitghost-v4");
}
void TD; void TH;
