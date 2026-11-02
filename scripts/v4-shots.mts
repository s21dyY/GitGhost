/**
 * Screenshots and interaction checks for the V4 prototype (mock data only).
 *   GITGHOST_PROTOTYPES=1 npx next start -p 3100   (production build)
 *   node scripts/v4-shots.mts <baseUrl> <outDir>
 * Read-only: loads /prototype/v4 and clicks UI controls. No network calls leave the page except the app's own assets.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [base = "http://localhost:3100", outDir = "docs/screenshots/v4"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean) => { log.push(`${ok ? "PASS" : "FAIL"}  ${name}`); };

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const shot = (f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });
  const D = name === "desktop";
  await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await shot("01-chamber");
  check(`${name}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

  // TALK: free-form question
  await page.getByTestId("act-talk").click();
  await page.getByLabel("Your question").fill("why did this die?");
  await page.waitForTimeout(250);
  await shot("02-listening");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForTimeout(1400);
  await shot("03-speaking");
  await page.getByRole("button", { name: /Skip/ }).click().catch(() => {});
  await page.waitForTimeout(400);
  const logText = await page.getByTestId("v4-log").innerText();
  check(`${name}: free-form question gets a scoped reply`, /record/i.test(logText) && /not found/i.test(logText));

  // MEMORIES
  await page.getByTestId("act-memories").click();
  if (!D) await page.waitForTimeout(300);
  if (!D) await shot("04a-memories-drawer");
  await page.getByRole("button", { name: /7be21d4/ }).first().click();
  await page.waitForTimeout(500);
  await shot("04-memory-page");
  check(`${name}: memory page shows commit`, (await page.getByTestId("memory-page").innerText()).includes("7be21d4"));

  // REWIND
  await page.getByTestId("act-rewind").click();
  await page.waitForTimeout(300);
  if (!D) await shot("05a-time-drawer");
  await page.getByRole("button", { name: /a1f3c09/ }).first().click();
  await page.waitForTimeout(650);
  await shot("05-rewinding");
  await page.waitForTimeout(1400);
  await shot("06-era-1-human");
  check(`${name}: rewind changes ghost form to human`, (await page.getByTestId("v4").getAttribute("data-stage")) === "human");
  check(`${name}: rewind hides future commits`, (await page.getByTestId("era-chip").innerText()).includes("a1f3c09"));

  // back to latest: transformation
  await page.getByTestId("act-rewind").click();
  await page.getByRole("button", { name: /e5a7013/ }).first().click();
  await page.waitForTimeout(900);
  await shot("07-transforming");
  await page.waitForTimeout(1600);
  check(`${name}: forward again becomes transformed`, (await page.getByTestId("v4").getAttribute("data-stage")) === "transformed");

  // INSPECT: board + mirror
  await page.getByTestId("act-inspect").click();
  await page.waitForTimeout(300);
  await shot("08-board");
  check(`${name}: board separates observed and reading`, (await page.locator("#v4-board-h").count()) === 1);
  if (D) await page.getByRole("button", { name: "Open Spirit Mirror" }).click();
  else {
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await page.getByRole("button", { name: "Open the Spirit Mirror" }).click();
  }
  await page.waitForTimeout(500);
  await shot("09-mirror");
  await page.keyboard.press("Escape");
  check(`${name}: mirror closes with Escape`, (await page.getByTestId("mirror").getAttribute("open")) === null);

  // Evidence chip -> evidence archive
  await page.getByTestId("act-talk").click();
  await page.getByRole("button", { name: "Open evidence E5" }).first().click().catch(() => {});
  await page.waitForTimeout(400);
  await shot("10-evidence");

  // Spirit record on phone
  if (!D) {
    await page.getByRole("button", { name: "Close", exact: true }).first().click().catch(() => {});
    await page.getByRole("button", { name: "Spirit", exact: true }).click();
    await page.waitForTimeout(300);
    await shot("11-spirit-drawer");
  }
  // Readability and keyboard checks
  const minFont = await page.evaluate(() => {
    let min = 99;
    for (const el of document.querySelectorAll<HTMLElement>(".v4 *")) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || el.getBoundingClientRect().width === 0) continue;
      min = Math.min(min, parseFloat(cs.fontSize));
    }
    return min;
  });
  check(`${name}: smallest visible text >= 12px (found ${minFont}px)`, minFont >= 12);
  await page.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
  await page.getByTestId("act-talk").focus();
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 3; });
  check(`${name}: action buttons show a keyboard focus ring`, ring);
  if (D) {
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("3");
    check("desktop: key 3 opens Time Travel", (await page.getByTestId("tab-time").getAttribute("aria-pressed")) === "true");
  }
  check(`${name}: no console errors`, errors.length === 0);
  if (errors.length) log.push("  " + errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// Reduced motion: no sweep, no glitch, no animation names on the ghost wrapper
const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const rp = await rctx.newPage();
await rp.goto(base + "/prototype/v4", { waitUntil: "networkidle" });
await rp.getByTestId("act-rewind").click();
await rp.getByRole("button", { name: /a1f3c09/ }).first().click();
await rp.waitForTimeout(150);
const rm = await rp.evaluate(() => ({
  rewinding: document.querySelector(".v4-stage")?.hasAttribute("data-rewinding"),
  stage: document.querySelector(".v4")?.getAttribute("data-stage"),
  sweep: getComputedStyle(document.querySelector(".v4-sweep")!).animationName,
  bob: getComputedStyle(document.querySelector(".v4-ghost .v4g")!).animationName,
  ash: getComputedStyle(document.querySelector(".enc-ash")!, "::before").animationName,
}));
check("reduced motion: rewind is instant (no sweep), state still changes", rm.rewinding === false && rm.stage === "human" && rm.sweep === "none" && rm.bob === "none" && rm.ash === "none");
await rctx.close();
await browser.close();
console.log(log.join("\n"));
