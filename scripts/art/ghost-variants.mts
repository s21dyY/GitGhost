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
 * Run: node scripts/art/ghost-variants.mts   (writes public/sprites/ghosts/atlas-<kind>-<form>.png and transform-<kind>.png)
 */
import { Canvas, canvasPng, ellipse, fill, line, mix, noise2, outline, paint, poly, px, rect, rng, union, writeFile, type Pred, type Pt } from "./kit.mts";
import { INK, ORDER, W, H, dissolve, type Look } from "./archivist.mts";
import { BLOOD, BL, EX, EXPRS, EY, FLESH, FORMS, FORM_T, FL, GR, IDLE, MOVES, STATES, TD, TEETH, TH, TRANSFORM, VD, drawEye, idlePlan, lift, rimLight, shiftY, tear, tendril, voidAt, wetBlood, type Ex, type Expr, type Form, type Life, type State } from "./ghost-archivist.mts";

export type Kind = "watchkeeper" | "hound" | "bellwraith" | "clockmaker";
export const KINDS: Kind[] = ["watchkeeper", "hound", "bellwraith", "clockmaker"];

const SK = 4;
const COAT = 40, SLEEVE = 41, HAND = 42, LANT = 43, GLOW = 44, CAP = 45, SCARF = 46, FUR = 47, EAR = 48, COLLAR = 49, BONE = 50, TAG = 51, TUBE = 52;
Object.assign(ORDER, { [COAT]: 1, [SLEEVE]: 6, [HAND]: 8, [LANT]: 7, [GLOW]: 9.5, [CAP]: 5, [SCARF]: 3, [FUR]: 1, [EAR]: 2, [COLLAR]: 3, [BONE]: 1.2, [TAG]: 8, [TUBE]: 0.6 });
// the Clockmaker's own parts: leather apron, the watch and loupe (brass), hair, thin arms behind it, the extra hand in front
const APRON = 53, WATCH = 54, ARM = 55, HAIR = 56, XHAND = 57;
Object.assign(ORDER, { [APRON]: 2.5, [WATCH]: 9, [ARM]: 0.7, [HAIR]: 5, [XHAND]: 8.5 });
const SEP = [COAT, SLEEVE, HAND, LANT, CAP, SCARF, FUR, EAR, COLLAR, SK, TAG, TUBE, APRON, WATCH, XHAND];

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
/** Clockmaker: warm skin, slate-green shirt, brass. Gory: raw and tarnished. Eldritch: cold blue with a teal-gold glow. */
const CK: Pal[] = [
  { skin: ["#2a1e19", "#5a4136", "#93705d", "#c49a7f", "#e3c3a6"], cloth: ["#141a1b", "#26302f", "#3d4b49", "#586c68", "#7f958f"], trim: ["#2a2112", "#5a4626", "#8c7344", "#bca078", "#e3cfa0"] },
  { skin: ["#1f1410", "#45281e", "#7a4532", "#a8664a", "#c99070"], cloth: ["#170c0b", "#341614", "#5a1f1b", "#83302a", "#a65a48"], trim: ["#241a0c", "#4a3814", "#7a6022", "#a88a3c", "#d4b866"] },
  { skin: ["#0c1020", "#1a2240", "#2c3a66", "#4a5f96", "#8aa2d0"], cloth: ["#070a16", "#10162e", "#1c2650", "#2c3a74", "#4d5fa8"], trim: ["#0b1a1a", "#14302e", "#246058", "#3fa494", "#9be6d0"] },
];
/** The apron's leather, per form: oiled brown, blood-soaked, then violet-black. */
const APRON_PAL = [
  ["#1d120d", "#3a2418", "#5c3a26", "#80553a", "#a3744f"],
  ["#1c0807", "#3a110e", "#5e1b15", "#7d2b1f", "#9a4632"],
  ["#06050f", "#100c22", "#1e1840", "#2e2660", "#463c88"],
];
const PALS: Record<Kind, Pal[]> = { watchkeeper: WK, hound: HD, bellwraith: BW, clockmaker: CK };
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
/** Per-eye gaze for a void face, -1..1. Only the Hound's idle loop passes one; everyone else's eyes move together. */
type Gaze = (eye: number) => [number, number];

function voidFace(c: Canvas, L: Look, cx: number, cy: number, RX: number, RY: number, t: number, eyes: { dx: number; dy: number; rx: number; ry: number; need: number; slit: boolean; tilt: number }[], e: Ex, blink: boolean, life: Life = {}, gaze?: Gaze) {
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
      if (r() < 0.04) {
        const star = r() < 0.5 ? "#a8f0ff" : "#d8c8ff";
        if (life.twinkle === undefined || (x * 31 + y * 17 + life.twinkle * 7) % 5 !== 0) col = star;
      }
      c.set(x, y, col, VD);
    } else if (inV(x + 1, y) || inV(x - 1, y) || inV(x, y + 1) || inV(x, y - 1)) c.set(x, y, mix(L.skin[1], "#3a2a6a", 0.55), VD);
  }
  eyes.forEach((k, i) => {
    if (v < k.need) return;
    const grow = Math.min(1, (v - k.need) / 0.2 + 0.35);
    drawEye(c, L, { x: cx + k.dx * v, y: cy + k.dy * v, rx: Math.max(1.1, k.rx * v * grow), ry: Math.max(1.1, k.ry * v * grow) }, {
      lid: blink ? 1 : life.voidLid?.(i) ?? (e.extraOpen ? 0 : Math.min(0.55, e.lid[0] * 0.6)), tilt: k.tilt - e.brow[0] * 0.04, pdx: gaze?.(i)[0] ?? e.pup[0] * 0.8, pdy: gaze?.(i)[1] ?? e.pup[1] * 0.8, ps: e.ps,
      glow: true, vslit: k.slit, bloodshot: 0, ring: 0, tint: "#ece6c4", catchLight: false,
    }, VD);
  });
}

/** Thrown blood: small clusters on the given parts inside a box, denser with k. */
function spatter(c: Canvas, k: number, seed: number, parts: number[], [x0, y0, x1, y1]: [number, number, number, number]) {
  const r = rng(seed);
  for (let i = 0; i < Math.round(24 * k); i++) {
    const x = Math.round(x0 + r() * (x1 - x0)), y = Math.round(y0 + r() * (y1 - y0));
    if (!parts.includes(c.partAt(x, y))) continue;
    c.set(x, y, r() < 0.3 ? BLOOD[3] : BLOOD[2], BL);
    if (r() < 0.45 && parts.includes(c.partAt(x + 1, y))) c.set(x + 1, y, BLOOD[1], BL);
  }
}

/** Blood running off the bottom of the figure: drops hang below the cloth or fur, each ending in a bead. */
function hemDrips(c: Canvas, drops: [number, number][], parts: number[]) {
  for (const [x, len] of drops) {
    let bottom = -1;
    for (let y = H - 1; y > 40; y--) if (parts.includes(c.partAt(x, y))) { bottom = y; break; }
    if (bottom < 0) continue;
    for (let i = 1; i <= len && bottom + i < H - 1; i++) c.set(x, bottom + i, i === len ? BLOOD[3] : BLOOD[2], BL);
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

function wkHead(t: number, expr: Expr, state: State, blink: boolean, open?: number, look: Partial<Ex> = {}, life: Life = {}): Canvas {
  const p = palAt("watchkeeper", t), L = eyeLook(p, t), e: Ex = { ...EX[expr], ...look };
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
  ], e, blink, life);
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

/** The lantern's own beat: a cracked pane does not burn evenly. */
const FLICKER = [0, 0.12, 0.04, 0.22, 0.08, 0.16];

function wkBody(t: number, life: Life = {}): Canvas {
  const sway = life.sway ?? 0;
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
  const flick = life.frame === undefined ? 0 : FLICKER[life.frame % FLICKER.length];
  fill(c, GLOW, rect(47, 55, 53, 62), mix(mix(glass, "#4a7aa8", 0.35 * (1 - v)), "#eaf6ff", flick));
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
    tendril(c, 12, 66, -1.95, 0.045, 54, 4.2, 0 + sway, k); tendril(c, 9, 74, -2.4, 0.05, 44, 3, 1.7 + sway, k);
    tendril(c, 52, 66, -1.2, -0.04, 52, 4, 2.4 + sway, k); tendril(c, 55, 74, -0.8, -0.055, 42, 2.8, 4.1 + sway, k);
  }
  // Gory transformation visibly breaks the upright outline: one swollen shoulder,
  // dragging arm and a split coat. Organic red and pale cartilage clusters.
  if (g > 0.2) {
    const swell = 1 + 0.08 * (life.pulse ?? 0);
    paint(c, FL, ellipse(13, 42, 6.5*g*swell, 11*g*swell), FLESH, {base:2, blur:2,k:1.5});
    paint(c, GR, poly([[12,48],[17,51],[13,65],[7,73],[6,70]]), ["#290708","#5a1115","#9d3324","#c16f4b"], {base:2, blur:2,k:1.5, clip:()=>g>0.45});
    for (let i=0;i<7;i++) c.set(12+(i%3),48+i*3,i%2?"#d7c59c":"#831b1a",BONE);
  }
  // After the gore fades, lantern-light is eaten by an asymmetrical branch of void.
  if (v > 0.5) {
    tendril(c, 35, 38, -1.65, 0.036, 29, 3.8, 1.4 + sway, v);
    tendril(c, 25, 50, -2.35, -0.028, 27, 3, 2.1 + sway, v);
    fill(c, VD, ellipse(50,58,5*v,7*v),"#06190d");
    for (const [x,y] of [[49,55],[52,58],[48,61]] as [number,number][]) c.set(x,y,"#d2e79b",EY);
  }
  if (g > 0.3) {
    spatter(c, g, 501, [COAT, SLEEVE, COLLAR, SCARF, HAND], [14, 36, 50, 70]);
    hemDrips(c, [[15, 3], [22, 4], [41, 2], [48, 3]], [COAT]);
  }
  // a bright beat of the lantern spills onto the coat beside it
  if (flick > 0.15) for (let y = 50; y < 66; y++) for (let x = 41; x < 47; x++) if (c.partAt(x, y) === COAT || c.partAt(x, y) === SLEEVE) c.set(x, y, mix(c.get(x, y)!, mix(glass, "#eaf6ff", 0.5), 0.18), c.partAt(x, y));
  void L;
  return c;
}

/* =================================================================== HOUND */

/**
 * The Hound's expressions live in its ears: [left tip dx, dy, right tip dx, dy] in art pixels.
 * Sad ears droop, amused ears perk forward, angry ears pin back, frightened ears press flat.
 */
const EAR_POSE: Record<Expr, [number, number, number, number]> = {
  neutral: [0, 0, 0, 0],
  melancholy: [-3, 5, 3, 5],
  amused: [1, -1, -1, -1],
  angry: [3, 4, -3, 4],
  disturbed: [-4, 7, 4, 7],
  eldritch: [0, -2, 0, -2],
};
/** Idle ear flicks: a quick twitch, then a settle. The changed forms twitch out of step with each other. */
function earTwitch(t: number, f: number | undefined): [number, number, number, number] {
  if (f === undefined) return [0, 0, 0, 0];
  if (voidAt(t) > 0.5) return f === 6 ? [2, -1, -2, 2] : f === 7 ? [1, 0, -1, 1] : f === 16 ? [-2, 2, 0, 0] : [0, 0, 0, 0];
  return f === 4 ? [-4, 6, 0, 0] : f === 5 ? [-2, 2, 0, 0] : f === 14 ? [0, 0, 4, 6] : f === 15 ? [0, 0, 2, 2] : [0, 0, 0, 0];
}
/** Panting: how far the tongue hangs past the lip on each idle frame (0 = in). */
const PANT = [1, 2, 2, 3, 3, 2, 1, 1, 2, 2, 3, 3, 2, 1, 1, 2, 2, 3, 3, 2, 1, 1, 2, 2];
/** Each void eye wanders on its own beat; none of them agrees with the others. */
const WANDER: [number, number][] = [[0, 0], [0.9, 0], [-0.9, 0.2], [0, -0.9], [0.7, 0.7], [-0.6, -0.6]];
const houndGaze = (f: number): Gaze => (i) => WANDER[(Math.floor((f + i * 5) / 3) + i) % WANDER.length];

/** Fresh blood: brighter than the dried streaks, so a moving drop reads at gameplay size. */
const FRESH = "#ff3a4e";

/** One drop of blood on its own 12-frame cycle: wells up, falls, splashes, leaves a stain. */
function houndDrop(c: Canvas, x: number, y0: number, fall: number, f: number, off: number) {
  const k = (f + off) % 12;
  if (k < 3) {
    // a bead swells, two pixels wide, on a thread
    for (let i = 0; i <= k; i++) c.set(x, y0 + i, i === k ? FRESH : BLOOD[2], BL);
    if (k > 0) c.set(x + 1, y0 + k, BLOOD[3], BL);
  } else if (k < 9) {
    if (k === 3) c.set(x, y0, BLOOD[1], BL); // the thread snaps
    const y = y0 + 2 + Math.round(((k - 3) / 5) * fall);
    c.set(x, y - 1, BLOOD[3], BL);
    c.set(x, y, FRESH, BL);
    c.set(x + 1, y, BLOOD[2], BL);
  } else if (k === 9) {
    const y = y0 + fall + 3;
    c.set(x - 1, y, BLOOD[1], BL); c.set(x, y, BLOOD[3], BL); c.set(x + 1, y, BLOOD[1], BL); c.set(x + 2, y - 1, BLOOD[2], BL);
  } else c.set(x, y0 + fall + 3, BLOOD[0], BL);
}

/** The eldritch Hound's head does not move like a head: it snaps to a wrong angle, holds it, then the neck stretches. */
export function houndJerk(t: number, f: number | undefined): { dx: number; dy: number; shear: number } {
  if (f === undefined || voidAt(t) <= 0.5) return { dx: 0, dy: 0, shear: 0 };
  if (f === 9) return { dx: -2, dy: 0, shear: 0.18 };
  if (f >= 10 && f <= 12) return { dx: -2, dy: 0, shear: 0.24 };
  if (f === 13) return { dx: 1, dy: 0, shear: -0.08 };
  if (f === 19 || f === 21) return { dx: 0, dy: -1, shear: 0 };
  if (f === 20) return { dx: 0, dy: -2, shear: 0 };
  return { dx: 0, dy: 0, shear: 0 };
}

function hdHead(t: number, expr: Expr, state: State, blink: boolean, open?: number, look: Partial<Ex> = {}, life: Life = {}): Canvas {
  const p = palAt("hound", t), L = eyeLook(p, t), e: Ex = { ...EX[expr], ...look };
  const g = gore(t), v = voidAt(t);
  const c = new Canvas(W, H);
  // Longer, gaunter canine head with a sloping skull and a nervous asymmetry.
  const skull: Pred = union(
    ellipse(31.3, 21.4, 8.8, 7.2),
    ellipse(31.8, 28.8, 6.6, 5.4),
    poly([[25, 26], [38, 26], [40, 36], [34, 39], [28, 39], [23.5, 32]])
  );
  paint(c, SK, skull, p.skin, { base: 2, blur: 4, k: 2.5, dither: 0.25 });
  // Ears: posed by the expression, with idle flicks on top. Tips move; the roots stay on the skull.
  const pose = EAR_POSE[expr], tw = earTwitch(t, life.frame);
  const [lx, ly, rx, ry] = [pose[0] + tw[0], pose[1] + tw[1], pose[2] + tw[2], pose[3] + tw[3]];
  paint(c, EAR, poly([[22.5, 18], [20.2 + lx, 2 + ly], [30.4, 12.6]]), p.skin, { base: 1, blur: 2, k: 2 });
  paint(c, EAR, poly([[39.8, 18], [43.8 + rx, 5 + ry], [35.2, 15.4]]), p.skin, { base: 1, blur: 2, k: 2 });
  fill(c, EAR, poly([[24.2, 16.7], [22.5 + lx * 0.7, 7.4 + ly * 0.7], [28.6, 13.2]]), mix(p.skin[1], "#7a4a58", 0.35));
  fill(c, EAR, poly([[39.2, 16.4], [41.3 + rx * 0.7, 9.1 + ry * 0.7], [36.6, 14.2]]), mix(p.skin[1], "#7a4a58", 0.4));
  // a few hairs along the ear edges catch the light
  px(c, EAR, [[Math.round(21 + lx * 0.6), Math.round(8 + ly * 0.6)], [Math.round(42 + rx * 0.6), Math.round(10 + ry * 0.6)]], p.skin[4]);
  if (g > 0.42) {
    const ox = Math.round(lx * 0.5), oy = Math.round(ly * 0.5);
    line(c, BL, [22 + ox, 13 + oy], [23, 22], BLOOD[2]);
    px(c, EAR, [[22 + ox, 12 + oy], [22 + ox, 14 + oy], [23 + ox, 15 + oy]], "#05070d");
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
  // panting in the idle loop (and when amused): the mouth hangs a little open and the tongue moves
  const pant = v < 0.3 && life.frame !== undefined ? PANT[life.frame % PANT.length] : 0;
  const tongue = v >= 0.3 ? 0 : Math.max(pant, expr === "amused" ? 3 : 0);
  const mo = open ?? Math.max(e.open, g * 0.72, tongue ? 0.42 : 0);
  if (v < 0.62) {
    px(c, SK, [[32, 33], [32, 34], [31, 34]], p.skin[0]);
    mouth(c, L, 31.8, 35.1, 4.8 + 1.6 * g, mo, 3.6 + 5.8 * g, e.curve * 0.6 - 0.1, e.teeth || mo > 0.3 || g > 0.28);
    if (tongue) {
      // a tongue hanging past the lower lip; darker and wetter as the gore rises
      const top = 35 + Math.max(1, Math.round(mo * (3.6 + 5.8 * g))) - 1;
      const body = mix("#c4566b", "#7a2a3a", g), lit = mix("#ec8f9f", "#a64454", g), dark = mix("#7b2638", "#3a0c16", g);
      for (let i = 0; i < tongue + 1; i++) {
        const y = top + i;
        c.set(31, y, lit, FL); c.set(32, y, body, FL); c.set(33, y, i === tongue ? dark : body, FL);
      }
      c.set(32, top + tongue + 1, dark, FL);
      if (g > 0.3) c.set(33, top + tongue + 2, BLOOD[3], BL);
    }
    if (expr === "angry") {
      // the snarl: a wrinkled muzzle and a furrow between the brows
      px(c, SK, [[29, 29], [30, 28], [34, 28], [35, 29], [32, 19], [32, 20], [31, 21], [33, 21]], p.skin[0]);
      px(c, SK, [[30, 29], [34, 29]], p.skin[3]);
    }
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
  ], e, blink, life, v > 0.5 && life.frame !== undefined ? houndGaze(life.frame) : undefined);
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
    // wet glints on the open cheek, and the dark of the recess beneath them
    px(c, FL, [[36, 26], [37, 29], [35, 32]], "#ff9aa6");
    px(c, GR, [[37, 27], [38, 30]], "#14040a");
  }
  // a drop gathers at the jaw and falls, on the idle loop
  if (g > 0.3 && life.frame !== undefined) houndDrop(c, 35, 41, 9, life.frame, 3);
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

function hdBody(t: number, life: Life = {}): Canvas {
  const sway = life.sway ?? 0;
  // two wags per idle loop; the still pose keeps the tail where it was drawn
  const wag = life.frame === undefined ? 0 : Math.sin((life.frame / IDLE.frames) * Math.PI * 4) * 0.16;
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
  // Fur: short strands that run down and back, lit from the upper left (highlight above, shadow below each strand).
  const r = rng(61);
  for (let y = 41; y < 74; y += 5) for (let x = 16 + ((y * 5) % 6); x < 49; x += 6) {
    if (r() < 0.35) continue;
    const pts: [number, number][] = [[x, y], [x - 1, y + 1], [x - 1, y + 2]];
    if (!pts.every(([a, b]) => c.partAt(a, b) === FUR)) continue;
    const lit = x < 32 && y < 62;
    c.set(x, y, p.skin[lit ? 3 : 2], FUR);
    c.set(x - 1, y + 1, p.skin[lit ? 3 : 2], FUR);
    c.set(x - 1, y + 2, p.skin[1], FUR);
  }
  // Tail: a little higher, more tense.
  tube(c, TUBE, 48, 70, -0.7 + wag, -0.042, 34, 2.7, p.skin);
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
      // the chest eye rolls slowly in its socket, and blinks once, late
      const f = life.frame;
      const roll: [number, number] = f === undefined ? [0, 0] : [Math.round(Math.cos((f / IDLE.frames) * Math.PI * 4) * 4) / 5, Math.round(Math.sin((f / IDLE.frames) * Math.PI * 4) * 4) / 5];
      drawEye(c, eyeLook(p, t), { x: 30.8, y: 50.5, rx: 2.3 * k, ry: 2.8 * k }, { lid: f === 20 ? 1 : f === 21 ? 0.6 : 0, tilt: 0, pdx: roll[0], pdy: roll[1], ps: 1, glow: true, vslit: true, bloodshot: 0, ring: 0, tint: "#ece6c4" }, VD);
      for (const [x, y] of [[28, 47], [33, 54]] as [number, number][]) c.set(x, y, "#dce79d", EY);
    }
    tendril(c, 14, 69, -2.18, 0.05, 44, 3.8, 0 + sway, k);
    tendril(c, 11, 76, -2.55, 0.05, 34, 2.8, 1.5 + sway, k);
    tendril(c, 49, 68, -0.95, -0.05, 45, 3.6, 2.4 + sway, k);
    tendril(c, 54, 74, -0.55, -0.06, 32, 2.7, 4 + sway, k);
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
    // depth inside the flank: the cavity darkens toward the top, ribs are lit above and shadowed below,
    // muscle striations between them, wet glints along the lit edge, and torn fur around the opening
    const flank = poly([[36, 53], [45, 55], [46, 69], [39, 72], [34, 64]]);
    for (let y = 53; y < 73; y++) for (let x = 33; x < 47; x++) {
      if (!flank(x, y)) continue;
      const q = c.partAt(x, y);
      if (q === GR && y < 58) c.set(x, y, "#14040a", GR);
      if (q === BONE && x < 39) c.set(x, y, "#f2e8cc", BONE); // the lit end of each rib
      if (q === BONE && x > 42) c.set(x, y, "#8f8670", BONE); // the end turning into the dark

      if (q === GR && y >= 58 && (x + y) % 3 === 0) c.set(x, y, (x + y) % 2 ? FLESH[2] : FLESH[1], GR);
    }
    px(c, FL, [[35, 56], [34, 61], [36, 66]], "#ff9aa6");
    for (const [x, y] of [[34, 54], [46, 58], [47, 63], [44, 71], [33, 60], [33, 66]] as [number, number][]) if (c.partAt(x, y) === FUR) c.set(x, y, (x + y) % 2 ? p.skin[0] : p.skin[3], FUR);
    for (let i=0;i<11;i++) {
      const x=20+Math.floor(i*1.6), y=47+(i%4)*2;
      if (c.partAt(x,y)===FUR) c.set(x,y,i%3===0?"#b56b60":"#5d222c",FL);
    }
    px(c,BL,[[39,72],[40,74],[42,75],[24,58],[25,60]],"#8b1721");
    spatter(c, g, 601, [FUR, COLLAR], [16, 40, 48, 72]);
    hemDrips(c, [[18, 2], [26, 3], [37, 4], [46, 2]], [FUR]);
    // blood that keeps falling: from the flank wound and the shoulder, each on its own beat
    if (life.frame !== undefined && g > 0.3) {
      houndDrop(c, 40, 72, 3, life.frame, 0);
      houndDrop(c, 24, 58, 12, life.frame, 6);
      houndDrop(c, 43, 69, 5, life.frame, 9);
    }
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


/* =================================================================== CLOCKMAKER
   An old craftsman: bald crown, grey temples, a moustache, a brass jeweller's loupe over one eye, rolled sleeves,
   a leather apron with tools in the pocket, and the pocket watch held in both hands (its signature object).
   Gory: gears turn inside a torn cheek, the loupe cracks and weeps, an extra hand reaches from behind to wind the
   watch, the apron spills gears. Eldritch: the head is a clock face (stars, ticks, two eyes that never move, hands
   that spin) and thin jointed arms frame the body, each repeating its own small task.
*/

/** A tiny brass gear; its teeth step round on alternate frames so it reads as turning. */
function gear(c: Canvas, cx: number, cy: number, ramp: string[], f = 0) {
  fill(c, WATCH, ellipse(cx + 0.5, cy + 0.5, 1.7, 1.7), ramp[3]);
  const teeth: [number, number][] = f % 2 ? [[0, -2], [2, 0], [0, 2], [-2, 0]] : [[1, -2], [2, 1], [-1, 2], [-2, -1]];
  for (const [dx, dy] of teeth) c.set(cx + dx, cy + dy, ramp[4], WATCH);
  c.set(cx, cy, "#120a08", WATCH);
}

function ckHead(t: number, expr: Expr, state: State, blink: boolean, open?: number, look: Partial<Ex> = {}, life: Life = {}): Canvas {
  const p = palAt("clockmaker", t), L = eyeLook(p, t), e: Ex = { ...EX[expr], ...look };
  const g = gore(t), v = voidAt(t), f = life.frame;
  const c = new Canvas(W, H);
  const skull: Pred = union(ellipse(32, 19.5, 8.6, 10), poly([[24.5, 21], [39.5, 21], [38, 29], [34.5, 32], [29.5, 32], [26, 29]]), rect(29, 31, 35, 35));
  paint(c, SK, skull, p.skin, { base: 2, blur: 4, k: 2.4, dither: 0.2 });
  paint(c, SK, union(ellipse(23.7, 21, 1.8, 2.8), ellipse(40.3, 21, 1.8, 2.8)), p.skin, { base: 1, blur: 1, k: 1.5 });
  const hair = mix(mix("#a7a39a", "#6e5a4c", Math.min(1, t * 2)), "#2a3466", v);
  if (v < 0.6) {
    // grey at the temples and a thin comb-over; the crown stays bald
    fill(c, HAIR, union(ellipse(24.8, 16, 2.1, 4), ellipse(39.2, 16, 2.1, 4)), hair);
    line(c, HAIR, [27, 11], [36, 10], mix(hair, "#000000", 0.25));
    line(c, HAIR, [28, 12], [37, 12], hair);
    // age: two forehead lines that rise with the brows
    const lift = Math.round(Math.max(0, -e.lift[0]) * 0.5);
    line(c, SK, [29, 13 - lift], [35, 13 - lift], p.skin[1]);
    line(c, SK, [30, 15 - lift], [34, 15 - lift], p.skin[1]);
  }
  px(c, SK, [[32, 22], [32, 23], [33, 24]], p.skin[3]);
  px(c, SK, [[31, 25], [33, 25]], p.skin[0]);
  // the eyes: in the idle loop the living clockmaker looks down at his watch now and then
  const glance = f !== undefined && t < 0.25 && f >= 9 && f <= 13;
  const pdx = glance ? 0 : e.pup[0], pdy = glance ? 0.9 : e.pup[1];
  const base = { softLid: t < 0.2, ps: e.ps * (1 - 0.4 * Math.min(1, t * 2)), glow: e.glow && t > 0.4, vslit: false, bloodshot: 0.1 + 0.7 * g, ring: 0.25 + 0.6 * g };
  if (v < 0.6) {
    const drift = g > 0.4 ? 0.8 : 0; // as it changes, the eyes stop agreeing
    drawEye(c, L, { x: 28.4, y: 20, rx: 2.4, ry: 1.7 }, { ...base, pdx: pdx - drift, pdy: pdy + drift * 0.3, lid: blink ? 1 : e.lid[0] * 0.9, tilt: -e.brow[0] * 0.06, catchLight: true });
    // the loupe eye, magnified
    drawEye(c, L, { x: 36, y: 20, rx: 3.2, ry: 2.6 }, { ...base, pdx: pdx + drift, pdy, lid: blink ? 1 : e.lid[1] * 0.85, tilt: e.brow[1] * 0.06, catchLight: true });
    const rim = ellipse(36, 20, 4.4, 3.8), glass = ellipse(36, 20, 3.4, 2.8);
    for (let y = 15; y < 25; y++) for (let x = 31; x < 41; x++) if (rim(x, y) && !glass(x, y)) c.set(x, y, x + y < 54 ? p.trim[4] : p.trim[2], WATCH);
    fill(c, WATCH, rect(40, 18, 42, 22), p.trim[1]);
    px(c, WATCH, [[40, 18], [41, 18]], p.trim[3]);
    line(c, WATCH, [40, 16], [26, 13], "#3a2418"); // the leather headband that holds the loupe
    if (g > 0.5) {
      px(c, EY, [[34, 18], [35, 19], [36, 20], [37, 21], [38, 22]], "#0b0508"); // the glass cracks
      bloodDrop(c, 36, 23, Math.round(4 + 6 * g), 71);
    }
  }
  if (v < 0.4) {
    // the moustache follows the mouth: up with a smile, down with a frown
    const ml = mix("#b9b4aa", "#5a463a", Math.min(1, t * 2));
    const twitch = f !== undefined && t < 0.25 && (f === 2 || f === 3) ? -1 : 0; // a small twitch while he waits
    const lift = (expr === "amused" ? -1 : expr === "melancholy" || expr === "angry" ? 1 : 0) + twitch;
    fill(c, HAIR, poly([[27, 26.5 + lift], [32, 25.5], [37, 26.5 + lift], [36, 28], [32, 27], [28, 28]]), ml);
  }
  const mo = open ?? Math.max(e.open, g * 0.6);
  if (v < 0.3) mouth(c, L, 32, 29.2 + g, 3 + 2 * g, mo, 2.6 + 5 * g, e.curve * 0.6, e.teeth || mo > 0.3 || g > 0.3);
  if (g > 0.2) {
    // a torn cheek, and gears turning inside it
    paint(c, FL, ellipse(26.8, 25.5, 2.6 + 2 * g, 3 + 2.4 * g), FLESH, { base: 2, blur: 2, k: 2, dither: 0.25, clip: (x, y) => c.partAt(x, y) === SK });
    if (g > 0.45) {
      gear(c, 26, 25, p.trim, f ?? 0);
      px(c, FL, [[24, 23], [29, 28]], "#ff9aa6");
    }
    bloodDrop(c, 25, 29, Math.round(4 + 6 * g), 72);
  }
  // the eldritch face is a clock: stars, twelve ticks, two eyes that never move, hands that spin
  voidFace(c, L, 32, 20, 8.2, 8.8, t, [
    { dx: -3.4, dy: -0.8, rx: 2.1, ry: 1.9, need: 0.35, slit: false, tilt: 0 },
    { dx: 3.4, dy: -0.8, rx: 2.1, ry: 1.9, need: 0.45, slit: false, tilt: 0 },
  ], { ...e, pup: [0, 0] }, blink, life);
  if (v > 0.5) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.set(Math.round(32 + Math.cos(a) * 7.4 * v), Math.round(20 + Math.sin(a) * 7.9 * v), i % 3 === 0 ? p.trim[4] : p.trim[3], VD);
    }
    const step = f ?? 0;
    const am = -Math.PI / 2 + (step / IDLE.frames) * Math.PI * 4, ah = -Math.PI / 2 + (step / IDLE.frames) * Math.PI + 0.9;
    line(c, VD, [32, 21], [Math.round(32 + Math.cos(am) * 6), Math.round(21 + Math.sin(am) * 6)], p.trim[4]);
    line(c, VD, [32, 21], [Math.round(32 + Math.cos(ah) * 3.5), Math.round(21 + Math.sin(ah) * 3.5)], p.trim[3]);
    c.set(32, 21, p.trim[4], VD);
  }
  if (v < 0.35) {
    // bushy brows, two rows on the outer half
    const by = 16.5 + (t > 0.2 ? 0 : 0.5);
    const lb: [Pt, Pt] = [[25, Math.round(by - e.brow[0] * 0.5)], [30, Math.round(by + e.brow[0])]];
    const rb: [Pt, Pt] = [[34, Math.round(by + e.brow[1])], [39, Math.round(by - e.brow[1] * 0.5)]];
    line(c, HAIR, lb[0], lb[1], hair); line(c, HAIR, rb[0], rb[1], hair);
    px(c, HAIR, [[25, lb[0][1] - 1], [26, lb[0][1] - 1], [38, rb[1][1] - 1], [39, rb[1][1] - 1]], hair);
    if (expr === "angry") px(c, SK, [[32, 16], [32, 17]], p.skin[0]);
  }
  void state;
  return c;
}

function ckBody(t: number, life: Life = {}): Canvas {
  const p = palAt("clockmaker", t), g = gore(t), v = voidAt(t), f = life.frame;
  const c = new Canvas(W, H);
  const leather = mixArr(mixArr(APRON_PAL[0], APRON_PAL[1], Math.min(1, t * 2)), APRON_PAL[2], v);
  if (v > 0.3) {
    // thin jointed arms behind the body, each repeating its own small task on its own beat
    const k = Math.min(1, (v - 0.3) / 0.6);
    const arms: [number, number, number, number, number][] = [[16, 40, -2.3, 0.9, 2], [48, 40, -0.85, -0.9, 3], [14, 54, -2.6, 0.8, 3], [50, 54, -0.55, -0.8, 2]];
    arms.forEach(([sx, sy, a1, bend, speed], i) => {
      const ph = f === undefined ? 0 : (f / IDLE.frames) * Math.PI * 2 * speed + i;
      const ex = sx + Math.cos(a1) * 7 * k, ey = sy + Math.sin(a1) * 7 * k;
      const a2 = a1 + bend + Math.sin(ph) * 0.6;
      const hx = Math.max(2, Math.min(61, ex + Math.cos(a2) * 6 * k)), hy = ey + Math.sin(a2) * 6 * k;
      line(c, ARM, [Math.round(sx), Math.round(sy)], [Math.round(ex), Math.round(ey)], p.cloth[2]);
      line(c, ARM, [Math.round(ex), Math.round(ey)], [Math.round(hx), Math.round(hy)], p.cloth[3]);
      c.set(Math.round(ex), Math.round(ey), p.trim[3], ARM); // a brass joint at each elbow
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, 1]] as Pt[]) c.set(Math.round(hx) + dx, Math.round(hy) + dy, p.skin[3], ARM);
    });
  }
  paint(c, COAT, poly([[19, 33], [45, 33], [49, 45], [51, 77], [13, 77], [15, 45]]), p.cloth, { base: 2, blur: 4, k: 2.4, dither: 0.25 });
  paint(c, COLLAR, poly([[27, 33], [31, 33], [30, 38]]), p.cloth, { base: 3, blur: 1, k: 1.4 });
  paint(c, COLLAR, poly([[37, 33], [33, 33], [34, 38]]), p.cloth, { base: 3, blur: 1, k: 1.4 });
  // rolled sleeves: shirt to the elbow, a rolled cuff, then bare forearms reaching in to the watch
  paint(c, SLEEVE, poly([[12, 36], [19, 35], [20, 51], [13, 52]]), p.cloth, { base: 2, blur: 2, k: 2 });
  paint(c, SLEEVE, poly([[45, 35], [52, 36], [51, 52], [44, 51]]), p.cloth, { base: 2, blur: 2, k: 2 });
  fill(c, SLEEVE, rect(13, 49, 20, 51), p.cloth[4]);
  fill(c, SLEEVE, rect(44, 49, 51, 51), p.cloth[4]);
  // the apron: bib, straps, skirt, and a pocket with tools in it
  paint(c, APRON, union(poly([[24, 38], [40, 38], [41, 46], [23, 46]]), poly([[21, 46], [43, 46], [46, 77], [18, 77]])), leather, { base: 2, blur: 3, k: 2, dither: 0.2 });
  line(c, APRON, [24, 38], [21, 33], leather[1]);
  line(c, APRON, [40, 38], [43, 33], leather[1]);
  fill(c, APRON, rect(36, 63, 42, 69), leather[1]);
  px(c, APRON, [[38, 61], [38, 62], [40, 60], [40, 61], [40, 62]], p.trim[3]);
  // bare forearms come in over the apron to cup the watch
  paint(c, HAND, poly([[14, 51], [20, 51], [29, 55], [28, 60], [25, 60]]), p.skin, { base: 2, blur: 2, k: 2 });
  paint(c, HAND, poly([[44, 51], [50, 51], [39, 60], [36, 60], [35, 55]]), p.skin, { base: 2, blur: 2, k: 2 });
  // the pocket watch, in both hands, on a chain to the pocket
  const wx = 32, wy = 57;
  fill(c, WATCH, ellipse(wx + 0.5, wy + 0.5, 4.3, 4.3), p.trim[2]);
  px(c, WATCH, [[wx - 3, wy - 2], [wx - 2, wy - 3], [wx - 1, wy - 4]], p.trim[4]);
  fill(c, WATCH, ellipse(wx + 0.5, wy + 0.5, 3.2, 3.2), mix("#ece4c8", "#bfeee2", v));
  px(c, WATCH, [[wx, wy - 3], [wx + 3, wy], [wx, wy + 3], [wx - 3, wy]], "#3a2a1a");
  // the second hand: it ticks round once a loop; backwards in the gory form, racing in the last
  const turns = v > 0.5 ? 3 : g > 0.4 ? -1 : 1;
  const a = f === undefined ? -0.9 : -Math.PI / 2 + (f / IDLE.frames) * Math.PI * 2 * turns;
  line(c, WATCH, [wx, wy], [Math.round(wx + Math.cos(a) * 2.6), Math.round(wy + Math.sin(a) * 2.6)], "#5a1a12");
  c.set(wx + 1, wy - 1, "#2a1a10", WATCH);
  px(c, WATCH, [[wx, wy - 5], [wx, wy - 6]], p.trim[3]);
  // the square winding key, turning a quarter on every idle frame
  px(c, WATCH, f !== undefined && f % 2 ? [[wx, wy - 8], [wx, wy - 7], [wx - 1, wy - 7]] : [[wx - 1, wy - 7], [wx, wy - 7], [wx + 1, wy - 7]], p.trim[4]);
  for (let i = 0; i < 6; i++) if (i % 2 === 0) c.set(wx + 5 + i, wy + 1 + Math.round(i * 0.8), p.trim[3], WATCH);
  px(c, HAND, [[wx - 4, wy + 1], [wx - 4, wy + 2], [wx + 4, wy + 1], [wx + 4, wy + 2]], p.skin[3]); // thumbs over the rim
  if (g > 0.2) {
    // an extra hand, long and dark, reaches from behind to wind the watch, over and over
    const wind = f === undefined ? 0 : [0, 1, 2, 1][f % 4];
    const dead = ["#3d3833", "#6f6760", "#a39a90"];
    for (const [a0, a1] of [[[10, 42], [16, 48]], [[16, 48], [25, 50 - wind]]] as [Pt, Pt][]) {
      line(c, XHAND, a0, a1, dead[1]);
      line(c, XHAND, [a0[0], a0[1] + 1], [a1[0], a1[1] + 1], dead[0]);
    }
    line(c, XHAND, [25, 50 - wind], [30, 50 - wind], dead[2]);
    px(c, XHAND, [[31, 49 - wind], [31, 51 - wind], [30, 48 - wind], [28, 49 - wind]], dead[2]); // long fingers on the key
    // the apron is torn at the belly, and gears spill out
    const tear = poly([[23, 60], [30, 59], [31, 68], [24, 70]]);
    fill(c, GR, tear, "#2a080e", { clip: (x, y) => c.partAt(x, y) === APRON });
    if (g > 0.4) {
      gear(c, 26, 63, p.trim, f ?? 0);
      gear(c, 28, 67, p.trim, (f ?? 0) + 1);
      px(c, FL, [[24, 61], [29, 60]], "#ff9aa6");
    }
    bloodDrop(c, 27, 70, Math.round(3 + 5 * g), 73);
    px(c, BL, [[wx - 4, wy + 3], [wx + 4, wy + 3], [wx - 3, wy + 4]], BLOOD[2]);
    spatter(c, g, 701, [APRON, COAT, SLEEVE, HAND], [14, 36, 50, 72]);
    hemDrips(c, [[20, 3], [27, 5], [38, 2], [44, 4]], [APRON, COAT]);
  }
  if (t >= 0.05) dissolve(c, t < 0.75 ? 68 : 64, 1.3 + 0.5 * Math.max(0, t - 0.5) * 2, 41);
  if (v > 0.5) {
    // the watch is the last warm thing: it glows
    const ring = ellipse(wx + 0.5, wy + 0.5, 5.4, 5.4), inner = ellipse(wx + 0.5, wy + 0.5, 4.3, 4.3);
    for (let y = wy - 6; y <= wy + 6; y++) for (let x = wx - 6; x <= wx + 6; x++) if (ring(x, y) && !inner(x, y) && c.partAt(x, y) >= 0) c.set(x, y, mix(c.get(x, y)!, "#7ff0d6", 0.45), c.partAt(x, y));
  }
  return c;
}

/** The living Clockmaker nods down to read his watch (frames 9 to 13 of the idle loop, with his eyes). */
function clockNod(t: number, f: number | undefined): { dx: number; dy: number; shear: number } {
  return f !== undefined && t < 0.25 && f >= 9 && f <= 13 ? { dx: 0, dy: 1, shear: 0.04 } : { dx: 0, dy: 0, shear: 0 };
}

/* =================================================================== BELLWRAITH
   An adult ritual bell-bearer: tall triangular veil, bronze bell, one-sided
   gory rupture, then a many-eyed green corona. Entirely cosmetic original art.
*/
function bwHead(t: number, expr: Expr, state: State, blink: boolean, open?: number, _look: Partial<Ex> = {}, _life: Life = {}): Canvas {
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
function bwBody(t: number, life: Life = {}): Canvas {
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
    for(let i=0;i<5;i++)tendril(c,22+i*4,47,-2.5+i*0.22,0.04+(i%2)*0.012,25+i*3,2.2,i+(life.sway??0),k);
    fill(c,VD,ellipse(32,56,7*k,11*k),"#04150b");
    for(const [x,y] of [[28,53],[34,58],[32,50],[37,55]] as [number,number][]) c.set(x,y,"#e6e69a",EY);
  }
  return c;
}

/* =================================================================== compose + build */

const HEAD = { watchkeeper: wkHead, hound: hdHead, bellwraith: bwHead, clockmaker: ckHead } as const;
const BODY = { watchkeeper: wkBody, hound: hdBody, bellwraith: bwBody, clockmaker: ckBody } as const;
const PIVOT: Record<Kind, number> = { watchkeeper: 30, hound: 30, bellwraith: 30, clockmaker: 30 };
const bodyCache = new Map<string, Canvas>();

const RIM = [COAT, CAP, SLEEVE, FUR, EAR, TUBE, TD, APRON];

export function drawVariant(kind: Kind, t: number, expr: Expr, state: State, extra: { move?: (typeof MOVES)[State]; open?: number; blink?: boolean; look?: Partial<Ex>; life?: Life } = {}): Canvas {
  const life = extra.life ?? {};
  // only the still pose is cached; idle-loop frames vary with their life
  const still = life.sway === undefined && life.pulse === undefined && life.frame === undefined;
  const key = `${kind}:${Math.round(t * 1000)}`;
  let body = still ? bodyCache.get(key)?.clone() : undefined;
  if (!body) { body = BODY[kind](t, life); if (still) bodyCache.set(key, body.clone()); }
  lift(body, 62, life.breath ?? 0);
  const mv0 = extra.move ?? MOVES[state];
  const jerk = kind === "hound" ? houndJerk(t, life.frame) : kind === "clockmaker" ? clockNod(t, life.frame) : { dx: 0, dy: 0, shear: 0 };
  const mv = { dx: mv0.dx + jerk.dx, dy: mv0.dy - (life.breath ?? 0) - (life.headDy ?? 0) + jerk.dy, shear: mv0.shear + jerk.shear };
  const blink = extra.blink ?? state === "blink";
  const open = extra.open ?? (state === "speak" ? Math.min(1, EX[expr].open + 0.55) : state === "twitchB" ? Math.max(EX[expr].open, 0.5) : state === "freeze" ? Math.max(EX[expr].open, 0.4) : undefined);
  const head = HEAD[kind](t, expr, state, blink, open, extra.look, life);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const part = head.partAt(x, y);
    if (part < 0) continue;
    body.set(x + mv.dx + Math.round(mv.shear * (y - PIVOT[kind])), y + mv.dy, head.get(x, y), part);
  }
  if (gore(t) > 0.15) wetBlood(body);
  rimLight(body, t, RIM);
  const L = eyeLook(palAt(kind, t), t);
  outline(body, { outer: () => L.outer, inner: (_p, col) => mix(col, L.outer, 0.62), order: (part) => ORDER[part] ?? part, sepParts: SEP });
  if (life.glitch) tear(body, life.glitch);
  return shiftY(body, life.float ?? 0);
}

/** One idle frame: the same 24-frame schedule as the Archivist (breath, glance and blink; twitch and tears; hover). */
export function variantIdleFrame(kind: Kind, t: number, expr: Expr, f: number): Canvas {
  const plan = idlePlan(t, expr, f);
  return drawVariant(kind, t, expr, "idle", { move: plan.move, blink: plan.blink, look: plan.look, life: plan.life });
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
  const OUT = "public/sprites/ghosts", PREV = "/tmp/gitghost-art";
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
    for (const form of FORMS as Form[]) {
      const idle = new Canvas(W * IDLE.frames, H * EXPRS.length);
      EXPRS.forEach((expr, row) => {
        for (let f = 0; f < IDLE.frames; f++) {
          const fr = variantIdleFrame(kind, FORM_T[form], expr, f);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = fr.get(x, y); if (v) idle.set(f * W + x, row * H + y, v); }
        }
      });
      writeFile(`${OUT}/idle-${kind}-${form}.png`, canvasPng(idle, 1, null));
      writeFile(`${PREV}/${kind}-idle-${form}.png`, sheet(Array.from({ length: IDLE.frames }, (_, f) => variantIdleFrame(kind, FORM_T[form], "neutral", f)), 12, 3));
    }
    writeFile(`${PREV}/${kind}-forms.png`, sheet((FORMS as Form[]).map((f) => drawVariant(kind, FORM_T[f], "neutral", "idle")), 3, 4));
    writeFile(`${PREV}/${kind}-transform.png`, sheet(TRANSFORM.map((fr) => drawVariant(kind, fr.t, fr.expr, "idle", { move: fr.move, open: fr.open })), 6, 3));
    for (const form of FORMS as Form[]) writeFile(`${PREV}/${kind}-expr-${form}.png`, sheet(EXPRS.map((e) => drawVariant(kind, FORM_T[form], e, "idle")), 6, 3));
  }
}

/**
 * The Hound's idle loop as editable layers, for hand-finishing in a pixel editor (Aseprite imports each PNG as a layer).
 * One transparent strip per part group and form; every pixel belongs to exactly one layer, so stacking them in the
 * listed order rebuilds the shipped frames exactly. Written beside the docs, not shipped.
 */
export const HOUND_LAYERS: { name: string; parts: number[] }[] = [
  { name: "01-tendrils", parts: [TD] },
  { name: "02-body-fur", parts: [FUR, TUBE] },
  { name: "03-collar", parts: [COLLAR, TAG] },
  { name: "04-ears", parts: [EAR] },
  { name: "05-head", parts: [SK] },
  { name: "06-wounds", parts: [GR, FL, TH, BONE] },
  { name: "07-eyes-void", parts: [EY, VD] },
  { name: "08-blood", parts: [BL] },
  { name: "09-outline", parts: [99] },
];
export function exportHoundLayers(dir = "docs/art/hound-layers") {
  const manifest: Record<string, unknown> = { frame: { w: W, h: H }, frames: IDLE.frames, ms: IDLE.ms, expression: "neutral", order: HOUND_LAYERS.map((l) => l.name), forms: FORMS };
  for (const form of FORMS as Form[]) {
    const frames = Array.from({ length: IDLE.frames }, (_, f) => variantIdleFrame("hound", FORM_T[form], "neutral", f));
    const claimed = new Set(HOUND_LAYERS.flatMap((l) => l.parts));
    for (const layer of HOUND_LAYERS) {
      const strip = new Canvas(W * IDLE.frames, H);
      frames.forEach((fr, i) => { for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = fr.partAt(x, y), v = fr.get(x, y); if (v && (layer.parts.includes(q) || (layer.name === "05-head" && !claimed.has(q)))) strip.set(i * W + x, y, v); } });
      writeFile(`${dir}/${form}/${layer.name}.png`, canvasPng(strip, 1, null));
    }
  }
  writeFile(`${dir}/manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
}

if (process.argv[1]?.endsWith("ghost-variants.mts")) {
  buildVariants();
  exportHoundLayers();
  console.log("wrote variant atlases to public/sprites/ghosts and previews to /tmp/gitghost-art");
}
void TD; void TH;
