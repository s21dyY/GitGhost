/**
 * Quick screenshot helper (Chrome via playwright-core).
 *   node scripts/shot.mts <url> <out.png> [width=1440] [height=900] [fullPage=1] [reduce=0]
 */
import { chromium } from "playwright-core";
const [url, out, w = "1440", h = "900", full = "1", reduce = "0"] = process.argv.slice(2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(w), height: Number(h) }, isMobile: Number(w) < 500, hasTouch: Number(w) < 500, reducedMotion: reduce === "1" ? "reduce" : "no-preference" });
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: full === "1" });
await browser.close();
console.log("saved", out);
