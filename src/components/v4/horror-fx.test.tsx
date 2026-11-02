import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HorrorBleed, WatchingEyes } from "./V4Ghost";

describe("horror-form effects", () => {
  it("are decorative only: hidden from assistive tech and carry no text", () => {
    for (const html of [renderToStaticMarkup(<HorrorBleed />), renderToStaticMarkup(<WatchingEyes />)]) {
      expect(html.startsWith('<div class="v4-') && html.includes('aria-hidden="true"')).toBe(true);
      expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    }
  });
  it("stop moving under reduced motion", () => {
    const css = readFileSync("src/components/v4/v4.css", "utf8");
    const block = css.slice(css.indexOf("Horror form: distortion, bleeding, watching eyes"));
    expect(block).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.v4-eye \{ animation: none !important; \}|\.v4-eye \{ animation: none !important/);
    expect(block).toMatch(/\.v4-bleed-run, \.v4-bleed-drop, \.v4-eye \{ animation: none !important; \}/);
  });
});
