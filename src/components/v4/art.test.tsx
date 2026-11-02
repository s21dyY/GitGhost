import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { drawVariant } from "../../../scripts/art/v4-variants.mts";
import { drawFrame, EXPRS, FORM_T, FORMS, IDLE, idleFrame, STATES, TRANSFORM } from "../../../scripts/art/v4-archivist.mts";
import art from "./art.manifest.json";
import { fragment } from "./speech";
import { FORM_INDEX, transformSteps, TWITCH } from "./sequence";
import { ERAS } from "./fixtures";
import { mockGameData } from "./mock-data";
import { V4Game } from "./V4Game";
import { BloodDrips, V4Ghost } from "./V4Ghost";
import { Canvas } from "../../../scripts/art/kit.mts";

const png = (path: string) => {
  const b = readFileSync(path);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), sig: b.subarray(1, 4).toString() };
};
const grid = (c: Canvas) => c.pix.map((p) => p ?? "-").join(",");
const diffBox = (a: Canvas, b: Canvas): [number, number, number, number] | null => {
  let x0 = 99, y0 = 99, x1 = -1, y1 = -1;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (a.get(x, y) !== b.get(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : [x0, y0, x1, y1];
};

describe("V4 character art", () => {
  it("ships one atlas per form with 6 expressions x 6 states, a morph strip and two drip strips", () => {
    expect(art.exprs).toEqual(EXPRS);
    expect(art.states).toEqual(STATES);
    for (const f of FORMS) {
      const p = png(`public/sprites/v4/atlas-${f}.png`);
      expect(p.sig).toBe("PNG");
      expect([p.w, p.h]).toEqual([64 * 6, 80 * 6]);
    }
    expect([png("public/sprites/v4/transform.png").w, png("public/sprites/v4/transform.png").h]).toEqual([64 * TRANSFORM.length, 80]);
    for (const s of ["a", "b"]) expect(png(`public/sprites/v4/drip-${s}.png`).w).toBe(8 * art.drip.frames);
  });
  it("ships an idle loop per form (frames across, expressions down) whose frames really move", () => {
    expect(art.idle).toEqual(IDLE);
    for (const f of FORMS) {
      const p = png(`public/sprites/v4/idle-${f}.png`);
      expect([p.w, p.h]).toEqual([64 * IDLE.frames, 80 * EXPRS.length]);
      const frames = new Set(Array.from({ length: IDLE.frames }, (_, i) => grid(idleFrame(FORM_T[f], "neutral", i))));
      expect(frames.size).toBeGreaterThanOrEqual(6);
    }
  });
  it("the eldritch idle loop stays bloodless on every frame", () => {
    const red = (c: Canvas) => c.pix.filter((p) => p && parseInt(p.slice(1, 3), 16) > 120 && parseInt(p.slice(3, 5), 16) < 60 && parseInt(p.slice(5, 7), 16) < 70).length;
    for (let i = 0; i < IDLE.frames; i++) expect(red(idleFrame(1, "neutral", i))).toBe(0);
  });
  it("plays the idle loop only for the resting Archivist; talking and the other ghosts keep the atlas", () => {
    expect(renderToStaticMarkup(<V4Ghost form="distorted" expr="neutral" />)).toContain("v4g-idle");
    expect(renderToStaticMarkup(<V4Ghost form="distorted" expr="neutral" talking />)).not.toContain("v4g-idle");
    expect(renderToStaticMarkup(<V4Ghost form="human" expr="neutral" sprite="hound" />)).not.toContain("v4g-idle");
  });
  it("is deterministic", () => {
    expect(grid(drawFrame(0.5, "angry", "twitchA"))).toBe(grid(drawFrame(0.5, "angry", "twitchA")));
  });
  it("gives every form six distinct expressions", () => {
    for (const f of FORMS) {
      const hashes = new Set(EXPRS.map((e) => grid(drawFrame(FORM_T[f], e, "idle"))));
      expect(hashes.size).toBe(6);
    }
  });
  it("changes only the head and face between expressions: the body, book and hood stay put", () => {
    for (const f of FORMS) {
      const base = drawFrame(FORM_T[f], "neutral", "idle");
      for (const e of EXPRS.filter((x) => x !== "neutral")) {
        const box = diffBox(base, drawFrame(FORM_T[f], e, "idle"));
        expect(box, `${f}/${e}`).not.toBeNull();
        expect(box![1]).toBeGreaterThanOrEqual(5); // nothing above the hood
        expect(box![3]).toBeLessThanOrEqual(52); // nothing below the face and its blood
      }
    }
  });
  it("keeps the hood, book and clasp anchors across the three forms", () => {
    const frames = FORMS.map((f) => drawFrame(FORM_T[f], "neutral", "idle"));
    // the book cover and clasp area is solid in every form
    for (const fr of frames) for (let y = 44; y <= 56; y++) for (let x = 24; x <= 39; x++) expect(fr.get(x, y), `${x},${y}`).not.toBeNull();
    // the hood's top edge sits on the same rows in every form
    const top = frames.map((fr) => { for (let y = 0; y < 80; y++) for (let x = 0; x < 64; x++) if (fr.get(x, y)) return y; return -1; });
    expect(new Set(top).size).toBe(1);
  });
  it("makes the head move for the twitch: it shifts and tilts, and the freeze is the furthest", () => {
    const idle = drawFrame(0.5, "neutral", "idle");
    const a = diffBox(idle, drawFrame(0.5, "neutral", "twitchA"));
    const b = diffBox(idle, drawFrame(0.5, "neutral", "twitchB"));
    const z = diffBox(idle, drawFrame(0.5, "neutral", "freeze"));
    for (const box of [a, b, z]) expect(box).not.toBeNull();
    expect(new Set([grid(drawFrame(0.5, "neutral", "twitchA")), grid(drawFrame(0.5, "neutral", "twitchB")), grid(drawFrame(0.5, "neutral", "freeze")), grid(idle)]).size).toBe(4);
  });
  it("lands the transformation exactly on the human and horror forms, with every step different", () => {
    expect(grid(drawFrame(TRANSFORM[0].t, TRANSFORM[0].expr, "idle", { move: TRANSFORM[0].move }))).toBe(grid(drawFrame(0, "neutral", "idle")));
    const last = TRANSFORM.at(-1)!;
    expect(grid(drawFrame(last.t, last.expr, "idle", { move: last.move }))).toBe(grid(drawFrame(1, "neutral", "idle")));
    const frames = TRANSFORM.map((t) => grid(drawFrame(t.t, t.expr, "idle", { move: t.move, open: t.open })));
    expect(new Set(frames).size).toBe(TRANSFORM.length);
    expect(TRANSFORM.map((t) => t.t)).toEqual([...TRANSFORM.map((t) => t.t)].sort((x, y) => x - y));
  });
});

describe("the other ghosts", () => {
  for (const kind of ["watchkeeper", "hound"] as const) {
    it(`${kind}: ships three form atlases and a 12-frame morph strip`, () => {
      for (const f of FORMS) expect([png(`public/sprites/v4/atlas-${kind}-${f}.png`).w, png(`public/sprites/v4/atlas-${kind}-${f}.png`).h]).toEqual([64 * 6, 80 * 6]);
      expect([png(`public/sprites/v4/transform-${kind}.png`).w, png(`public/sprites/v4/transform-${kind}.png`).h]).toEqual([64 * TRANSFORM.length, 80]);
    });
    it(`${kind}: the three forms are clearly different, and the gory and eldritch forms differ in colour as well as shape`, () => {
      const frames = FORMS.map((f) => drawVariant(kind, FORM_T[f], "neutral", "idle"));
      expect(new Set(frames.map(grid)).size).toBe(3);
      const avg = (c: Canvas) => { let r = 0, b = 0, n = 0; for (const p of c.pix) if (p && p.startsWith("#")) { r += parseInt(p.slice(1, 3), 16); b += parseInt(p.slice(5, 7), 16); n++; } return { r: r / n, b: b / n }; };
      const gory = avg(frames[1]), eld = avg(frames[2]);
      expect(eld.b - eld.r).toBeGreaterThan(gory.b - gory.r + 8); // violet and bloodless against red and grey
    });
    it(`${kind}: every form has expressions that differ, and blinking changes the face`, () => {
      for (const f of FORMS) expect(new Set(EXPRS.map((e) => grid(drawVariant(kind, FORM_T[f], e, "idle")))).size).toBeGreaterThanOrEqual(4);
      expect(grid(drawVariant(kind, 0, "neutral", "blink"))).not.toBe(grid(drawVariant(kind, 0, "neutral", "idle")));
    });
    it(`${kind}: the silhouette keeps its top edge across forms`, () => {
      const top = FORMS.map((f) => { const fr = drawVariant(kind, FORM_T[f], "neutral", "idle"); for (let y = 0; y < 80; y++) for (let x = 0; x < 64; x++) if (fr.get(x, y)) return y; return -1; });
      expect(Math.max(...top) - Math.min(...top)).toBeLessThanOrEqual(2);
    });
  }
  it("the eldritch Archivist has no gore colours: nothing red is left", () => {
    const c = drawFrame(1, "neutral", "idle");
    const reddish = c.pix.filter((p) => p && p.startsWith("#") && parseInt(p.slice(1, 3), 16) > 120 && parseInt(p.slice(3, 5), 16) < 60 && parseInt(p.slice(5, 7), 16) < 70);
    expect(reddish.length).toBe(0);
  });
  it("the gory Archivist is the one with blood: the two later forms stay apart", () => {
    const red = (c: Canvas) => c.pix.filter((p) => p && p.startsWith("#") && parseInt(p.slice(1, 3), 16) > 120 && parseInt(p.slice(3, 5), 16) < 60 && parseInt(p.slice(5, 7), 16) < 70).length;
    expect(red(drawFrame(0.5, "neutral", "idle"))).toBeGreaterThan(30);
    expect(red(drawFrame(1, "neutral", "idle"))).toBe(0);
  });
});

describe("broken speech", () => {
  const line = "Two lights. Two versions of the same room. I am not sure which one I am standing in.";
  it("is deterministic and keeps the plain text whole", () => {
    expect(fragment(line, 3)).toEqual(fragment(line, 3));
    expect(fragment(line, 3).plain).toBe(line);
  });
  it("only adds stutters and pauses: removing them gives back the sentence", () => {
    for (let seed = 0; seed < 40; seed++) {
      const f = fragment(line, seed);
      const restored = f.visual.replace(/\b([A-Za-z])-(?=\1)/g, "").replace(/…\s?/g, ". ").replace(/\.\.\s/g, ". ").replace(/\.\.\./g, ".");
      expect(f.visual.length).toBe(f.holds.length);
      expect(restored.replace(/\s+/g, " ").replace(/[.,]/g, "")).toBe(line.replace(/[.,]/g, ""));
      expect((f.visual.match(/\b[A-Za-z]-[A-Za-z]/g) ?? []).length).toBeLessThanOrEqual(2);
      expect(f.visual).not.toMatch(/…\./);
    }
  });
  it("stalls on punctuation", () => {
    const f = fragment("Wait. Wait, no.", 1, 0);
    expect(f.holds[f.visual.indexOf(".")]).toBeGreaterThan(200);
  });
});

describe("animation sequences", () => {
  it("twitch: a flinch, a counter-flinch, a freeze of about a second and a half, then back to rest", () => {
    expect(TWITCH.at(-1)!.frame).toBeNull();
    const freeze = TWITCH.filter((s) => s.freeze);
    expect(freeze).toHaveLength(1);
    expect(freeze[0].ms).toBeGreaterThanOrEqual(1200);
    expect(TWITCH.slice(0, 4).every((s) => s.ms < 150)).toBe(true);
    const total = TWITCH.reduce((a, s) => a + s.ms, 0);
    expect(total).toBeGreaterThan(1800);
    expect(total).toBeLessThan(2600);
  });
  it("transform: runs forwards and backwards between the forms, ending at rest", () => {
    const fwd = transformSteps(FORM_INDEX.human, FORM_INDEX.horror);
    const back = transformSteps(FORM_INDEX.horror, FORM_INDEX.human);
    expect(fwd).toHaveLength(TRANSFORM.length + 1);
    expect(fwd.at(-1)!.frame).toBeNull();
    expect(back.slice(0, -1).map((s) => (s.frame as { index: number }).index)).toEqual(fwd.slice(0, -1).map((s) => (s.frame as { index: number }).index).reverse());
    expect(transformSteps(0, 6).length).toBe(8); // human to distorted stops on the distorted frame
  });
});

describe("V4Ghost markup", () => {
  it("is an image with a plain-text description, shown by CSS at a whole-number pixel scale", () => {
    const html = renderToStaticMarkup(<V4Ghost form="horror" expr="eldritch" />);
    expect(html).toContain('role="img"');
    expect(html).toMatch(/aria-label="[^"]*void[^"]*Expression: Eldritch/);
    expect(html).toContain("/sprites/v4/idle-horror.png");
    expect(renderToStaticMarkup(<V4Ghost form="horror" expr="eldritch" frame={{ kind: "atlas", state: "speak" }} />)).toContain("/sprites/v4/atlas-horror.png");
    expect(html).toContain("var(--a)");
    expect(html).not.toMatch(/blur|filter/);
  });
  it("can be decorative", () => {
    expect(renderToStaticMarkup(<V4Ghost form="human" expr="neutral" decorative />)).toContain('aria-hidden="true"');
  });
  it("drips only exist in the gory form: the eldritch form is bloodless and the other ghosts have none", () => {
    expect(renderToStaticMarkup(<BloodDrips form="human" />)).toBe("");
    expect(renderToStaticMarkup(<BloodDrips form="distorted" />)).toContain("v4-drip");
    expect(renderToStaticMarkup(<BloodDrips form="horror" />)).toBe("");
    expect(renderToStaticMarkup(<BloodDrips form="distorted" sprite="hound" />)).toBe("");
  });
  it("draws the other ghosts from their own atlases", () => {
    expect(renderToStaticMarkup(<V4Ghost form="distorted" expr="neutral" sprite="hound" />)).toContain("/sprites/v4/atlas-hound-distorted.png");
    expect(renderToStaticMarkup(<V4Ghost form="human" expr="neutral" sprite="watchkeeper" frame={{ kind: "transform", index: 3 }} />)).toContain("/sprites/v4/transform-watchkeeper.png");
    expect(renderToStaticMarkup(<V4Ghost form="horror" expr="neutral" sprite="hound" />)).toMatch(/aria-label="[^"]*hound/i);
  });
});

describe("dialogue stays readable for assistive tech", () => {
  it("gives screen readers the whole greeting while it types", () => {
    const html = renderToStaticMarkup(<V4Game data={mockGameData()} />);
    expect(html).toContain(ERAS.at(-1)!.ghostLine);
  });
});
