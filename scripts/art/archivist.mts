/**
 * The Archivist ghost, authored as shaded pixel art on a 64 x 80 grid.
 * Three stages share one pose, one coat, one book and one brass clasp:
 *   human       the imagined original person
 *   distorted   pages climb the jaw, ink under one eye, the hem starts to dissolve
 *   transformed the face has become an open book with two watching eyes
 * Run: node scripts/art/archivist.mts   (writes previews to /tmp/gitghost-art)
 */
import { Canvas, bayer, diff, ellipse, fill, inter, line, mix, noise2, outline, paint, poly, px, rect, stamp, union, writeFile, canvasPng, type Pred, type Pt } from "./kit.mts";

export const W = 64;
export const H = 80;
export type Stage = "human" | "distorted" | "transformed";

export const P = { hairBack: 0, coat: 1, neck: 2, collar: 3, head: 4, hairFront: 5, sleeveL: 6, sleeveR: 7, book: 8, pages: 9, hands: 10, clasp: 11, ink: 12, extra: 13 } as const;
export const ORDER: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 6, 8: 7, 9: 7.5, 10: 8, 11: 9, 12: 9.5, 13: 5.5 };

export const INK = "#090b16";

export type Look = {
  skin: string[]; hair: string[]; coat: string[]; paper: string[]; cover: string[]; brass: string[];
  iris: string; sclera: string; lid: string; ring: string; brow: string; mouth: string; lip: string;
  outer: string;
};

export const HUMAN: Look = {
  // waxy, greyed skin; a coat that has lost its color; eyes that have stopped catching the light
  skin: ["#262c34", "#45505a", "#78837f", "#a2aba3", "#c6ccc2"],
  hair: ["#06070d", "#0e1019", "#181c2c", "#272d44", "#3b4465"],
  coat: ["#0b141b", "#142330", "#203746", "#2f5062", "#4f7686"],
  paper: ["#6b6558", "#a39d8a", "#cdc6b3", "#ece6d4"],
  cover: ["#10201f", "#182f2c", "#244640", "#386a5c"],
  brass: ["#4a3416", "#7d5a22", "#b08a48", "#dcc47e"],
  iris: "#3b5a62", sclera: "#c9c7b9", lid: "#4a3d40", ring: "#4b3a48", brow: "#0e1019", mouth: "#3a2a2e", lip: "#8a6e6a",
  outer: "#05070d",
};

/** Colder, greyer, bluer: the same character a long time after. */
export const HORROR: Look = {
  skin: ["#1f2830", "#394650", "#667782", "#8fa1a8", "#b6c6c6"],
  hair: ["#05060b", "#0b0d16", "#141827", "#202641", "#343e66"],
  coat: ["#070d13", "#0d1a26", "#162b3b", "#213f52", "#3a6679"],
  paper: ["#5f5b50", "#8f8a79", "#bab49f", "#d9d3bf"],
  cover: ["#0b1819", "#122523", "#1c3a36", "#2d5a50"],
  brass: ["#3b2a12", "#6c501f", "#9a7a3f", "#c4ab6b"],
  iris: "#7fc2b9", sclera: "#c9d4cf", lid: "#2a3440", ring: "#4b2f3d", brow: "#05060b", mouth: "#1b222b", lip: "#5d6f77",
  outer: "#04060b",
};

/* ---------- shapes ---------- */
export const head: Pred = (x, y) => {
  const cx = 32, cy = 21.5, rx = 10.8, ry = 13;
  const dy = (y + 0.5 - cy) / ry;
  if (Math.abs(dy) > 1) return false;
  const w = rx * Math.sqrt(1 - dy * dy) * (dy > 0 ? 1 - 0.36 * dy : 1);
  return Math.abs(x + 0.5 - cx) <= w;
};
const neck = rect(28, 31, 35, 38);
const hairBack = union(
  ellipse(32, 19.5, 13.2, 14.5),
  poly([[18.5, 18], [23, 20], [23, 37], [20.5, 38.5], [18, 33]]),
  poly([[45.5, 18], [41, 20], [41, 37], [43.5, 38.5], [46, 33]]),
);
const coat = poly([
  [23, 34.5], [27, 33], [37, 33], [41, 36], [45.5, 40.5], [46, 49], [43.5, 55], [47, 65], [52.5, 76], [47, 77.5], [40, 77], [32, 78], [24, 77], [17, 77.5], [11.5, 76], [17, 65], [20.5, 55], [18, 48], [18.5, 38],
]);
const sleeveL = poly([[17, 40], [22.5, 35.5], [27.5, 38], [28.5, 47], [27.5, 55], [23.5, 59.5], [18.5, 57.5], [17.5, 49]]);
const sleeveR = poly([[47, 42], [41.5, 37], [36.5, 39], [35.5, 47], [36.5, 55], [40.5, 59.5], [45.5, 57.5], [46.5, 50]]);
const collar = poly([[26, 32], [29, 36.5], [32, 39.5], [35, 36.5], [38, 32], [36, 31], [32, 33.5], [28, 31]]);
const BOOK = { x0: 23, y0: 43, x1: 40, y1: 57 };
const book = rect(BOOK.x0, BOOK.y0, BOOK.x1, BOOK.y1);
const pages = union(rect(41, 44, 42, 57), rect(41, 58, 42, 58));
const handL = union(ellipse(23.6, 56, 3.6, 3.6), rect(23, 51, 26, 57));
const handR = union(ellipse(40.4, 56, 3.6, 3.6), rect(37, 51, 40, 57));
const cuffL = poly([[18.5, 55], [27, 55], [27, 57.5], [19.5, 58.5]]);
const cuffR = poly([[45.5, 55], [37, 55], [37, 57.5], [44.5, 58.5]]);

/** A tiny brass hand: the clasp. */
const CLASP_X = 29, CLASP_Y = 47;
const CLASP = [
  ".a.a.b.",
  ".aabab.",
  "aaaabaa",
  ".aaaaa.",
  ".aaaa..",
  "..aa...",
];

export function drawBody(c: Canvas, L: Look, stage: Stage) {
  paint(c, P.hairBack, hairBack, L.hair, { base: 1, blur: 4, k: 2.6, dither: 0.25 });
  paint(c, P.coat, coat, L.coat, { base: 1, blur: 4, k: 3, dither: 0.3 });
  paint(c, P.neck, neck, L.skin, { base: 1, blur: 2, k: 2 });
  paint(c, P.collar, collar, L.paper, { base: 2, blur: 2, k: 2 });
  // sleeves: slightly lighter than the coat so the arms read as separate forms
  paint(c, P.sleeveL, sleeveL, L.coat, { base: 2, blur: 3, k: 2.6, dither: 0.25 });
  paint(c, P.sleeveR, sleeveR, L.coat, { base: 2, blur: 3, k: 2.6, dither: 0.25 });

  // pale cuffs where the sleeves end
  fill(c, P.sleeveL, cuffL, L.paper[2]);
  fill(c, P.sleeveR, cuffR, L.paper[2]);
  line(c, P.sleeveL, [19, 58], [27, 56], L.paper[1]);
  line(c, P.sleeveR, [45, 58], [37, 56], L.paper[1]);
  line(c, P.sleeveL, [19, 55], [27, 55], L.paper[3]);
  line(c, P.sleeveR, [45, 55], [37, 55], L.paper[3]);

  // coat folds: dark creases fanning from the waist, thin highlights beside them
  const crease = L.coat[0], lit = L.coat[3];
  const folds: [Pt, Pt][] = [[[26, 56], [21, 76]], [[30, 59], [27, 77]], [[34, 60], [37, 78]], [[38, 58], [44, 77]], [[22, 52], [17, 70]]];
  for (const [a, b] of folds) { line(c, P.coat, a, b, crease, { only: [P.coat] }); line(c, P.coat, [a[0] + 1, a[1]], [b[0] + 1, b[1]], lit, { only: [P.coat] }); }
  // buttons down the front, between the book and the hem
  px(c, P.coat, [[32, 62], [32, 67], [32, 72]], L.brass[2]);
  px(c, P.coat, [[33, 62], [33, 67], [33, 72]], L.brass[0]);
  // belt
  line(c, P.coat, [21, 57], [43, 57], L.coat[0], { only: [P.coat] });

  // book: cover, spine, page block, brass corners, clasp
  paint(c, P.book, book, L.cover, { base: 2, blur: 2, k: 2.4 });
  fill(c, P.book, rect(BOOK.x0, BOOK.y0, BOOK.x0 + 2, BOOK.y1), L.cover[0]); // spine
  fill(c, P.book, rect(BOOK.x0 + 3, BOOK.y0, BOOK.x0 + 3, BOOK.y1), L.cover[1]);
  fill(c, P.book, rect(BOOK.x0 + 5, BOOK.y0 + 2, BOOK.x1 - 2, BOOK.y0 + 2), L.cover[3]); // embossed border
  fill(c, P.book, rect(BOOK.x0 + 5, BOOK.y1 - 2, BOOK.x1 - 2, BOOK.y1 - 2), L.cover[1]);
  fill(c, P.book, rect(BOOK.x0 + 5, BOOK.y0 + 3, BOOK.x0 + 5, BOOK.y1 - 3), L.cover[3]);
  fill(c, P.book, rect(BOOK.x1 - 2, BOOK.y0 + 3, BOOK.x1 - 2, BOOK.y1 - 3), L.cover[1]);
  for (const [x, y] of [[BOOK.x0 + 5, BOOK.y0 + 2], [BOOK.x1 - 2, BOOK.y0 + 2], [BOOK.x0 + 5, BOOK.y1 - 2], [BOOK.x1 - 2, BOOK.y1 - 2]] as Pt[]) px(c, P.book, [[x, y]], L.brass[2]);
  paint(c, P.pages, pages, L.paper, { base: 2, blur: 1, k: 1.2 });
  for (let y = 45; y <= 57; y += 2) fill(c, P.pages, rect(41, y, 42, y), L.paper[1]);
  stamp(c, P.clasp, CLASP_X, CLASP_Y, CLASP, { a: L.brass[2], b: L.brass[3] });
  px(c, P.clasp, [[CLASP_X + 1, CLASP_Y + 5], [CLASP_X + 4, CLASP_Y + 3], [CLASP_X + 5, CLASP_Y + 2], [CLASP_X + 5, CLASP_Y + 4]].map(([x, y]) => [x, y] as Pt), L.brass[1]);
  px(c, P.clasp, [[CLASP_X + 3, CLASP_Y + 6]], L.brass[0]);

  if (stage === "transformed") {
    // paper fingers: long, pale and one too many, curling over the cover edge
    paint(c, P.hands, union(handL, handR), L.paper, { base: 2, blur: 1.5, k: 2 });
    for (const [x, y] of [[24, 51], [25, 52], [24, 49], [25, 50], [39, 51], [38, 52], [39, 49], [38, 50]] as Pt[]) c.set(x, y, L.paper[3], P.hands);
    for (const [x, y] of [[26, 53], [26, 55], [37, 53], [37, 55]] as Pt[]) c.set(x, y, L.paper[1], P.hands);
  } else {
    paint(c, P.hands, union(handL, handR), L.skin, { base: 2, blur: 1.5, k: 2 });
    drawFingers(c, L, stage);
  }
  // Uncanny tailoring pass: a sloping mantle and loose, uneven fabric break
  // the rigid triangular silhouette without changing the book or its clasp.
  const mantleL = poly([[18, 37], [14, 39], [11, 47], [8, 55], [12, 53], [10, 61], [17, 56], [21, 43]]);
  const mantleR = poly([[45, 38], [49, 41], [50, 49], [55, 56], [50, 54], [53, 63], [46, 58], [42, 44]]);
  paint(c, P.extra, mantleL, L.coat, { base: 1, blur: 2, k: 2.2, dither: 0.15 });
  paint(c, P.extra, mantleR, L.coat, { base: 0, blur: 2, k: 2.2, dither: 0.16 });
  // Light follows the uneven cloth edges; shadows stay consistent with the
  // original upper-left moonlight, and the silhouette is not mirror-symmetric.
  line(c, P.extra, [15, 40], [9, 55], L.coat[3], { only: [P.extra] });
  line(c, P.extra, [47, 40], [53, 60], L.coat[2], { only: [P.extra] });
  for (const [x, y] of [[11, 56], [12, 57], [13, 55], [50, 59], [51, 60], [52, 61]] as Pt[])
    if (c.partAt(x, y) === P.extra) c.set(x, y, null, -1);
  // Fine worn seams and uneven amber stitches, visible at the existing size.
  for (const [x, y] of [[21, 40], [20, 44], [20, 48], [45, 44], [46, 49], [45, 53], [25, 63], [39, 67]] as Pt[])
    if (c.partAt(x, y) >= 0) c.set(x, y, L.brass[1], P.extra);
  drawWear(c, L, stage);
}

/**
 * Long pale fingers clamped over the cover edge. Everything here lies inside the book's footprint, so the
 * book and clasp keep exactly the same silhouette in every form. Distorted: longer, greyer, nails dark.
 */
function drawFingers(c: Canvas, L: Look, stage: Stage) {
  const lens = stage === "distorted" ? [5, 7, 7, 5] : [3, 4, 4, 3];
  for (const side of [-1, 1]) {
    lens.forEach((len, k) => {
      const x = side < 0 ? 24 + k : 39 - k;
      for (let i = 0; i < len; i++) c.set(x, 50 - i, i === len - 1 && stage === "distorted" ? L.skin[0] : i === 0 ? L.skin[2] : L.skin[3], P.hands);
      if (k % 2 === 0) c.set(x, 51, L.skin[1], P.hands); // knuckle shadow
    });
    // the gaps between the fingers
    for (const gx of side < 0 ? [24, 26] : [39, 37]) c.set(gx + (side < 0 ? 0.0 : 0.0), 50 - (stage === "distorted" ? 5 : 3), L.skin[0], P.hands);
  }
}

/**
 * Wear and damage. Torn hem, stains, frayed sleeves. All of it is kept OUTSIDE the book's footprint
 * (x 22 to 42, y 50 to 62) so the book and clasp stay identical in every form and pose.
 */
function drawWear(c: Canvas, L: Look, stage: Stage) {
  const erase = (pred: Pred) => {
    for (let y = 63; y < c.h; y++) for (let x = 0; x < c.w; x++) if (c.partAt(x, y) === P.coat && pred(x, y)) c.set(x, y, null, -1);
  };
  erase(union(rect(15, 75, 16, 77), rect(29, 76, 30, 77), rect(44, 75, 45, 77)));
  if (stage !== "human") {
    erase(union(rect(24, 70, 25, 77), rect(38, 72, 38, 77), rect(19, 74, 21, 77), poly([[33, 68], [35, 68], [34, 77]])));
    for (const [x, y] of [[17, 56], [18, 57], [17, 52], [46, 55], [45, 57], [46, 51]] as Pt[]) if (c.partAt(x, y) >= 0) c.set(x, y, null, -1);
  }
  const n = noise2(7);
  const strength = stage === "human" ? 0.66 : stage === "distorted" ? 0.56 : 0.52;
  for (let y = 63; y < 77; y++) for (let x = 12; x < 53; x++) {
    if (c.partAt(x, y) !== P.coat) continue;
    if (n(x * 0.18, y * 0.22) > strength) c.set(x, y, mix(c.get(x, y)!, L.coat[0], 0.6), P.coat);
  }
}

/* ---------- face ---------- */
const EYE_L = { x: 24, y: 19 }; // top-left of the left eye block (7 wide)
const EYE_R = { x: 33, y: 19 };

type EyeKind = "open" | "up" | "closed" | "wide";
type EyeShape = EyeKind | "hollow" | "hollowUp" | "stare" | "stareUp" | "slit";

function eyeRows(kind: EyeShape): string[] {
  // l lid crease, L heavy lid, w sclera, i iris, p pupil, h highlight, r under-eye ring, o empty socket, g glow
  switch (kind) {
    case "closed": return ["lllllll", "LLLLLLL", ".rrrrr.", "......."];
    case "up": return ["lLLLLLl", "wwiIiww", "wwwiwww", ".rrrrr."];
    case "wide": return ["lllllll", "wiiiiiw", "wihpiiw", ".rrrrr."];
    // a sunken socket with a single pinprick of light: nothing behind it looks back, but something does
    case "hollow": return ["lLLLLLl", "LoooooL", "LooggoL", ".rrrrr."];
    case "hollowUp": return ["lLLLLLl", "LooggoL", "LoooooL", ".rrrrr."];
    // an eye that is too open, with a pupil too small
    case "stare": return ["lwwwwwl", "wwwwwww", "wwwpwww", ".rwwwr."];
    case "stareUp": return ["lwwwwwl", "wwwpwww", "wwwwwww", ".rwwwr."];
    // the lid will not quite close
    case "slit": return ["lllllll", "LLLgLLL", ".rrrrr.", "......."];
    default: return ["lLLLLLl", "wwiiiww", "wwiPiww", ".rrrrr."];
  }
}

function drawEye(c: Canvas, L: Look, ox: number, oy: number, kind: EyeShape) {
  const glow = mix(L.iris, "#d7f5ee", 0.3);
  const key: Record<string, string> = { l: L.lid, L: mix(L.lid, INK, 0.45), w: L.sclera, i: L.iris, I: mix(L.iris, INK, 0.5), p: INK, P: INK, h: "#ffffff", r: L.ring, o: mix(INK, L.ring, 0.3), g: glow };
  stamp(c, P.head, ox, oy, eyeRows(kind), key);
}

function drawFace(c: Canvas, L: Look, o: { pose: Pose; stage: Stage }) {
  const { skin } = L;
  const pz = POSES[o.pose];
  const distorted = o.stage === "distorted";
  // hollow cheeks under the cheekbones, and a shadowed temple
  px(c, P.head, [[24, 26], [24, 27], [25, 28], [25, 29], [26, 30], [40, 26], [40, 27], [39, 28], [39, 29], [38, 30]], skin[0]);
  px(c, P.head, [[22, 22], [22, 23], [22, 24]], skin[1]);
  // nose: a thin lit ridge, dark nostrils
  px(c, P.head, [[32, 22], [32, 23], [32, 24]], skin[3]);
  px(c, P.head, [[31, 25], [33, 25]], skin[0]);
  px(c, P.head, [[32, 25]], skin[1]);
  px(c, P.head, [[30, 24]], skin[1]);

  if (!distorted) {
    // human: tired and wary, one eye a pixel lower than the other
    line(c, P.head, [23, 17], [30, 15], L.brow);
    line(c, P.head, [23, 18], [29, 16], L.brow);
    line(c, P.head, [40, 18], [33, 15], L.brow);
    line(c, P.head, [40, 19], [34, 16], L.brow);
    drawEye(c, L, EYE_L.x, EYE_L.y, pz.eyes);
    drawEye(c, L, EYE_R.x, EYE_R.y + 1, pz.eyes);
    if (pz.mouth === "open") {
      fill(c, P.head, rect(29, 28, 35, 31), L.mouth);
      fill(c, P.head, rect(30, 28, 34, 28), "#d9d3bf");
      fill(c, P.head, rect(31, 31, 33, 31), "#5d3236");
    } else {
      line(c, P.head, [30, 29], [34, 29], L.mouth);
      px(c, P.head, [[29, 30], [35, 30]], L.mouth);
      px(c, P.head, [[31, 30], [32, 30], [33, 30]], skin[1]);
    }
    px(c, P.head, [[33, 31], [34, 31]], skin[3]);
    return;
  }

  // distorted: the left eye is an empty socket with a point of light, the right one stares, they sit at
  // different heights, one brow is heavy and low, the other lifted, and the mouth is a little too wide
  line(c, P.head, [23, 18], [30, 19], L.brow);
  line(c, P.head, [23, 17], [29, 18], L.brow);
  line(c, P.head, [34, 15], [40, 16], L.brow);
  const left: EyeShape = pz.eyes === "closed" ? "slit" : pz.eyes === "up" ? "hollowUp" : "hollow";
  const right: EyeShape = pz.eyes === "closed" ? "closed" : pz.eyes === "up" ? "stareUp" : "stare";
  drawEye(c, L, EYE_L.x, EYE_L.y + 1, left);
  drawEye(c, L, EYE_R.x, EYE_R.y - 1, right);
  if (pz.mouth === "open") {
    fill(c, P.head, rect(29, 28, 37, 32), L.mouth);
    fill(c, P.head, rect(30, 28, 36, 28), mix(skin[4], "#d9d3bf", 0.5));
    fill(c, P.head, rect(31, 31, 35, 32), "#0a0d12");
  } else {
    line(c, P.head, [28, 29], [33, 29], L.mouth);
    line(c, P.head, [34, 28], [37, 27], L.mouth);
    px(c, P.head, [[27, 30], [38, 26]], L.mouth);
    px(c, P.head, [[30, 30], [31, 30], [32, 30]], skin[1]);
  }
  px(c, P.head, [[33, 32], [34, 31]], skin[3]);
}

export function drawHairFront(c: Canvas, L: Look) {
  // a parted fringe that falls across the brow, with side locks in front of the ears
  const hairline: Pred = (x, y) => y < 12.5 + 5.5 * Math.min(1, Math.abs(x + 0.5 - 29.5) / 9.5) - (x < 29.5 ? 0 : 0.5);
  const fr = inter(head, hairline);
  const lockL = poly([[20, 14], [24, 15], [24.5, 24], [26.2, 27], [26.5, 32], [24, 34], [20.5, 31], [19, 24]]);
  const lockR = poly([[44, 14], [40, 15], [39.5, 24], [37.8, 27], [37.5, 32], [40, 34], [43.5, 31], [45, 24]]);
  const cap = union(fr, diff(ellipse(32, 18.6, 11.9, 12.2), (x, y) => y > 14 + 2 * Math.abs(x - 32) / 10), lockL, lockR);
  paint(c, P.hairFront, diff(cap, (x, y) => y >= 34), L.hair, { base: 2, blur: 3, k: 3, dither: 0.25 });
  // strands
  line(c, P.hairFront, [29, 8], [24, 17], L.hair[3], { only: [P.hairFront] });
  line(c, P.hairFront, [31, 8], [27, 15], L.hair[3], { only: [P.hairFront] });
  line(c, P.hairFront, [34, 8], [39, 14], L.hair[3], { only: [P.hairFront] });
  line(c, P.hairFront, [29, 11], [30, 17], L.hair[0], { only: [P.hairFront] });
  line(c, P.hairFront, [33, 10], [34, 16], L.hair[1], { only: [P.hairFront] });
  px(c, P.hairFront, [[26, 16], [27, 17], [28, 17]], L.hair[1]);
  // a loose strand over the face
  px(c, P.hairFront, [[30, 17], [30, 18], [29, 19]], L.hair[2]);
}


export type Pose = "idle" | "thinking" | "speaking" | "blink";
const POSES: Record<Pose, { eyes: EyeKind; mouth: "closed" | "open" | "worried" }> = {
  idle: { eyes: "open", mouth: "worried" },
  thinking: { eyes: "up", mouth: "closed" },
  speaking: { eyes: "open", mouth: "open" },
  blink: { eyes: "closed", mouth: "worried" },
};

const lerpArr = (a: string[], b: string[], t: number) => a.map((v, i) => mix(v, b[i], t));
export function lookFor(stage: Stage): Look {
  const t = stage === "human" ? 0 : stage === "distorted" ? 0.6 : 1;
  const A = HUMAN, B = HORROR;
  return {
    skin: lerpArr(A.skin, B.skin, t), hair: lerpArr(A.hair, B.hair, t), coat: lerpArr(A.coat, B.coat, t), paper: lerpArr(A.paper, B.paper, t),
    cover: lerpArr(A.cover, B.cover, t * 0.5), brass: lerpArr(A.brass, B.brass, t * 0.5),
    iris: mix(A.iris, B.iris, t), sclera: mix(A.sclera, B.sclera, t), lid: mix(A.lid, B.lid, t), ring: mix(A.ring, B.ring, t),
    brow: mix(A.brow, B.brow, t), mouth: mix(A.mouth, B.mouth, t), lip: mix(A.lip, B.lip, t), outer: mix(A.outer, B.outer, t),
  };
}

/** Erode the lower coat into wisps: a threshold that rises toward the hem, broken up by noise. */
export function dissolve(c: Canvas, fromY: number, strength: number, seed: number) {
  const n = noise2(seed);
  for (let y = fromY; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const p = c.partAt(x, y);
    if (p !== P.coat && p !== P.hairBack) continue;
    const depth = (y - fromY) / (c.h - fromY);
    const streak = n(x * 0.55, y * 0.16) * 0.7 + n(x * 1.7, y * 0.5) * 0.3; // vertical streaks
    if (streak + bayer(x, y) * 0.25 < depth * strength - 0.12) c.set(x, y, null, -1);
  }
}

export function addScraps(c: Canvas, L: Look, scraps: [number, number, number, number][]) {
  for (const [x, y, w, h] of scraps) {
    fill(c, P.extra, rect(x, y, x + w - 1, y + h - 1), L.paper[2]);
    fill(c, P.extra, rect(x, y, x + w - 1, y), L.paper[3]);
    fill(c, P.extra, rect(x, y + h - 1, x + w - 1, y + h - 1), L.paper[1]);
    if (w > 3) px(c, P.extra, [[x + 1, y + 1]], L.paper[0]);
  }
}

/* ---------- distorted: pages climb the jaw, ink runs from one eye ---------- */
function drawPagesOnJaw(c: Canvas, L: Look) {
  const sheets: Pt[][] = [
    [[20.5, 25], [29, 23], [31, 30], [28, 36], [21.5, 34]],
    [[27, 28], [34, 28.5], [35.5, 34], [30.5, 38], [26, 34]],
    [[31, 31], [37, 31.5], [36, 36], [32, 38]],
  ];
  sheets.forEach((pts, i) => {
    const part = 13 + i;
    ORDER[part] = 5.2 + i * 0.1;
    paint(c, part, poly(pts), L.paper, { base: 2, blur: 2, k: 2, dither: 0.2 });
    // lines of text
    const bb = poly(pts);
    for (let y = 24; y < 38; y += 2) for (let x = 20; x < 38; x++) if (bb(x, y) && (x + y * 3) % 7 !== 0) c.set(x, y, L.paper[0], part);
  });
  // ink running down from under the left eye, across the pages, with a heavy drip at the end
  const ink = mix(INK, L.skin[0], 0.1);
  for (const [x, y0, y1] of [[27, 23, 36], [28, 23, 31], [26, 24, 29]] as [number, number, number][]) {
    for (let y = y0; y <= y1; y++) c.set(x, y, ink, P.ink);
  }
  px(c, P.ink, [[27, 37], [27, 38], [28, 36], [26, 30], [29, 32]], ink);
  px(c, P.ink, [[24, 23], [25, 23], [29, 23]], mix(L.ring, INK, 0.6));
  // a bleed of crimson at the ink's edge
  px(c, P.ink, [[26, 25], [29, 26], [26, 33]], "#7a3a4c");
}

/* ---------- transformed: the head is an open book ---------- */
function drawBookHead(c: Canvas, L: Look, pose: Pose) {
  const dil = (x: number, y: number) => head(x, y) || head(x - 1, y) || head(x + 1, y) || head(x, y - 1) || head(x, y + 1);
  paint(c, P.head, dil, L.cover, { base: 2, blur: 3, k: 2.4, dither: 0.2 }); // cover behind the pages
  const pageMask: Pred = (x, y) => head(x, y) && !(x >= 31 && x <= 32);
  paint(c, P.pages, pageMask, L.paper, { base: 2, blur: 4, k: 2.6, dither: 0.2 });
  ORDER[P.pages] = 5.4;
  // spine gutter and the page-stack edge along the jaw
  fill(c, P.pages, rect(31, 8, 32, 33), L.paper[0], { clip: head });
  line(c, P.pages, [31, 9], [31, 32], mix(L.paper[0], INK, 0.5), { only: [P.pages] });
  for (let y = 28; y < 34; y += 2) fill(c, P.pages, (x, yy) => yy === y && head(x, yy) && x !== 31 && x !== 32, L.paper[1]);
  // text on the pages, broken where the eyes sit
  for (let y = 11; y < 29; y += 2) for (let x = 22; x < 42; x++) {
    if (!head(x, y) || x === 31 || x === 32) continue;
    if (y >= 18 && y <= 24 && ((x >= 24 && x <= 30) || (x >= 33 && x <= 39))) continue;
    if ((x * 5 + y * 3) % 9 < 6) c.set(x, y, L.paper[0], P.pages);
  }
  // two watching eyes: a teal glow with a dark pupil, dimmer when "thinking", a slit when blinking
  const glow = "#6bb8b1";
  const eyeAt = (cx: number) => {
    const up = pose === "thinking" ? -1 : 0;
    if (pose === "blink") { line(c, P.pages, [cx - 3, 21], [cx + 3, 21], mix(glow, INK, 0.3)); return; }
    fill(c, P.pages, ellipse(cx + 0.5, 21 + up, 4.2, 3.4), mix(glow, "#12313a", 0.55));
    fill(c, P.pages, ellipse(cx + 0.5, 21 + up, 3.1, 2.4), glow);
    fill(c, P.pages, rect(cx - 1, 20 + up, cx + 1, 22 + up), "#d8f3ef");
    fill(c, P.pages, rect(cx, 21 + up, cx, 21 + up), INK);
    fill(c, P.pages, rect(cx - 1, 20 + up, cx - 1, 20 + up), "#ffffff");
  };
  eyeAt(27);
  eyeAt(37);
  // a crimson bookmark ribbon hanging from the spine over the neck and collar
  const rib = "#9d596b";
  for (let y = 33; y < 44; y++) { c.set(31, y, rib, P.extra); c.set(32, y, mix(rib, INK, 0.25), P.extra); }
  px(c, P.extra, [[31, 44], [32, 45]], mix(rib, INK, 0.25));
  if (pose === "speaking") {
    // the pages part along the gutter
    fill(c, P.pages, rect(30, 24, 33, 32), INK, { clip: head });
    fill(c, P.pages, rect(31, 26, 32, 30), mix(glow, INK, 0.65));
  }
  // ink: the hair has become a cap that runs down the page edges
  const inkc = mix(INK, L.hair[2], 0.3);
  fill(c, P.hairFront, (x, y) => head(x, y) && y < 13 + 2 * Math.abs(x - 32) / 10, inkc);
  for (const [x, y1] of [[22, 22], [24, 17], [40, 20], [42, 25], [35, 15]] as [number, number][]) line(c, P.hairFront, [x, 11], [x, y1], inkc, { only: [P.pages, P.hairFront, P.head] });
  px(c, P.hairFront, [[22, 23], [24, 18], [40, 21], [42, 26]], inkc);
}

export function drawStage(stage: Stage, pose: Pose = "idle"): Canvas {
  const L = lookFor(stage);
  const c = new Canvas(W, H);
  drawBody(c, L, stage);
  if (stage === "transformed") {
    drawBookHead(c, L, pose);
  } else {
    paint(c, P.head, head, L.skin, { base: 2, blur: 5, k: 2.6, dither: 0.2 });
    drawFace(c, L, { pose, stage });
    drawHairFront(c, L);
    if (stage === "distorted") {
      drawPagesOnJaw(c, L);
    }
  }
  if (stage !== "human") {
    dissolve(c, stage === "distorted" ? 62 : 58, stage === "distorted" ? 1.35 : 1.9, stage === "distorted" ? 11 : 23);
    addScraps(c, L, stage === "distorted" ? [[8, 60, 3, 4], [53, 52, 3, 3], [12, 70, 2, 2]] : [[6, 30, 4, 5], [54, 24, 3, 4], [9, 58, 3, 3], [52, 66, 3, 3], [58, 46, 2, 2], [11, 48, 2, 3]]);
  }
  finish(c, L);
  return c;
}
export const drawHuman = (pose: Pose = "idle") => drawStage("human", pose);

function finish(c: Canvas, L: Look) {
  outline(c, {
    outer: () => L.outer,
    inner: (_p, col) => mix(col, L.outer, 0.62),
    order: (p) => ORDER[p] ?? p,
    sepParts: [P.coat, P.neck, P.collar, P.head, P.hairBack, P.sleeveL, P.sleeveR, P.book, P.hands, P.pages, 13, 14, 15],
  });
}

export const PREVIEW_BG = "#1a2038";

if (process.argv[1]?.endsWith("/archivist.mts")) {
  const out = "/tmp/gitghost-art";
  for (const st of ["human", "distorted", "transformed"] as Stage[]) writeFile(`${out}/${st}.png`, canvasPng(drawStage(st), 8, PREVIEW_BG));
  // contact sheet: stages x poses
  const poses: Pose[] = ["idle", "thinking", "speaking", "blink"];
  const sheet = new Canvas(W * 4, H * 3);
  (["human", "distorted", "transformed"] as Stage[]).forEach((st, r) => poses.forEach((po, k) => {
    const cc = drawStage(st, po);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = cc.get(x, y); if (v) sheet.set(k * W + x, r * H + y, v); }
  }));
  writeFile(`${out}/sheet.png`, canvasPng(sheet, 3, PREVIEW_BG));
  console.log("wrote", out);
}
