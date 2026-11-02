/**
 * V6 browser checks WITHOUT any model call. The browser runs against a real production build; every /api/chat answer
 * is replayed from `.local/v6/ui-fixtures.json`, which the offline route test writes by running the REAL route,
 * pipeline, Bedrock adapter and validator against a fake model (V6_WRITE_UI_FIXTURES=1 npx vitest run
 * src/app/api/chat/route.bedrock-mock.test.ts). So the UI renders exactly what the server would send for a Bedrock
 * provider, and nothing here can reach AWS.
 *
 *   node scripts/v6-browser.mts <scriptedBase> <modelConfiguredBase> <outDir>
 *
 *   scriptedBase          next start with the default (mock) configuration
 *   modelConfiguredBase   next start with GITGHOST_CHAT_PROVIDER=bedrock but an AWS profile that does not exist, so
 *                         even a request that slipped past the interception could not reach AWS
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page, type Route } from "playwright-core";

const [scriptedBase = "http://127.0.0.1:3100", modelBase = "http://127.0.0.1:3102", outDir = "docs/screenshots/v6"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
type Fx = { status: number; body: { ok: boolean; code?: string; message?: string; retryAfterSec?: number; answer?: Record<string, unknown> } };
const FX = JSON.parse(readFileSync(".local/v6/ui-fixtures.json", "utf8")) as Record<string, Fx>;
const TARGET = "microsoft/VisualStudioUninstaller";
const QUESTION = "Tell me about your past. What was this repository originally created to do?";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
const ALLOWED_KEYS = new Set(["owner", "repo", "question", "history", "form", "asOf", "eraStage"]);

async function ask(page: Page, text: string) {
  const notes = await page.getByTestId("reply-note").count();
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="reply-note"]').length > n || !!document.querySelector('[data-testid="ask-error"]'), notes, { timeout: 20000 });
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 1200 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const shot = (page: Page, f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });

  // ---------- A. the model-configured server, every answer replayed from the real route
  {
    const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    const bodies: Record<string, unknown>[] = [];
    let queue: (Fx | "abort" | "html")[] = [];
    let hits = 0;
    await page.route("**/api/chat", async (route: Route) => {
      hits++;
      const req = route.request();
      bodies.push(JSON.parse(req.postData() ?? "{}"));
      const next = queue.shift();
      if (next === undefined) return route.abort(); // nothing is expected: fail loudly rather than reach any server
      if (next === "abort") return route.abort();
      if (next === "html") return route.fulfill({ status: 200, contentType: "text/html", body: "<html>gateway</html>" });
      const fx = structuredClone(next);
      const b = bodies.at(-1)!;
      if (b.asOf && fx.body.answer) {
        const a = fx.body.answer as { asOf?: { sha: string; shortSha: string; date: string } };
        a.asOf = { sha: String(b.asOf), shortSha: String(b.asOf).slice(0, 7), date: "2016-03-24T00:00:00Z" };
      }
      return route.fulfill({ status: fx.status, contentType: "application/json", body: JSON.stringify(fx.body) });
    });

    await page.goto(`${modelBase}/repo/${TARGET}`, { waitUntil: "networkidle" });
    await page.getByTestId("v4").waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    check(`${name}: a model-configured server says AI replies in the header, and each reply is labelled`, /AI replies/i.test(await page.getByTestId("live-banner").innerText()));
    await shot(page, "01-model-configured");

    // an AI answer
    queue = [FX.ai];
    await ask(page, QUESTION);
    const aiNote = page.getByTestId("reply-note").last();
    check(`${name}: an AI answer is marked AI (visible tag, data-provider, words), not scripted`, (await aiNote.getAttribute("data-provider")) === "bedrock" && (await aiNote.locator(".v4-ai-tag").count()) === 1 && /AI-written/i.test(await aiNote.innerText()) && !/scripted/i.test(await aiNote.innerText()));
    check(`${name}: the ghost's words, a record line and a source chip render`, (await page.locator('.v4-turn .v4-ghostline').count()) >= 1 && (await page.locator('.v4-turn .v4-fact[data-kind="record"]').count()) >= 1 && (await page.locator(".v4-turn .v4-cite").count()) >= 1);
    check(`${name}: no Ghost/Record/Memory tag labels are shown in the normal view`, (await page.locator(".v4-dlg .rpg-tag").count()) === 0);
    await shot(page, "02-ai-answer");
    await page.locator(".v4-turn .v4-cite").first().click();
    await page.getByTestId("evidence-detail").first().waitFor();
    check(`${name}: the source opens with a GitHub link`, /^https:\/\/github\.com\//.test((await page.getByTestId("evidence-link").getAttribute("href")) ?? ""));
    await shot(page, "03-ai-evidence");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // a scripted answer in the same conversation: the two stay distinguishable
    queue = [FX.scripted];
    await ask(page, "Why did you die?");
    const notes = page.getByTestId("reply-note");
    check(`${name}: a scripted answer right after an AI one is marked scripted, with no AI tag, and the earlier AI note is unchanged`,
      (await notes.nth(0).getAttribute("data-provider")) === "bedrock" && (await notes.nth(1).getAttribute("data-provider")) === "mock" && (await notes.nth(1).locator(".v4-ai-tag").count()) === 0 && /scripted/i.test(await notes.nth(1).innerText()));
    await shot(page, "04-ai-then-scripted");

    // missing evidence: honest and cite-free
    queue = [FX["missing-evidence"]];
    await ask(page, "What were you for?");
    const lastTurn = page.locator(".v4-turn").last();
    check(`${name}: an answer whose citation was dropped says it could not support one, with no source chips`, /could not support/i.test(await lastTurn.innerText()) && (await lastTurn.locator(".v4-cite").count()) === 0);

    // every failure shape: an alert with a retry, no new answer, the server's own words only
    const before = await page.getByTestId("reply-note").count();
    const cases: [string, Fx | "abort" | "html", RegExp][] = [
      ["malformed model JSON", FX.malformed, /could not be verified/i],
      ["empty reply", FX.empty, /could not be verified/i],
      ["empty segment list", FX["empty-list"], /could not be verified/i],
      ["provider timeout", FX.timeout, /./],
      ["provider error", FX["provider-error"], /./],
      ["rate limit", FX["rate-limited"], /Try again in \d+ seconds/i],
      ["daily limit", FX["daily-limit"], /./],
      ["budget", FX.budget, /./],
      ["kill switch", FX["kill-switch"], /switched off/i],
      ["connection dropped", "abort", /could not be reached/i],
      ["a gateway page instead of JSON", "html", /unreadable/i],
    ];
    for (const [label, fx, expectText] of cases) {
      queue = [fx];
      await ask(page, "Is anyone there?");
      const err = page.getByTestId("ask-error");
      const text = (await err.innerText()).replace(/\s+/g, " ");
      check(`${name}: ${label}: shown as an alert with a retry and no answer`, (await err.getAttribute("role")) === "alert" && expectText.test(text) && (await err.getByRole("button", { name: "Try again" }).count()) === 1 && (await page.getByTestId("reply-note").count()) === before, text.slice(0, 80));
      check(`${name}: ${label}: nothing about the model, region, profile or cost is shown`, !/amazon|nova|us-east|gitghost-smoke|arn:|token|micro|\$/i.test(text));
      if (label === "kill switch") {
        check(`${name}: when model replies are switched off the error offers the offline demo (invented data), never a silent scripted answer`, (await err.getByRole("link", { name: /offline demo/i }).count()) === 1);
        await shot(page, "05-kill-switch");
      }
      if (label === "rate limit") await shot(page, "06-rate-limit");
    }

    // Time Travel: an earlier commit sends the era to the server and the AI answer is labelled with it
    queue = [FX["ai-era"]];
    const eras = page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])');
    const n = await eras.count();
    if (small) await page.getByTestId("journal-button").click();
    const idx = Math.max(1, Math.floor((n - 1) * 0.25));
    const shortSha = /\b[0-9a-f]{7}\b/.exec(await page.getByTestId(`era-${idx}`).innerText())?.[0] ?? "?";
    await page.getByTestId(`era-${idx}`).click();
    await page.waitForTimeout(2800);
    const bodiesBefore = bodies.length;
    await ask(page, "What happened during this time?");
    const eraBody = bodies[bodiesBefore];
    check(`${name}: an earlier commit sends its full SHA and look to the server (and only fields the server accepts)`, /^[0-9a-f]{40}$/.test(String(eraBody?.asOf)) && String(eraBody.asOf).startsWith(shortSha) && ["human", "distorted", "transformed"].includes(String(eraBody.eraStage)) && Object.keys(eraBody).every((k) => ALLOWED_KEYS.has(k)), Object.keys(eraBody ?? {}).join(","));
    check(`${name}: the history sent with an era question contains only turns from that era`, Array.isArray(eraBody?.history) && (eraBody.history as unknown[]).length === 0);
    const eraNote = await page.getByTestId("reply-note").last().innerText();
    check(`${name}: the AI answer for the era says it was held to that commit`, new RegExp(`held to ${shortSha}`).test(eraNote) && /AI-written/i.test(eraNote), eraNote.slice(0, 90));
    check(`${name}: the era chip, the journal and the dialogue tag all show the same older commit`, (await page.getByTestId("era-chip").innerText()).includes(shortSha) && (await page.getByTestId("dlg-era").innerText()).toLowerCase().includes(shortSha));
    await shot(page, "07-ai-in-an-earlier-era");
    // returning to the present sends no era at all
    await page.getByTestId("return-chip").click();
    await page.waitForTimeout(2800);
    queue = [FX.ai];
    const b2 = bodies.length;
    await ask(page, "And now?");
    check(`${name}: back in the present, the question carries no era`, bodies[b2] && !("asOf" in bodies[b2]) && !("eraStage" in bodies[b2]));

    // nothing secret reached the page: markup, storage and every script the page loaded
    const html = await page.content();
    const store = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
    const scripts: string[] = await page.evaluate(() => [...new Set([...document.scripts].map((s) => s.src).filter(Boolean))]);
    let bundle = "";
    for (const u of scripts) bundle += await (await ctx.request.get(u)).text();
    const FORBIDDEN = /amazon\.nova|nova-lite|gitghost-smoke|v6-no-such-profile|v6-offline|@aws-sdk|bedrock-runtime|GITGHOST_BEDROCK|BEDROCK_MODEL_ID|AWS_PROFILE|AWS_REGION|gitghost-usage|arn:aws|AKIA[0-9A-Z]{12}|aws_secret/i;
    check(`${name}: the page markup, storage and ${scripts.length} downloaded scripts contain no model ID, profile, table, SDK or key`, !FORBIDDEN.test(html + store + bundle), FORBIDDEN.exec(html + store + bundle)?.[0] ?? "");
    check(`${name}: every /api/chat call was intercepted: the browser never reached a chat server`, hits === bodies.length && hits >= 14);
    check(`${name}: no console errors`, errors.length === 0, errors[0]?.slice(0, 120));
    await ctx.close();
  }

  // ---------- B. the default (scripted) server answers for real, and says so
  {
    const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
    const page = await ctx.newPage();
    await page.goto(`${scriptedBase}/repo/${TARGET}`, { waitUntil: "networkidle" });
    await page.getByTestId("v4").waitFor({ timeout: 60000 });
    check(`${name}: the default server's banner still says scripted`, /scripted replies/i.test(await page.getByTestId("live-banner").innerText()));
    await ask(page, QUESTION);
    const note = page.getByTestId("reply-note").last();
    check(`${name}: the default server's real answer is marked scripted and has no AI tag`, (await note.getAttribute("data-provider")) === "mock" && (await note.locator(".v4-ai-tag").count()) === 0 && /scripted/i.test(await note.innerText()));
    await shot(page, "08-default-scripted");
    await ctx.close();
  }
}

await browser.close();
console.log(log.join("\n"));
