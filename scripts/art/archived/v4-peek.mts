/** Artist helper: render crops of V4 frames at a large scale. node scripts/art/v4-peek.mts <out.png> <scale> <t,expr,state>... [--crop x0,y0,x1,y1] */
import { Canvas, canvasPng, writeFile } from "../kit.mts";
import { W, H } from "../archivist.mts";
import { drawFrame, type Expr, type State } from "../v4-archivist.mts";

const args = process.argv.slice(2);
const out = args[0], scale = Number(args[1]);
let crop: number[] = [0, 0, W, H];
const cells: string[] = [];
for (let i = 2; i < args.length; i++) {
  if (args[i] === "--crop") crop = args[++i].split(",").map(Number);
  else cells.push(args[i]);
}
const [x0, y0, x1, y1] = crop;
const cw = x1 - x0, ch = y1 - y0;
const sheet = new Canvas(cw * cells.length, ch);
cells.forEach((spec, i) => {
  const [t, expr, state] = spec.split(",");
  const f = drawFrame(Number(t), (expr || "neutral") as Expr, (state || "idle") as State);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = f.get(x, y); if (v) sheet.set(i * cw + (x - x0), y - y0, v); }
});
writeFile(out, canvasPng(sheet, scale, "#0c101c"));

