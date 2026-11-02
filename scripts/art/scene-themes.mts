/**
 * Themed backdrops for the encounter: the same graveyard art style and the same sky, ground, lantern and fog, with a
 * different landmark on the far ridge and different props in the mid ground. Cosmetic only: each family says "this
 * place feels like the kind of thing the repository did", never anything about the repository itself.
 *
 * Writes public/scene/far-<family>.png and mid-<family>.png (family: network, frontend, infra, data, comms).
 * The default graveyard keeps far.png and mid.png. Run: node scripts/art/scene-themes.mts
 */
import { Canvas, canvasPng, diff, ellipse, fill, line, mix, paint, poly, px, rect, rng, union, writeFile, type Pred } from "./kit.mts";
import { FAR, SH, SW, drawFog, drawNear, drawSky, deadBranches, grade, rim } from "./scene.mts";

const OUT = "public/scene";
export const FAMILIES = ["network", "frontend", "infra", "data", "comms"] as const;
type Family = (typeof FAMILIES)[number];

const INK = "#070a15";
const SIL = ["#080b17", "#0e1328", "#171e3c", "#273360"];

const hill = (x: number) => Math.round(146 + 8 * Math.sin(x / 33 + 1) + 4 * Math.sin(x / 12) + 3 * Math.sin(x / 59 + 2));
function ridge(c: Canvas) {
  paint(c, 1, (x, y) => y >= hill(x), FAR, { base: 1, blur: 5, k: 1.6, dither: 0.2 });
}
const onRidge = (x: number) => hill(x) + 2;

/* ------------------------------------------------------------- far landmarks */

function lattice(c: Canvas, x: number, base: number, h: number, w: number) {
  const top = base - h;
  line(c, 2, [x - w / 2, base], [x - 1, top], INK); line(c, 2, [x + w / 2, base], [x + 1, top], INK);
  line(c, 2, [x - w / 2 + 1, base], [x, top], INK); line(c, 2, [x + w / 2 - 1, base], [x, top], INK);
  for (let y = base - 6, i = 0; y > top + 8; y -= 8, i++) {
    const half = (w / 2) * ((y - top) / h) + 0.8;
    line(c, 2, [x - half, y], [x + half, y - 8], "#0c1226"); line(c, 2, [x + half, y], [x - half, y - 8], "#0c1226");
    line(c, 2, [x - half, y], [x + half, y], INK);
  }
  fill(c, 2, rect(x - 1, top - 8, x, top), INK);
  px(c, 3, [[x - 1, top - 8], [x, top - 8]], "#a03030"); // the beacon, dim
  px(c, 3, [[x - 2, top - 8], [x + 1, top - 8], [x - 1, top - 9], [x, top - 7]], "#4a1a22");
}

function pylon(c: Canvas, x: number) {
  const b = onRidge(x);
  line(c, 2, [x - 3, b], [x - 1, b - 14], INK); line(c, 2, [x + 3, b], [x + 1, b - 14], INK);
  fill(c, 2, rect(x - 4, b - 14, x + 4, b - 13), INK); fill(c, 2, rect(x - 3, b - 9, x + 3, b - 9), INK);
  line(c, 2, [x - 3, b - 9], [x + 1, b - 14], INK); line(c, 2, [x + 3, b - 9], [x - 1, b - 14], INK);
}

function farNetwork(c: Canvas) {
  lattice(c, 88, onRidge(88), 104, 28);
  lattice(c, 236, onRidge(236), 72, 20);
  // guy wires and sagging power lines between pylons
  for (const [x, y, gx] of [[88, 70, 42], [88, 70, 134], [236, 96, 200], [236, 96, 272]] as [number, number, number][]) line(c, 4, [x, y], [gx, onRidge(gx) + 1], "#0c1226");
  const xs = [150, 176, 202, 268, 294, 316];
  xs.forEach((x) => pylon(c, x));
  for (let i = 0; i + 1 < xs.length; i++) {
    if (xs[i] === 202) continue;
    for (const dy of [0, 4]) {
      let prev: [number, number] = [xs[i] + 3, onRidge(xs[i]) - 14 + dy];
      for (let t = 1; t <= 10; t++) {
        const x = xs[i] + 3 + ((xs[i + 1] - xs[i] - 6) * t) / 10;
        const y = onRidge(xs[i]) - 14 + dy + Math.sin((t / 10) * Math.PI) * 4;
        line(c, 4, prev, [x, y], "#0c1226"); prev = [x, y];
      }
    }
  }
  // a dish
  fill(c, 2, ellipse(22, onRidge(22) - 12, 9, 7), SIL[1]); fill(c, 2, ellipse(25, onRidge(22) - 12, 6, 7), "#05070f");
  line(c, 2, [22, onRidge(22) - 5], [22, onRidge(22)], INK);
  rim(c, "#7f94c4", [2]);
}

function farFrontend(c: Canvas) {
  // a window frame the size of a house, left standing: title bar, three dim lights, a broken corner
  const x0 = 56, x1 = 154, y0 = 66, y1 = 150;
  const frame = diff(rect(x0, y0, x1, y1), poly([[x1 - 26, y0 - 1], [x1 + 1, y0 - 1], [x1 + 1, y0 + 30], [x1 - 8, y0 + 22], [x1 - 14, y0 + 12]]));
  paint(c, 2, frame, SIL, { base: 1, blur: 3, k: 2, dither: 0.2 });
  fill(c, 2, rect(x0 + 4, y0 + 14, x1 - 4, y1 - 5), "#05070f"); // hollow content area
  fill(c, 2, rect(x0, y0 + 11, x1, y0 + 12), "#1a2447");
  for (const [dx, col] of [[7, "#6a2630"], [14, "#6a5a26"], [21, "#2a5a38"]] as [number, string][]) fill(c, 3, ellipse(x0 + dx, y0 + 6, 2.2, 2.2), col);
  fill(c, 3, rect(x0 + 30, y0 + 5, x0 + 62, y0 + 7), "#18213f"); // the address bar, empty
  for (let i = 0; i < 7; i++) fill(c, 3, rect(x0 + 10, y0 + 22 + i * 8, x0 + 26 + ((i * 17) % 52), y0 + 23 + i * 8), "#10162b"); // lines of text
  fill(c, 2, rect(x1 - 7, y0 + 16, x1 - 4, y1 - 8), "#10162b"); // scrollbar
  fill(c, 3, rect(x1 - 7, y0 + 30, x1 - 4, y0 + 48), "#1e2848");
  // a mouse cursor, taller than a man, planted in the ground
  const cur = poly([[236, 94], [236, 150], [246, 140], [254, 154], [260, 151], [252, 137], [266, 137]]);
  paint(c, 4, cur, SIL, { base: 1, blur: 2, k: 2, dither: 0.15 });
  px(c, 5, [[237, 100], [237, 108]], "#2c3a68");
  // cracked panes lying on the slope
  for (const [x, w] of [[170, 18], [192, 12], [300, 16]] as [number, number][]) {
    const b = onRidge(x);
    paint(c, 6, poly([[x, b], [x + 3, b - 12], [x + w, b - 10], [x + w - 2, b]]), SIL, { base: 1, blur: 2, k: 2 });
    line(c, 6, [x + 3, b - 12], [x + w / 2, b - 2], "#0e1328");
  }
  rim(c, "#7f94c4", [2, 4, 6]);
}

function farInfra(c: Canvas) {
  const tower = (x: number, base: number, h: number) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 12; i++) pts.push([x - (13 - 5 * Math.sin((i / 12) * Math.PI) ** 1.4 * 0.9 - 2 * (1 - i / 12)), base - (h * i) / 12]);
    const right: [number, number][] = [];
    for (let i = 12; i >= 0; i--) right.push([x + (13 - 5 * Math.sin((i / 12) * Math.PI) ** 1.4 * 0.9 - 2 * (1 - i / 12)), base - (h * i) / 12]);
    paint(c, 2, poly([...pts, ...right]), SIL, { base: 1, blur: 3, k: 2.2, dither: 0.2 });
  };
  tower(72, onRidge(72), 80); tower(116, onRidge(116) + 1, 66);
  // smokestack with warning bands, a thread of smoke that never rises
  paint(c, 3, poly([[204, 150], [208, 52], [220, 52], [224, 150]]), SIL, { base: 1, blur: 2, k: 2 });
  for (const y of [58, 66]) fill(c, 3, rect(207, y, 221, y + 3), "#3a1c1c");
  for (let i = 0; i < 14; i++) px(c, 7, [[214 + Math.round(Math.sin(i * 0.8) * 3), 50 - i * 2]], i % 3 ? "#10162b" : "#0c1226");
  // a gantry crane
  line(c, 4, [160, onRidge(160)], [160, 74], INK); line(c, 4, [161, onRidge(160)], [161, 74], INK);
  line(c, 4, [150, 74], [196, 74], INK); line(c, 4, [150, 75], [196, 75], INK);
  line(c, 4, [160, 76], [190, 74], "#0c1226"); line(c, 4, [188, 75], [188, 100], "#0c1226"); fill(c, 4, rect(185, 100, 191, 106), INK);
  // a gear, half buried, with teeth
  const cx = 268, cy = onRidge(268) + 2;
  const gear: Pred = (x, y) => {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy), a = Math.atan2(y + 0.5 - cy, x + 0.5 - cx);
    const r = 20 + (Math.sin(a * 12) > 0.2 ? 4 : 0);
    return d <= r && d >= 8;
  };
  paint(c, 5, gear, SIL, { base: 1, blur: 3, k: 2, dither: 0.2 });
  // furnace windows, barely lit
  for (const [x, y] of [[70, 128], [75, 128], [114, 122]] as [number, number][]) px(c, 8, [[x, y], [x + 1, y]], "#a85a24");
  rim(c, "#7f94c4", [2, 3, 5]);
}

function farData(c: Canvas) {
  // an observatory: dome with an open slit, a dish beside it, and rows of monoliths dotted like a data grid
  const dx = 96, db = onRidge(96);
  paint(c, 2, union(rect(dx - 24, db - 26, dx + 24, db + 2), diff(ellipse(dx, db - 26, 24, 24), rect(dx - 30, db - 26, dx + 30, db + 10))), SIL, { base: 1, blur: 3, k: 2.2, dither: 0.2 });
  fill(c, 3, rect(dx - 3, db - 50, dx + 1, db - 28), "#0b3338"); // the slit, lit from inside
  px(c, 3, [[dx - 1, db - 44], [dx - 1, db - 38], [dx, db - 33]], "#4fb0b8");
  fill(c, 2, rect(dx - 8, db - 20, dx + 8, db + 2), "#05070f");
  fill(c, 4, ellipse(160, onRidge(160) - 16, 12, 9), SIL[1]); fill(c, 4, ellipse(163, onRidge(160) - 16, 8, 9), "#05070f");
  line(c, 4, [160, onRidge(160) - 8], [160, onRidge(160)], INK);
  const r = rng(61);
  for (const [x, h, w] of [[196, 58, 14], [220, 78, 16], [246, 48, 13], [270, 66, 15], [296, 40, 12]] as [number, number, number][]) {
    const b = onRidge(x);
    paint(c, 5, rect(x, b - h, x + w, b), SIL, { base: 1, blur: 2, k: 2, dither: 0.15 });
    for (let yy = b - h + 5; yy < b - 3; yy += 4) for (let xx = x + 3; xx < x + w - 1; xx += 4) if (r() > 0.4) px(c, 6, [[xx, yy]], r() > 0.8 ? "#4fb0b8" : "#1f5a62");
  }
  rim(c, "#7f94c4", [2, 4, 5]);
}

function farComms(c: Canvas) {
  // a lighthouse and its beam, and a row of mailboxes along the ridge
  const x = 246, b = onRidge(246);
  paint(c, 2, poly([[x - 12, b + 2], [x - 6, b - 78], [x + 6, b - 78], [x + 12, b + 2]]), SIL, { base: 1, blur: 3, k: 2.2, dither: 0.2 });
  for (const y of [b - 60, b - 40, b - 20]) fill(c, 2, rect(x - 10 + (b - y) / 12, y, x + 10 - (b - y) / 12, y + 5), "#1a2447");
  fill(c, 2, rect(x - 9, b - 88, x + 9, b - 78), SIL[1]);
  fill(c, 3, rect(x - 6, b - 86, x + 6, b - 80), "#c8a85a"); // the lamp
  px(c, 3, [[x - 1, b - 84], [x, b - 84]], "#fff2c0");
  paint(c, 2, poly([[x - 11, b - 88], [x, b - 100], [x + 11, b - 88]]), SIL, { base: 1, blur: 2, k: 2 });
  // the beam: sparse light across the dark, left of the tower
  for (let xx = x - 8; xx > 20; xx--) {
    const spread = (x - xx) * 0.16 + 2;
    for (let yy = Math.round(b - 83 - spread); yy <= Math.round(b - 83 + spread); yy++) {
      if ((xx + yy) % 3 === 0 && ((xx >> 1) + yy) % 2 === 0) px(c, 7, [[xx, yy]], mix("#0b1020", "#a89a6a", Math.max(0.1, 0.5 - (x - xx) / 400)));
    }
  }
  for (let i = 0; i < 8; i++) {
    const mx = 20 + i * 15, mb = onRidge(mx);
    fill(c, 4, rect(mx, mb - 12, mx + 1, mb), INK);
    paint(c, 5, union(rect(mx - 4, mb - 20, mx + 5, mb - 12), ellipse(mx + 0.5, mb - 20, 5, 3)), SIL, { base: 1, blur: 1, k: 1.5 });
    px(c, 6, [[mx + 5, mb - 22], [mx + 5, mb - 21], [mx + 6, mb - 22]], i % 3 === 0 ? "#8a2a2a" : "#2c3a68"); // flags
  }
  rim(c, "#7f94c4", [2, 5]);
}

const FAR_BY: Record<Family, (c: Canvas) => void> = { network: farNetwork, frontend: farFrontend, infra: farInfra, data: farData, comms: farComms };

/* ------------------------------------------------------------- mid props */

type Prop = [x: number, base: number, kind: string];
const PROPS: Record<Family, Prop[]> = {
  network: [[132, 181, "spool"], [158, 180, "post"], [182, 182, "spool"], [214, 180, "post"], [96, 183, "post"], [244, 182, "spool"], [76, 181, "spool"]],
  frontend: [[130, 181, "frame"], [160, 180, "cursor"], [188, 182, "frame"], [218, 181, "frame"], [100, 183, "cursor"], [246, 182, "frame"], [78, 181, "frame"]],
  infra: [[132, 181, "crate"], [160, 181, "cog"], [188, 182, "pipe"], [220, 181, "crate"], [100, 183, "cog"], [246, 182, "pipe"], [78, 181, "crate"]],
  data: [[132, 181, "slab"], [158, 180, "slab"], [184, 182, "slab"], [214, 181, "slab"], [100, 183, "slab"], [244, 182, "slab"], [76, 181, "slab"]],
  comms: [[132, 181, "mailbox"], [158, 181, "letters"], [184, 182, "mailbox"], [216, 181, "letters"], [100, 183, "mailbox"], [246, 182, "letters"], [78, 181, "mailbox"]],
};
const PR = ["#05070f", "#0d1226", "#171e3c", "#273360", "#3a4a80"];

function prop(c: Canvas, part: number, [x, b, kind]: Prop, i: number) {
  const r = rng(x * 7 + i);
  switch (kind) {
    case "spool": // a cable drum
      paint(c, part, union(ellipse(x + 8, b - 9, 8, 9), rect(x, b - 14, x + 16, b - 4)), PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      fill(c, part, ellipse(x + 8, b - 9, 2.4, 2.4), PR[0]);
      for (let k = 0; k < 4; k++) line(c, part, [x + 1, b - 13 + k * 3], [x + 15, b - 13 + k * 3], PR[1]);
      px(c, part, [[x + 15, b - 12], [x + 15, b - 9]], PR[4]);
      break;
    case "post": // an antenna post
      fill(c, part, rect(x, b - 30, x + 1, b), PR[0]);
      fill(c, part, rect(x - 5, b - 26, x + 6, b - 25), PR[0]); fill(c, part, rect(x - 3, b - 21, x + 4, b - 20), PR[0]); fill(c, part, rect(x - 2, b - 16, x + 3, b - 15), PR[0]);
      px(c, part, [[x + 1, b - 30], [x + 6, b - 26]], PR[4]);
      break;
    case "frame": // a standing window frame
      paint(c, part, diff(rect(x, b - 24, x + 15, b), rect(x + 3, b - 19, x + 12, b - 4)), PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      fill(c, part, rect(x + 3, b - 19, x + 12, b - 4), "#04060c");
      line(c, part, [x + 4, b - 18], [x + 11, b - 6], PR[1]);
      px(c, part, [[x + 15, b - 22], [x + 15, b - 18]], PR[4]);
      break;
    case "cursor":
      paint(c, part, poly([[x, b - 26], [x, b], [x + 5, b - 6], [x + 9, b + 1], [x + 12, b - 1], [x + 8, b - 8], [x + 14, b - 8]]), PR, { base: 2, blur: 2, k: 2.4, dither: 0.15 });
      break;
    case "crate":
      paint(c, part, rect(x, b - 14, x + 15, b), PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      line(c, part, [x, b - 14], [x + 15, b], PR[1]); line(c, part, [x + 15, b - 14], [x, b], PR[1]);
      px(c, part, [[x + 15, b - 13], [x + 15, b - 8]], PR[4]);
      break;
    case "cog": {
      const g: Pred = (xx, yy) => {
        const d = Math.hypot(xx + 0.5 - (x + 9), yy + 0.5 - (b - 10)), a = Math.atan2(yy + 0.5 - (b - 10), xx + 0.5 - (x + 9));
        return d <= 8 + (Math.sin(a * 8) > 0.2 ? 2.4 : 0) && d >= 3;
      };
      paint(c, part, g, PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      break;
    }
    case "pipe":
      paint(c, part, rect(x, b - 9, x + 24, b - 2), PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      fill(c, part, rect(x - 1, b - 11, x + 1, b), PR[1]); fill(c, part, rect(x + 22, b - 11, x + 24, b), PR[1]);
      break;
    case "slab":
      paint(c, part, rect(x, b - 30 - ((i * 7) % 12), x + 11, b), PR, { base: 2, blur: 2, k: 2.4, dither: 0.2 });
      for (let yy = b - 26 - ((i * 7) % 12); yy < b - 3; yy += 4) for (let xx = x + 2; xx < x + 10; xx += 3) if (r() > 0.45) px(c, part, [[xx, yy]], r() > 0.8 ? "#4fb0b8" : "#1f5a62");
      break;
    case "mailbox":
      fill(c, part, rect(x + 6, b - 10, x + 7, b), PR[0]);
      paint(c, part, union(rect(x, b - 20, x + 13, b - 10), ellipse(x + 6.5, b - 20, 6.5, 3.5)), PR, { base: 2, blur: 2, k: 2.2 });
      px(c, part, [[x + 14, b - 22], [x + 14, b - 21], [x + 15, b - 22]], i % 2 ? "#8a2a2a" : "#2c3a68");
      break;
    case "letters":
      for (let k = 0; k < 3; k++) {
        paint(c, part, rect(x + k * 3, b - 6 - k * 5, x + 15 + k * 3, b - k * 5), PR, { base: 2, blur: 1, k: 1.6 });
        line(c, part, [x + k * 3, b - 6 - k * 5], [x + 7 + k * 3, b - 2 - k * 5], PR[1]); line(c, part, [x + 15 + k * 3, b - 6 - k * 5], [x + 8 + k * 3, b - 2 - k * 5], PR[1]);
      }
      break;
  }
}

function drawMidFor(f: Family): Canvas {
  const c = new Canvas(SW, SH);
  const ground = (x: number) => Math.round(172 + 4 * Math.sin(x / 23) + 2 * Math.sin(x / 8 + 1));
  paint(c, 1, (x, y) => y >= ground(x), ["#080b17", "#0d1226", "#141b36", "#1e2a50"], { base: 1, blur: 6, k: 1.8, dither: 0.25 });
  PROPS[f].forEach((p, i) => prop(c, 3 + i, p, i));
  rim(c, "#7f94c4", [3, 4, 5, 6, 7, 8, 9]);
  return c;
}

export function buildThemes() {
  for (const f of FAMILIES) {
    const far = new Canvas(SW, SH);
    ridge(far);
    FAR_BY[f](far);
    const mid = drawMidFor(f);
    writeFile(`${OUT}/far-${f}.png`, canvasPng(grade(far, 0.5, 0.82)));
    writeFile(`${OUT}/mid-${f}.png`, canvasPng(grade(mid, 0.5, 0.8)));
    // preview at 2x: sky + far + mid + near + a fog band
    const comp = new Canvas(SW, SH);
    const near = drawNear();
    deadBranches(near);
    for (const layer of [grade(drawSky(), 0.55, 0.78, false), grade(far.clone(), 0.5, 0.82), grade(mid.clone(), 0.5, 0.8), grade(near, 0.5, 0.85)]) for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = layer.get(x, y); if (v) comp.set(x, y, v); }
    const fog = drawFog();
    for (let y = 0; y < 72; y++) for (let x = 0; x < SW; x++) { const v = fog.get(x, y); if (v) comp.set(x, 150 + y, mix(comp.get(x, 150 + y) ?? "#000000", v, 0.2)); }
    writeFile(`/tmp/gitghost-art/scene-${f}.png`, canvasPng(comp, 2));
  }
}

if (process.argv[1]?.endsWith("scene-themes.mts")) {
  buildThemes();
  console.log("wrote themed far and mid layers to", OUT);
}
void SH;
