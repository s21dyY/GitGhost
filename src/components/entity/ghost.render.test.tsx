import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity } from "@/domain/entity";
import { FormToggle, GhostNotes, GhostScene, type GhostView } from "./GhostPanel";
import { GhostFormProvider } from "./GhostFormContext";
import { GhostSprite } from "./archivist/GhostSprite";
import { STAGE_LABELS } from "./archivist/describe";
import { spriteUrl, STAGES, POSES } from "./archivist/sprites";

/** The encounter pieces together, as the repo page assembles them. */
function GhostPanel({ view, devTools = false }: { view: GhostView; devTools?: boolean }) {
  return (
    <GhostFormProvider>
      <GhostScene view={view} devTools={devTools} />
      <FormToggle />
      <GhostNotes view={view} devTools={devTools} />
    </GhostFormProvider>
  );
}

const assignmentFor = (description?: string) =>
  assignmentFromIdentity(buildEntity({ repoId: 77, repoName: "o/r", description }, "seed-77"), "2026-10-30T12:00:00.000Z");

describe("GhostSprite markup", () => {
  it("is an accessible image with a plain-text description, authored art and only known overlay colors", () => {
    const html = renderToStaticMarkup(<GhostSprite stage="transformed" pose="idle" mutationIds={["ink-tears"]} />);
    expect(html).toContain('role="img"');
    expect(html).toContain("aria-label=\"Pixel illustration of a fictional ghost.");
    expect(html).toContain("brass");
    expect(html).toContain(`href="${spriteUrl("transformed", "idle")}"`);
    expect(html).toContain('image-rendering="pixelated"');
    for (const [, hex] of html.matchAll(/fill="(#[0-9A-Fa-f]{6})"/g)) expect(["#141c25", "#e7e0ce", "#6bb8b1", "#c9a85a", "#a88cdc", "#0b1018"]).toContain(hex);
  });

  it("every stage x pose has an exported 64 x 80 image", () => {
    for (const st of STAGES)
      for (const po of POSES) {
        const buf = readFileSync(join(process.cwd(), "public", spriteUrl(st, po)));
        expect(buf.subarray(1, 4).toString()).toBe("PNG");
        expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([64, 80]);
      }
  });

  it("a portrait is hidden from assistive tech because the scene already describes the figure", () => {
    const html = renderToStaticMarkup(<GhostSprite stage="human" pose="speaking" mutationIds={[]} decorative crop={{ x: 18, y: 6, w: 28, h: 28 }} />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
  });

  it("idle bobs, speaking alternates two frames, thinking shows dots", () => {
    const idle = renderToStaticMarkup(<GhostSprite stage="human" pose="idle" mutationIds={[]} />);
    const speaking = renderToStaticMarkup(<GhostSprite stage="human" pose="speaking" mutationIds={[]} />);
    const thinking = renderToStaticMarkup(<GhostSprite stage="human" pose="thinking" mutationIds={[]} />);
    expect(idle).toContain("ghost-bob");
    expect(idle).not.toContain("ghost-frame-b");
    expect(speaking).toContain("ghost-frame-a");
    expect(speaking).toContain("ghost-frame-b");
    expect(speaking).not.toContain("ghost-bob");
    expect(thinking).toContain("thought-dots");
    expect(idle).not.toContain("thought-dots");
    expect(idle).toContain("ghost-blink"); // a timed blink frame lies over the idle face
  });

  it("renders every stage x pose x supported overlay without throwing", () => {
    for (const stage of ["human", "distorted", "transformed"] as const)
      for (const pose of ["idle", "thinking", "speaking", "blink"] as const)
        expect(renderToStaticMarkup(<GhostSprite stage={stage} pose={pose} mutationIds={["delayed-shadow", "small-teeth"]} />)).toContain("<svg");
  });
});

describe("reduced motion", () => {
  const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .ghost-bob"));

  it("turns off every ghost animation and leaves a static, fully visible first frame", () => {
    for (const cls of [".ghost-bob", ".ghost-frame-a", ".ghost-frame-b", ".ghost-dot"]) expect(reduced).toContain(cls);
    expect(reduced).toContain("animation: none");
    expect(reduced).toMatch(/\.ghost-frame-a, \.ghost-dot \{ opacity: 1; \}/);
    expect(reduced).toMatch(/\.ghost-frame-b \{ opacity: 0; \}/);
  });

  it("keeps the second speaking frame hidden by default, so a no-CSS render shows one clean frame", () => {
    expect(css).toMatch(/\.ghost-frame-b \{ opacity: 0;/);
  });

  it("flashes slower than 3 times per second", () => {
    const m = /\.ghost-frame-a \{ animation: ghost-a ([\d.]+)s/.exec(css);
    expect(1 / Number(m![1])).toBeLessThan(3);
  });
});

describe("GhostPanel", () => {
  const archivist = assignmentFor();
  const persisted = (a = archivist): GhostView => ({ status: "persisted", assignment: a });

  it("production UI: ghost, origin-reveal button, notices; no internal IDs, seed, selectors or debug block", () => {
    const html = renderToStaticMarkup(<GhostPanel view={persisted()} />);
    expect(html).toContain("Identity saved");
    expect(html).toContain("Fictional ghost");
    expect(html).toContain("Before the forgetting");
    expect(html).toContain("As it is now");
    expect(html).toContain('aria-pressed="false"'); // "Before the forgetting" starts unpressed
    expect(html).toContain('aria-pressed="true"'); // "As it is now" starts pressed
    expect(html).toContain('data-pose="idle"');
    for (const hidden of ["Technical identity record", "Preview state", "Development only", 'type="radio"', "dev-tools", "Not drawn yet"]) {
      expect(html).not.toContain(hidden);
    }
    expect(html).not.toContain(archivist.seed);
    for (const id of [archivist.voiceId, archivist.temperamentId, archivist.originId]) expect(html).not.toContain(`<dd>${id}</dd>`);
    expect(html).not.toMatch(/The Archivist|Endless Regret|The Distant Signal|The Quiet Presence/);
  });

  it("development UI is clearly labeled and carries the selectors and the technical record", () => {
    const html = renderToStaticMarkup(<GhostPanel view={persisted()} devTools />);
    expect(html).toContain("Development only. Not shown in production.");
    expect(html).toContain("Technical identity record");
    expect(html).toContain("Preview state");
    expect(html).toContain('type="radio"');
    expect(html).toContain(archivist.seed);
    for (const s of ["human", "distorted", "transformed"] as const) expect(html).toContain(STAGE_LABELS[s].label);
  });

  it("labels the human form as an imagined origin, not history", () => {
    expect(STAGE_LABELS.human.label).toBe("Before the forgetting");
    expect(STAGE_LABELS.human.note).toMatch(/Imagined origin inspired by repository metadata/);
    expect(STAGE_LABELS.human.note).toMatch(/does not depict a real person/);
  });

  it("starts in the assigned current form", () => {
    const html = renderToStaticMarkup(<GhostPanel view={persisted()} />);
    expect(html).toContain(`data-stage="${archivist.currentStage}"`);
  });

  it("does not claim persistence when provisional, and says why", () => {
    const html = renderToStaticMarkup(<GhostPanel view={{ status: "provisional", assignment: archivist, reason: "budget_exceeded" }} />);
    expect(html).toContain("Provisional appearance");
    expect(html).toContain("not saved");
    expect(html).toContain("Many new ghosts are being saved right now");
    expect(html).not.toContain("Identity saved");
    expect(renderToStaticMarkup(<GhostPanel view={{ status: "provisional", assignment: archivist }} />)).toContain("identity store was unavailable");
  });

  it("shows an error without any ghost drawing", () => {
    const html = renderToStaticMarkup(<GhostPanel view={{ status: "error", message: "The saved identity could not be read." }} />);
    expect(html).toContain("Ghost unavailable");
    expect(html).not.toContain("<svg");
  });

  it("uses a clearly labeled stand-in when the origin has no art yet", () => {
    const watch = assignmentFor("security authentication access");
    expect(watch.originId).toBe("watchkeeper");
    expect(renderToStaticMarkup(<GhostPanel view={persisted(watch)} />)).toContain("stand-in figure");
  });

  it("lists undrawn overlays only in development, never invented in the image", () => {
    const withTeeth = { ...archivist, originId: "radio-operator", voiceId: "monster", mutationParts: ["small-teeth"] };
    expect(renderToStaticMarkup(<GhostPanel view={persisted(withTeeth)} />)).not.toContain("small-teeth");
    expect(renderToStaticMarkup(<GhostPanel view={persisted(withTeeth)} devTools />)).toContain("Not drawn yet: small-teeth");
  });
});
