import { describe, expect, it } from "vitest";
import { MUTATIONS } from "@/config/entities";
import manifest from "./art.manifest.json";
import { HEIGHT, OVERLAYS, POSES, STAGES, WIDTH, composeOverlays, spriteUrl } from "./sprites";

type Frame = (typeof manifest.frames)[keyof typeof manifest.frames];
const frame = (s: string, p: string) => (manifest.frames as Record<string, Frame>)[`${s}-${p}`];

describe("archivist art manifest (exported by scripts/art/export-archivist.mts)", () => {
  it("is 64 x 80 and has every stage x pose", () => {
    expect([manifest.width, manifest.height]).toEqual([WIDTH, HEIGHT]);
    expect(Object.keys(manifest.frames)).toHaveLength(STAGES.length * POSES.length);
    for (const s of STAGES) for (const p of POSES) expect(frame(s, p)).toBeDefined();
  });

  it("keeps every figure inside the canvas with real content", () => {
    for (const f of Object.values(manifest.frames)) {
      const [x0, y0, x1, y1] = f.bbox;
      expect(x0).toBeGreaterThanOrEqual(0);
      expect(y0).toBeGreaterThanOrEqual(0);
      expect(x1).toBeLessThan(WIDTH);
      expect(y1).toBeLessThan(HEIGHT);
      expect(f.opaque).toBeGreaterThan(1500);
    }
  });

  it("keeps the same book and clasp shape across stages and poses", () => {
    expect(new Set(Object.values(manifest.frames).map((f) => f.bookShape)).size).toBe(1);
    // within one stage the book is also identical in color; only the stage palette shifts it
    for (const s of STAGES) expect(new Set(POSES.map((p) => frame(s, p).bookHash)).size).toBe(1);
  });

  it("draws different pictures for different poses and different stages", () => {
    const hashes = Object.values(manifest.frames).map((f) => f.frameHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("restored coverage: every pose change stays inside the head and face area", () => {
    for (const s of STAGES)
      for (const p of POSES.filter((x) => x !== "idle")) {
        const d = frame(s, p).poseDiff;
        expect(d).not.toBeNull();
        const [x0, y0, x1, y1] = d!;
        expect(y0).toBeGreaterThanOrEqual(frame(s, p).headRows[0]);
        expect(y1).toBeLessThanOrEqual(frame(s, p).headRows[1]);
        expect(x0).toBeGreaterThanOrEqual(18);
        expect(x1).toBeLessThanOrEqual(46);
      }
  });

  it("restored coverage: the three forms share one head and body silhouette (same character)", () => {
    const bits = (h: string) => BigInt("0x" + h).toString(2).padStart(WIDTH, "0");
    const iou = (a: string, b: string, r0: number, r1: number) => {
      let i = 0, u = 0;
      for (let y = r0; y < r1; y++) {
        const x = bits((manifest.idleMasks as Record<string, string[]>)[a][y]);
        const z = bits((manifest.idleMasks as Record<string, string[]>)[b][y]);
        for (let k = 0; k < WIDTH; k++) {
          if (x[k] === "1" && z[k] === "1") i++;
          if (x[k] === "1" || z[k] === "1") u++;
        }
      }
      return i / u;
    };
    for (const [a, b] of [["human", "distorted"], ["human", "transformed"], ["distorted", "transformed"]]) {
      expect(iou(a, b, 6, 38)).toBeGreaterThan(0.85); // head
      expect(iou(a, b, 40, 58)).toBeGreaterThan(0.85); // body above the dissolving hem
    }
  });

  it("builds image URLs inside /sprites/archivist", () => {
    expect(spriteUrl("human", "blink")).toBe("/sprites/archivist/human-blink.png");
  });
});

describe("overlays", () => {
  const archivistOverlays = MUTATIONS.filter((m) => m.origins.includes("archivist")).map((m) => m.id);

  it("every overlay the config allows is either drawn or honestly reported as not drawn", () => {
    for (const id of archivistOverlays) {
      const c = composeOverlays("transformed", [id]);
      expect(Object.keys(OVERLAYS).includes(id) || c.unsupported.includes(id)).toBe(true);
    }
    expect(composeOverlays("transformed", ["missing-outline"]).unsupported).toEqual(["missing-outline"]);
  });

  it.each(Object.keys(OVERLAYS))("%s draws on distorted and transformed, inside the canvas", (id) => {
    for (const s of ["distorted", "transformed"] as const) {
      const c = composeOverlays(s, [id]);
      const cells = [...c.over, ...c.under];
      expect(cells.length > 0 || c.shadow !== null).toBe(true);
      for (const cell of cells) {
        expect(cell.x).toBeGreaterThanOrEqual(0);
        expect(cell.x).toBeLessThan(WIDTH);
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y).toBeLessThan(HEIGHT);
      }
    }
  });

  it("the human form has no overlay beyond the floor shadow", () => {
    for (const id of Object.keys(OVERLAYS)) expect(composeOverlays("human", [id]).over).toEqual([]);
  });

  it("ignores overlays with no drawing and reports them, including prototype-chain names", () => {
    const c = composeOverlays("transformed", ["small-teeth", "ink-tears"]);
    expect(c.unsupported).toEqual(["small-teeth"]);
    expect(c.over).toEqual(composeOverlays("transformed", ["ink-tears"]).over);
    expect(composeOverlays("human", ["constructor", "__proto__"]).unsupported).toEqual(["constructor", "__proto__"]);
  });
});
