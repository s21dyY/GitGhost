import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HorrorBleed, WatchingEyes } from "./Ghost";

describe("horror-form effects", () => {
  it("are decorative only: hidden from assistive tech and carry no text", () => {
    for (const html of [renderToStaticMarkup(<HorrorBleed />), renderToStaticMarkup(<WatchingEyes />)]) {
      expect(html.startsWith('<div class="gg-') && html.includes('aria-hidden="true"')).toBe(true);
      expect(html.replace(/<[^>]+>/g, "").trim()).toBe("");
    }
  });
  it("stop moving under reduced motion", () => {
    const css = readFileSync("src/components/game/game.css", "utf8");
    const block = css.slice(css.indexOf("Horror form: distortion, bleeding, watching eyes"));
    expect(block).toMatch(/prefers-reduced-motion: reduce\)[\s\S]*\.gg-eye \{ animation: none !important; \}|\.gg-eye \{ animation: none !important/);
    expect(block).toMatch(/\.gg-bleed-run, \.gg-bleed-drop, \.gg-eye \{ animation: none !important; \}/);
  });
});
