/**
 * Before/after screenshots for the horror-atmosphere pass.
 *   node scripts/horror-shots.mts <baseUrl> <outDir> [repoPath=/repo/atom/atom]
 * Needs a running production server (no dev badge). Read-only: loads pages and clicks UI controls; the
 * chat uses the scripted mock provider. Viewport screenshots only (the scene is a fixed layer).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [base = "http://localhost:3100", outDir = "docs/screenshots/horror/after", repoPath = "/repo/atom/atom"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } } as const;
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const [name, vp] of Object.entries(VIEWPORTS)) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await ctx.newPage();
  const shot = (file: string) => page.screenshot({ path: join(outDir, `${file}-${name}.png`) });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await shot("landing");
  await page.goto(base + repoPath, { waitUntil: "networkidle" });
  await page.waitForSelector('svg[role="img"]', { timeout: 30000 });
  await page.waitForTimeout(1200);
  await shot("encounter-distorted");
  await page.getByRole("button", { name: "Before the forgetting" }).click();
  await page.waitForTimeout(1000);
  await shot("encounter-human");
  await page.getByRole("button", { name: "As it is now" }).click();
  await page.waitForTimeout(900);
  const chat = page.getByRole("region", { name: "Ask the ghost" });
  await chat.getByRole("button", { name: "Why did you die?" }).click();
  await chat.getByRole("button", { name: /Open in journal/ }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  await shot("dialogue-answer");
  await page.getByRole("button", { name: "Archive" }).click();
  await page.waitForTimeout(500);
  await shot("archive-drawer");
  await ctx.close();
}
await browser.close();
console.log("saved to", outDir);
