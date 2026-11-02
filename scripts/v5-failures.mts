/**
 * Failure paths for Milestone V5.
 *   server A (normal):            npx next start -p 3100
 *   server B (GitHub unreachable): env GITHUB_TOKEN=invalid-for-test npx next start -p 3101
 *   node scripts/v5-failures.mts <baseA> <baseB> <outDir>
 * The "bad token" makes every GitHub call fail with an auth error, which is how this script simulates
 * GitHub being unavailable without touching the network. No AI model is involved.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [baseA = "http://127.0.0.1:3100", baseB = "http://127.0.0.1:3101", outDir = "docs/screenshots/v5/failures"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
const TARGET = "microsoft/VisualStudioUninstaller";

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const D = name === "desktop";
  const ctx = await browser.newContext({ viewport: vp, isMobile: !D, hasTouch: !D });
  const page = await ctx.newPage();
  const shot = (f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });

  // 1. provider failure: the first answer fails, the retry works
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, code: "provider_error", message: "The ghost could not answer right now." }) });
    return route.continue();
  });
  await page.goto(`${baseA}/repo/${TARGET}`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.getByLabel("Your question").fill("Why did you die?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByTestId("ask-error").waitFor({ timeout: 15000 });
  await shot("01-provider-failure");
  check(`${name}: a provider failure is shown as an alert with a retry, not as an answer`, (await page.getByTestId("ask-error").getAttribute("role")) === "alert" && (await page.getByTestId("reply-note").count()) === 0 && (await page.locator(".v4-you").count()) === 0 && (await page.locator('.v4-turn .v4-fact[data-kind="record"]').count()) === 1);
  await page.getByRole("button", { name: "Try again" }).click();
  await page.getByTestId("reply-note").last().waitFor({ timeout: 60000 });
  check(`${name}: retrying after a provider failure gives a normal grounded answer`, (await page.getByTestId("ask-error").count()) === 0 && /record/i.test(await page.getByTestId("v4-log").innerText()));
  await page.unroute("**/api/chat");

  // 2. rate limit shown with its wait
  await page.route("**/api/chat", (route) => route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ ok: false, code: "rate_limited", message: "Too many questions. Try again in 30 seconds.", retryAfterSec: 30 }) }));
  await page.getByLabel("Your question").fill("And lately?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByTestId("ask-error").waitFor({ timeout: 15000 });
  check(`${name}: a rate limit is explained in words`, /30 seconds/.test(await page.getByTestId("ask-error").innerText()));
  await page.unroute("**/api/chat");

  // 3. the network drops
  await page.route("**/api/chat", (route) => route.abort());
  await page.getByRole("button", { name: "Try again" }).click();
  await page.waitForTimeout(800);
  check(`${name}: a dropped connection is reported, not swallowed`, /could not be reached/i.test(await page.getByTestId("ask-error").innerText()));
  await page.unroute("**/api/chat");

  // 4. a repository GitHub does not know
  await page.goto(`${baseA}/repo/no-such-owner-zzqx/none-here`, { waitUntil: "networkidle" });
  await shot("02-not-found");
  check(`${name}: an unknown repository says so and does not show a ghost`, /Nothing to summon/i.test(await page.locator("body").innerText()) && (await page.getByTestId("v4").count()) === 0);

  // 5. GitHub unreachable: clear error, and a clearly labelled offline demo
  await page.goto(`${baseB}/repo/${TARGET}`, { waitUntil: "networkidle" });
  await shot("03-github-down");
  const body = await page.locator("body").innerText();
  check(`${name}: GitHub failing is reported as a failure, not as an empty repository`, /summoning failed/i.test(body) && (await page.getByTestId("v4").count()) === 0);
  const demo = page.getByRole("link", { name: /offline demo/i });
  check(`${name}: the error offers the offline demo and says its data is invented`, (await demo.count()) === 1 && /invented/i.test(await demo.innerText()));
  await demo.click();
  await page.getByTestId("v4").waitFor();
  await shot("04-offline-demo");
  check(`${name}: the offline demo is labelled Mock on every view`, (await page.getByTestId("mock-banner").count()) === 1 && (await page.locator(".v4-mock").count()) >= 1);
  await page.getByLabel("Your question").fill("why did this die?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByTestId("reply-note").last().waitFor({ timeout: 15000 });
  check(`${name}: the offline demo answers from fixtures and says so`, /invented fixtures/i.test(await page.getByTestId("reply-note").last().innerText()));
  await ctx.close();
}
await browser.close();
console.log(log.join("\n"));
