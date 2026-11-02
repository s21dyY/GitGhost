/**
 * Real-browser checks with the locally installed Google Chrome (playwright-core, no browser download).
 *   node scripts/browser-check.mts <baseUrl> <outDir> [repoPath]
 * Needs a running app (npm run build && npx next start, or npm run dev). Makes only GET/UI requests
 * to the given base URL. Visiting a repo page may save a ghost identity for that repo via the app.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://localhost:3000", outDir = "docs/screenshots", repoPath = "/repo/mozilla/pdf.js"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;
const report: Record<string, unknown> = { base, repoPath, chrome: "" };

/** Runs inside the page: smallest text and WCAG contrast failures. */
function audit() {
  const parse = (c: string) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const bgOf = (el: Element | null): { r: number; g: number; b: number } => {
    for (let e = el; e; e = e.parentElement) {
      const c = parse(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.5) return c;
    }
    return { r: 10, g: 16, b: 23 };
  };
  const fails: string[] = [];
  let minFont = 99;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent?.trim()) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0 || cs.visibility === "hidden") continue;
    const fs = parseFloat(cs.fontSize);
    minFont = Math.min(minFont, fs);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const large = fs >= 24 || (fs >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) fails.push(`${ratio.toFixed(2)} ${fs}px "${n.textContent.trim().slice(0, 40)}"`);
  }
  return { minFont, contrastFails: fails.slice(0, 12), overflowX: document.documentElement.scrollWidth > window.innerWidth };
}

async function tabStops(page: Page, max: number) {
  const stops: { el: string; visible: boolean }[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const lab = el.closest("label");
      const target = lab && el.matches('input[type="radio"]') ? lab : el;
      const t = getComputedStyle(target);
      const hasOutline = (t.outlineStyle !== "none" && parseFloat(t.outlineWidth) > 0) || t.boxShadow !== "none" || (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0);
      const name = el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 30) || el.getAttribute("name") || el.id;
      return { el: `${el.tagName.toLowerCase()}:${name}`, visible: hasOutline };
    });
    if (!s) break;
    if (stops.some((x) => x.el === s.el) && stops.length > 1 && s.el === stops[0].el) break;
    stops.push(s);
  }
  return stops;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
report.chrome = browser.version();

for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await ctx.newPage();
  const res: Record<string, unknown> = {};
  const consoleErrors: string[] = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 160)));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror ${e.message.slice(0, 160)}`));

  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outDir, `landing-${name}.png`), fullPage: true });
  res.landing = { ...(await page.evaluate(audit)), tabStops: await tabStops(page, 30) };

  // Summon form: keyboard-only
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.focus("#summon-input");
  await page.keyboard.press("Enter");
  const emptyMsg = await page.locator("#summon-error").innerText();
  await page.fill("#summon-input", "https://github.com.evil.com/a/b");
  await page.keyboard.press("Enter");
  const badHostMsg = await page.locator("#summon-error").innerText();
  await page.screenshot({ path: join(outDir, `landing-error-${name}.png`) });
  const invalidAttr = await page.getAttribute("#summon-input", "aria-invalid");
  await page.fill("#summon-input", repoPath.replace("/repo/", ""));
  await Promise.all([page.waitForURL("**" + repoPath), page.keyboard.press("Enter")]);
  res.summonForm = { emptyMsg, badHostMsg, ariaInvalid: invalidAttr, navigatedTo: new URL(page.url()).pathname };

  // Seance page
  await page.goto(base + repoPath + "?ui=classic", { waitUntil: "networkidle" }); // the classic screen; V4 is the default
  await page.waitForSelector('svg[role="img"]', { timeout: 20000 });
  await page.screenshot({ path: join(outDir, `seance-${name}.png`) });
  const svg = await page.locator('svg[role="img"]').first().boundingBox();
  res.seance = {
    ...(await page.evaluate(audit)),
    ghostBox: svg && { w: Math.round(svg.width), h: Math.round(svg.height) },
    tabStops: await tabStops(page, 40),
    hasDevTools: (await page.getByText("Technical identity record").count()) > 0,
    hasPreviewSelector: (await page.getByText("Preview state").count()) > 0,
    bodyShowsSeed: /[0-9a-f]{8}-[0-9a-f]{4}-/.test(await page.locator("body").innerText()),
  };

  // Error states
  for (const [label, path] of [["missing", "/repo/mozilla/this-repo-does-not-exist-gg"], ["invalid", "/repo/a/b%20c"]] as const) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.screenshot({ path: join(outDir, `error-${label}-${name}.png`) });
    res[`error_${label}`] = (await page.locator('[role="alert"]').first().innerText()).slice(0, 120);
  }

  // Forms (only controls that exist in this build)
  await page.goto(base + repoPath + "?ui=classic", { waitUntil: "networkidle" }); // the classic screen; V4 is the default
  // The encounter is a fixed full-viewport scene, so "the ghost" screenshots are viewport screenshots.
  const ghost = page;
  const stageOf = async () => (await page.locator('svg[role="img"]').first().getAttribute("data-stage")) ?? "";
  const forms: Record<string, string> = {};
  try {
    const before = page.getByRole("button", { name: "Before the forgetting" });
    const now = page.getByRole("button", { name: "As it is now" });
    if (await before.count()) {
      await ghost.screenshot({ path: join(outDir, `ghost-current-${name}.png`) });
      forms.current = await stageOf();
      forms.pressedAtStart = `${await before.getAttribute("aria-pressed")}/${await now.getAttribute("aria-pressed")}`;
      await before.focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(700);
      await ghost.screenshot({ path: join(outDir, `ghost-human-${name}.png`) });
      forms.humanViaToggle = await stageOf();
      forms.pressedAfter = `${await before.getAttribute("aria-pressed")}/${await now.getAttribute("aria-pressed")}`;
      await now.focus();
      await page.keyboard.press("Space");
      await page.waitForTimeout(700);
      forms.restoredViaKeyboard = await stageOf();
    }
    if (await page.getByTestId("dev-tools").count()) {
      const archive = page.getByRole("button", { name: "Archive" });
      for (const label of ["Before the forgetting", "Distorted", "Transformed"]) {
        await archive.click();
        await page.locator("label", { hasText: label }).first().click({ timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(500);
        await ghost.screenshot({ path: join(outDir, `ghost-dev-${label.split(" ")[0].toLowerCase()}-${name}.png`) });
        forms[`dev_${label}`] = await stageOf();
      }
      for (const label of ["Thinking", "Speaking", "Idle"]) {
        await archive.click();
        await page.locator("label", { hasText: label }).first().click({ timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await ghost.screenshot({ path: join(outDir, `ghost-dev-pose-${label.toLowerCase()}-${name}.png`) });
        forms[`dev_pose_${label}`] = (await page.locator('svg[role="img"]').first().getAttribute("data-pose")) ?? "";
      }
    }
  } catch (e) {
    forms.error = String((e as Error).message).split("\n")[0];
  }
  res.forms = forms;
  res.consoleErrors = consoleErrors;
  report[name] = res;
  await ctx.close();
}

// Reduced motion: real emulation, measured movement.
async function motion(reduced: boolean) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS.desktop, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.goto(base + repoPath + "?ui=classic", { waitUntil: "networkidle" }); // the classic screen; V4 is the default
  await page.waitForSelector('svg[role="img"]');
  const info = await page.evaluate(() => {
    const el = document.querySelector(".ghost-bob") as Element | null;
    return { media: matchMedia("(prefers-reduced-motion: reduce)").matches, animationName: el ? getComputedStyle(el).animationName : "(no .ghost-bob)" };
  });
  const ys: number[] = [];
  for (let i = 0; i < 12; i++) {
    ys.push(await page.evaluate(() => document.querySelector('svg[role="img"]')!.getBoundingClientRect().y));
    await page.waitForTimeout(350);
  }
  await ctx.close();
  return { ...info, minY: Math.min(...ys), maxY: Math.max(...ys), moved: Math.max(...ys) - Math.min(...ys) > 0.5 };
}
report.motionNoPreference = await motion(false);
report.motionReduce = await motion(true);

await browser.close();
writeFileSync(join(outDir, "browser-check.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
