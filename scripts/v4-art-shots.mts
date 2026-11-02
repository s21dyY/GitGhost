/**
 * Browser captures for the V4 character milestone: before/after, forms x expressions, the three animations
 * (time-lapse strips and webm clips from the real scene), and checks for reduced motion and mobile.
 *   GITGHOST_PROTOTYPES=1 npx next start -p 3100
 *   node scripts/v4-art-shots.mts <baseUrl> <outDir>
 * Read-only against the prototype pages. No model calls, no network beyond the local server.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://127.0.0.1:3100", outDir = "docs/screenshots/v4-art"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Time-lapse: grab `n` small clips around the ghost, `gap` ms apart, then lay them out in one image. */
async function lapse(page: Page, name: string, n: number, gap: number, out: string, pad = { x: 40, y: 40 }, opt: { lower?: boolean; zoom?: number } = {}) {
  const box = await page.locator(".v4-ghost").boundingBox();
  if (!box) throw new Error("no ghost");
  const full = { x: Math.max(0, box.x - pad.x), y: Math.max(0, box.y - pad.y), width: box.width + pad.x * 2, height: box.height + pad.y * 2 };
  const clip = opt.lower ? { ...full, y: full.y + full.height * 0.38, height: full.height * 0.62 } : full;
  const zoom = opt.zoom ?? 1;
  const shots: { b64: string; at: number }[] = [];
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    const start = Date.now();
    const buf = await page.screenshot({ clip, type: "png" });
    shots.push({ b64: buf.toString("base64"), at: start - t0 });
    const spent = Date.now() - start;
    if (spent < gap) await sleep(gap - spent);
  }
  const sheet = await page.context().newPage();
  const perRow = Math.min(n, 8);
  await sheet.setViewportSize({ width: Math.min(2600, Math.round(clip.width * zoom * perRow) + 40), height: 400 });
  await sheet.setContent(`<body style="margin:0;background:#03050a;font:12px monospace;color:#cfc8ba"><div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px">${shots
    .map((s) => `<figure style="margin:0"><img style="display:block;image-rendering:pixelated;width:${Math.round(clip.width * zoom)}px" src="data:image/png;base64,${s.b64}"><figcaption>${s.at} ms</figcaption></figure>`)
    .join("")}</div></body>`);
  await sheet.screenshot({ path: out, fullPage: true });
  await sheet.close();
  log.push(`INFO  ${name}: ${n} frames, ${shots.at(-1)!.at} ms span`);
}

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const D = name === "desktop";
  const ctx = await browser.newContext({ viewport: vp, isMobile: !D, hasTouch: !D });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // ---- art lab ----
  await page.goto(base + "/prototype/v4/art", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.getByTestId("before-after").screenshot({ path: join(outDir, `01-before-after-${name}.png`) });
  await page.getByTestId("expressions").screenshot({ path: join(outDir, `02-forms-expressions-${name}.png`) });
  for (const id of ["demo-blood", "demo-twitch", "demo-transform"]) await page.getByTestId(id).screenshot({ path: join(outDir, `03-${id}-${name}.png`) });
  check(`${name}: art lab has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // ---- the encounter ----
  await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `04-encounter-horror-${name}.png`) });
  const sprite = await page.locator(".v4-ghost .v4g").boundingBox();
  check(`${name}: ghost drawn at a whole-number pixel scale`, !!sprite && Math.abs(sprite.width / 64 - Math.round(sprite.width / 64)) < 0.001 && Math.abs(sprite.height / 80 - Math.round(sprite.height / 80)) < 0.001, sprite ? `${sprite.width}x${sprite.height}` : "missing");
  // each expression in the real scene
  for (const e of ["amused", "disturbed", "eldritch"]) {
    if (!D) { await page.getByRole("button", { name: "Spirit", exact: true }).click(); }
    await page.getByTestId(`expr-${e}`).click();
    if (!D) await page.getByRole("button", { name: "Close", exact: true }).last().click().catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: join(outDir, `05-expression-${e}-${name}.png`) });
  }
  // fragmented speech: ask something, wait for the reveal
  await page.getByTestId("act-talk").click();
  await page.getByLabel("Your question").fill("what is still broken?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: join(outDir, `06-dialogue-typing-${name}.png`) });
  await page.getByRole("button", { name: /Skip/ }).click().catch(() => {});
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `07-dialogue-done-${name}.png`) });
  const facts = await page.locator(".v4-fact").allInnerTexts();
  check(`${name}: factual lines are plain (no stutter marks)`, facts.length > 0 && facts.every((t) => !/\b[A-Za-z]-[A-Za-z]{3,}/.test(t.replace(/\d+-\d+/g, ""))), `${facts.length} fact lines`);
  const ghostPlain = await page.locator(".v4-ghostline .sr-only").first().innerText().catch(() => "");
  check(`${name}: the ghost line keeps a whole plain-text version for screen readers`, ghostPlain.length > 10 && !/…|\b[A-Za-z]-[A-Za-z]{3,}/.test(ghostPlain), ghostPlain.slice(0, 40));
  check(`${name}: no horizontal overflow on the encounter`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // ---- the three animations in the real scene ----
  if (D) {
    await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    await lapse(page, "blood", 16, 240, join(outDir, `08-anim-blood-${name}.png`), { x: 40, y: 40 }, { lower: true, zoom: 1.5 });
    await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByTestId("tool-twitch").click();
    await lapse(page, "twitch", 16, 140, join(outDir, `09-anim-twitch-${name}.png`));
    await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.getByTestId("tool-transform").click();
    await lapse(page, "transform", 16, 120, join(outDir, `10-anim-transform-${name}.png`));
  }
  check(`${name}: no console errors`, errors.length === 0);
  if (errors.length) log.push("  " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ---- reduced motion ----
const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const rp = await rctx.newPage();
await rp.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
await rp.getByTestId("tool-twitch").click();
await rp.waitForTimeout(200);
const rm = await rp.evaluate(() => {
  const an = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).animationName : "missing"; };
  return { drip: an(".v4-drip"), bob: an(".ghost-bob"), blink: an(".ghost-blink"), playing: document.querySelector(".v4-ghostwrap")?.getAttribute("data-playing"), frame: document.querySelector(".v4-ghost .v4g")?.getAttribute("data-frame") };
});
check("reduced motion: drips, bob and blink are still", rm.drip === "none" && rm.bob === "none" && rm.blink === "none", JSON.stringify(rm));
check("reduced motion: the twitch does not play (no animated frames)", !rm.playing && rm.frame === "idle", JSON.stringify(rm));
await rp.getByTestId("tool-transform").click();
await rp.waitForTimeout(200);
check("reduced motion: the transformation does not play", (await rp.locator(".v4-ghostwrap").getAttribute("data-playing")) === null);
await rp.screenshot({ path: join(outDir, "11-reduced-motion-desktop.png") });
await rctx.close();
await browser.close();
console.log(log.join("\n"));
