/**
 * Tiny pixel-art toolkit used to author GitGhost's sprites and scenery in code.
 * Everything is deterministic (no Math.random) so regenerated art is byte-identical.
 * Output: palette-indexed grids (for the app) and PNG files (for scenery and previews).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type Pred = (x: number, y: number) => boolean;
export type Pt = [number, number];

export const ellipse = (cx: number, cy: number, rx: number, ry: number): Pred => (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1;
export const rect = (x0: number, y0: number, x1: number, y1: number): Pred => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
export const poly = (pts: Pt[]): Pred => (x, y) => {
  const px = x + 0.5, py = y + 0.5;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
export const union = (...p: Pred[]): Pred => (x, y) => p.some((f) => f(x, y));
export const inter = (a: Pred, b: Pred): Pred => (x, y) => a(x, y) && b(x, y);
export const diff = (a: Pred, b: Pred): Pred => (x, y) => a(x, y) && !b(x, y);
/** Mirror a predicate around the vertical axis x = cx (cx in pixel units, e.g. 32 for a 64-wide canvas). */
export const mirror = (p: Pred, cx: number): Pred => (x, y) => p(x, y) || p(Math.round(2 * cx - 1 - x), y);

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
/** Smooth value noise in [0,1], deterministic. */
export function noise2(seed: number) {
  const h = (x: number, y: number) => {
    let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
export const bayer = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

export const rgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const toHex = (c: number[]) => "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
export const mix = (a: string, b: string, t: number) => {
  const A = rgb(a), B = rgb(b);
  return toHex(A.map((v, i) => v + (B[i] - v) * t));
};

export class Canvas {
  w: number;
  h: number;
  pix: (string | null)[];
  part: number[];
  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.pix = Array(w * h).fill(null);
    this.part = Array(w * h).fill(-1);
  }
  inb(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x: number, y: number) { return this.inb(x, y) ? this.pix[y * this.w + x] : null; }
  partAt(x: number, y: number) { return this.inb(x, y) ? this.part[y * this.w + x] : -1; }
  set(x: number, y: number, color: string | null, part = -2) {
    if (!this.inb(x, y)) return;
    this.pix[y * this.w + x] = color;
    if (part !== -2) this.part[y * this.w + x] = color === null ? -1 : part;
  }
  mask(p: Pred): Uint8Array {
    const m = new Uint8Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (p(x, y)) m[y * this.w + x] = 1;
    return m;
  }
  clone() {
    const c = new Canvas(this.w, this.h);
    c.pix = [...this.pix];
    c.part = [...this.part];
    return c;
  }
}

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += src[y * w + xx]; n++; } else { n++; } }
    tmp[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) s += tmp[yy * w + x]; n++; }
    out[y * w + x] = s / n;
  }
  return out;
}

export type PaintOpts = {
  /** Direction the light comes FROM, in screen space (default: upper right, the moon). */
  light?: [number, number];
  /** Level the flat interior uses (index into ramp). */
  base?: number;
  /** How strongly form shading moves the level. */
  k?: number;
  blur?: number;
  /** Only paint where this is true (and always set the part id). */
  clip?: Pred;
  /** Do not overwrite pixels of these parts. */
  under?: number[];
  dither?: number;
};

/**
 * Fill a shape with a shaded color ramp. Shading comes from the shape itself: a blurred copy of
 * the mask acts as a height field, its gradient gives a surface normal, and the normal against the
 * light picks the ramp level with ordered dithering at the transitions. This gives rounded forms
 * and rim light without hand-placing every pixel.
 */
export function paint(c: Canvas, part: number, pred: Pred, ramp: string[], o: PaintOpts = {}) {
  const { w, h } = c;
  const m = c.mask(pred);
  const f = Float32Array.from(m);
  const hgt = blur(f, w, h, Math.max(1, Math.round(o.blur ?? 3)));
  const L = o.light ?? [0.62, -0.78];
  const base = o.base ?? Math.floor(ramp.length / 2);
  const k = o.k ?? 3.2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    if (o.clip && !o.clip(x, y)) continue;
    if (o.under?.includes(c.part[y * w + x])) continue;
    const gx = (hgt[y * w + Math.min(w - 1, x + 1)] - hgt[y * w + Math.max(0, x - 1)]) / 2;
    const gy = (hgt[Math.min(h - 1, y + 1) * w + x] - hgt[Math.max(0, y - 1) * w + x]) / 2;
    // outward normal is -gradient of the blurred height; light dot normal in [-1, 1] scaled by edge steepness
    const light = (-gx * L[0] - gy * L[1]) * 6;
    const lvl = base + Math.round(light * k * 0.5 + bayer(x, y) * (o.dither ?? 0.35));
    c.set(x, y, ramp[Math.max(0, Math.min(ramp.length - 1, lvl))], part);
  }
}

/** Flat fill with a single color (details, features). */
export function fill(c: Canvas, part: number, pred: Pred, color: string, o: { clip?: Pred; under?: number[] } = {}) {
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    if (!pred(x, y)) continue;
    if (o.clip && !o.clip(x, y)) continue;
    if (o.under?.includes(c.part[y * c.w + x])) continue;
    c.set(x, y, color, part);
  }
}

export function line(c: Canvas, part: number, a: Pt, b: Pt, color: string, o: { under?: number[]; only?: number[] } = {}) {
  let [x0, y0] = a.map(Math.round);
  const [x1, y1] = b.map(Math.round);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    const cur = c.partAt(x0, y0);
    if (!(o.under?.includes(cur)) && (!o.only || o.only.includes(cur))) c.set(x0, y0, color, part);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function px(c: Canvas, part: number, pts: Pt[], color: string) {
  for (const [x, y] of pts) c.set(x, y, color, part);
}

/** Pixel rows from text: '.' skips, other chars look up in `key`. Origin at (ox, oy). */
export function stamp(c: Canvas, part: number, ox: number, oy: number, rows: string[], key: Record<string, string>) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== "." && key[ch]) c.set(ox + i, oy + j, key[ch], part); }));
}

/**
 * Selective outline. Outer silhouette gets a dark, part-tinted line OUTSIDE the shape;
 * where a front part overlaps a back part, the back part's border pixel is darkened so
 * head, hair, collar, sleeves, hands and book read as separate pieces.
 */
export function outline(c: Canvas, o: { outer: (part: number) => string; inner: (part: number, color: string) => string; order: (part: number) => number; sepParts?: number[] }) {
  const src = c.clone();
  const N: Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const p = src.partAt(x, y);
    if (p < 0) {
      // empty: look for a neighbor part to outline
      let best = -1;
      for (const [dx, dy] of N) { const q = src.partAt(x + dx, y + dy); if (q >= 0 && (best < 0 || o.order(q) < o.order(best))) best = q; }
      if (best >= 0) c.set(x, y, o.outer(best), 99);
    } else if (!o.sepParts || o.sepParts.includes(p)) {
      for (const [dx, dy] of N) {
        const q = src.partAt(x + dx, y + dy);
        if (q >= 0 && q !== p && o.order(q) > o.order(p)) { c.set(x, y, o.inner(p, src.get(x, y)!), p); break; }
      }
    }
  }
}

/* ---------- PNG output (no dependencies) ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** RGBA pixels (length w*h*4) to PNG bytes. */
export function pngBytes(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
export function writeFile(path: string, data: Buffer | string) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }

/** Canvas to PNG at an integer scale over an optional background color. */
export function canvasPng(c: Canvas, scale = 1, bg: string | null = null): Buffer {
  const W = c.w * scale, H = c.h * scale, out = new Uint8Array(W * H * 4);
  const B = bg ? rgb(bg) : null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = c.pix[Math.floor(y / scale) * c.w + Math.floor(x / scale)];
    const i = (y * W + x) * 4;
    if (p) { const v = rgb(p); out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2]; out[i + 3] = 255; }
    else if (B) { out[i] = B[0]; out[i + 1] = B[1]; out[i + 2] = B[2]; out[i + 3] = 255; }
  }
  return pngBytes(W, H, out);
}
