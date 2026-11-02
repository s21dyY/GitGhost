import { chromium } from "playwright-core";
const [url, out, w, h] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: +w, height: +h }, isMobile: +w < 600, hasTouch: +w < 600 })).newPage();
await p.goto(url, { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
await p.screenshot({ path: out, fullPage: false });
await b.close();
