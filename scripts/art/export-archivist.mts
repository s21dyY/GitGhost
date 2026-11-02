/**
 * Exports the Archivist art as static PNGs (64x80, 1 art pixel = 1 image pixel) plus a manifest the tests read.
 * Run: node scripts/art/export-archivist.mts
 * Deterministic: no randomness beyond the seeded noise inside the art scripts.
 */
import { createHash } from "node:crypto";
import { drawStage, W, H, type Stage, type Pose } from "./archivist.mts";
import { canvasPng, writeFile } from "./kit.mts";

const STAGES: Stage[] = ["human", "distorted", "transformed"];
const POSES: Pose[] = ["idle", "thinking", "speaking", "blink"];
const masks: Record<string, string[]> = {};
const grids: Record<string, (string | null)[]> = {};
const frames: Record<string, { opaque: number; bbox: [number, number, number, number]; bookHash: string; bookShape: string; frameHash: string; headRows: [number, number]; poseDiff: [number, number, number, number] | null }> = {};

for (const st of STAGES) {
  for (const po of POSES) {
    const c = drawStage(st, po);
    grids[`${st}-${po}`] = Array.from({ length: W * H }, (_, i) => c.get(i % W, Math.floor(i / W)));
    writeFile(`public/sprites/archivist/${st}-${po}.png`, canvasPng(c, 1, null));
    let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    const book = createHash("sha1"), shape = createHash("sha1"), whole = createHash("sha1");
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = c.get(x, y);
      whole.update(`${v ?? "-"},`);
      if (v) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      // the book and clasp region (below the chin, above the hem); stays identical across stages and poses
      if (y >= 50 && y <= 62 && x >= 22 && x <= 42) { book.update(`${x},${y},${v ?? "-"};`); shape.update(v ? "1" : "0"); }
    }
    frames[`${st}-${po}`] = { opaque: n, bbox: [x0, y0, x1, y1], bookHash: book.digest("hex").slice(0, 12), bookShape: shape.digest("hex").slice(0, 12), frameHash: whole.digest("hex").slice(0, 12), headRows: [6, 38], poseDiff: null };
  }
}
// Where each pose differs from idle (bounding box of changed pixels), and the idle silhouette of each stage as hex rows.
for (const st of STAGES) {
  const idle = grids[`${st}-idle`];
  masks[st] = Array.from({ length: H }, (_, y) => {
    let bits = "";
    for (let x = 0; x < W; x++) bits += idle[y * W + x] ? "1" : "0";
    return BigInt("0b" + bits).toString(16).padStart(W / 4, "0");
  });
  for (const po of POSES) {
    if (po === "idle") continue;
    const g = grids[`${st}-${po}`];
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y * W + x] !== idle[y * W + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    frames[`${st}-${po}`].poseDiff = x1 < 0 ? null : [x0, y0, x1, y1];
  }
}
writeFile("src/components/entity/archivist/art.manifest.json", JSON.stringify({ width: W, height: H, frames, idleMasks: masks }, null, 1) + "\n");
console.log("exported", Object.keys(frames).length, "frames");
