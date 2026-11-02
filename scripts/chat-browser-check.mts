/**
 * Real-browser check of the Séance conversation (Chrome via playwright-core).
 *   node scripts/chat-browser-check.mts <baseUrl> <outDir> [owner/repo]
 * Reads real GitHub data through the app and the scripted mock provider. No model is called.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://localhost:3000", outDir = "docs/screenshots/2b1", target = "atom/atom"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const path = `/repo/${target}?ui=classic`; // the classic screen; V4 is the default
const report: Record<string, unknown> = { base, path };

function audit() {
  const parse = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => { const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el: Element | null) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 10, g: 16, b: 23 }; };
  const fails: string[] = [];
  let minFont = 99;
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const el = n.parentElement;
    if (!el || seen.has(el) || !n.textContent?.trim() || el.closest(".sr-only")) continue;
    seen.add(el);
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || cs.visibility === "hidden") continue;
    const fs = parseFloat(cs.fontSize); minFont = Math.min(minFont, fs);
    const fg = parse(cs.color); if (!fg) continue;
    const l1 = lum(fg), l2 = lum(bgOf(el)); const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (ratio < (fs >= 24 ? 3 : 4.5)) fails.push(`${ratio.toFixed(2)} ${fs}px "${n.textContent.trim().slice(0, 40)}"`);
  }
  return { minFont, contrastFails: fails.slice(0, 10), overflowX: document.documentElement.scrollWidth > window.innerWidth };
}

async function tabStops(page: Page, max: number) {
  const stops: { el: string; visible: boolean }[] = [];
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const s = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL") return null;
      const t = getComputedStyle(el);
      const visible = (t.outlineStyle !== "none" && parseFloat(t.outlineWidth) > 0) || t.boxShadow !== "none";
      return { el: `${el.tagName.toLowerCase()}:${(el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 28) || el.id || "").trim()}`, visible };
    });
    if (!s) break;
    stops.push(s);
  }
  return stops;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
report.chrome = browser.version();

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: name === "mobile", hasTouch: name === "mobile" });
  const page = await ctx.newPage();
  const r: Record<string, unknown> = {};
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => m.type() === "error" && !m.text().includes("503") && !m.text().includes("429") && errors.push(m.text().slice(0, 140)));
  page.on("pageerror", (e) => errors.push(`pageerror ${e.message.slice(0, 140)}`));
  page.on("request", (q) => q.url().endsWith("/api/chat") && requests.push(q.postData() ?? ""));
  const pose = () => page.locator('svg[role="img"]').first().getAttribute("data-pose");
  const chat = page.getByRole("region", { name: "Ask the ghost" });

  await page.goto(base + path, { waitUntil: "networkidle" });
  await chat.waitFor();
  await page.screenshot({ path: join(outDir, `encounter-top-${name}.png`) });
  await chat.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `dialogue-initial-${name}.png`) });
  r.initial = { ...(await page.evaluate(audit)), starters: await chat.getByRole("button", { name: /Why did you die|What happened|How did you|complaining/ }).count() };

  // 1. Starter question with the pointer; watch the ghost pose change.
  const poses: string[] = [];
  const poll = setInterval(async () => { try { poses.push((await pose()) ?? ""); } catch { /* page closing */ } }, 120);
  await chat.getByRole("button", { name: "Why did you die?" }).click();
  await chat.getByRole("article").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  const midReveal = (await chat.getByRole("button", { name: "Skip" }).count()) > 0;
  await page.screenshot({ path: join(outDir, `dialogue-revealing-${name}.png`) });
  await chat.getByRole("button", { name: /Open in journal/ }).waitFor({ timeout: 15000 });
  clearInterval(poll);
  r.posesSeen = [...new Set(poses)];
  r.revealWasInProgress = midReveal;
  const first = chat.getByRole("article").first();
  const links = await first.locator("a").evaluateAll((as) => as.map((a) => ({ href: (a as HTMLAnchorElement).href, target: (a as HTMLAnchorElement).target, rel: (a as HTMLAnchorElement).rel, label: a.getAttribute("aria-label") ?? a.textContent })));
  r.firstAnswer = {
    text: (await first.innerText()).slice(0, 700),
    linkCount: links.length,
    allGitHub: links.every((l) => l.href.startsWith(`https://github.com/${target}`)),
    allNewTabSafe: links.every((l) => l.target === "_blank" && /noopener/.test(l.rel)),
    scriptedBadge: /no ai model was called/i.test(await first.innerText()),
  };
  await first.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `dialogue-answer-${name}.png`) });
  r.afterAnswer = await page.evaluate(audit);

  // Evidence journal: opens from the answer, keeps the chat, claims sit beside sources.
  const turnsBefore = await chat.getByText("You", { exact: true }).count();
  await chat.getByRole("button", { name: /Open in journal/ }).first().click();
  const journal = page.getByTestId("journal");
  await page.waitForTimeout(400);
  const entry = journal.locator('[id^="journal-entry-"]').first();
  r.journal = {
    open: await page.getByTestId("journal-drawer").evaluate((d) => (d as HTMLDialogElement).open),
    focusedEntry: await page.evaluate(() => document.activeElement?.id ?? ""),
    claimTags: await entry.locator(".rpg-tag").allInnerTexts(),
    sourceLinks: await entry.locator("a").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href)),
    chatTurnsKept: (await chat.getByText("You", { exact: true }).count()) === turnsBefore,
    ghostLinesFiled: (await entry.getByText("Ghost", { exact: true }).count()) > 0,
  };
  await journal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(outDir, `journal-open-${name}.png`) });
  await page.keyboard.press("Escape"); // close again; focus returns to the opener
  await chat.scrollIntoViewIfNeeded();

  // 2. Keyboard: Shift+Enter makes a new line, Enter sends, a double Enter does not duplicate.
  const box = chat.getByLabel("Your question");
  await box.scrollIntoViewIfNeeded();
  await box.fill("");
  await box.focus();
  await page.keyboard.type("What happened lately?");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Be brief.");
  r.shiftEnter = { value: await box.inputValue(), sentYet: requests.length };
  await box.fill("What happened lately?");
  const before = requests.length;
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await chat.getByRole("article").nth(1).waitFor({ timeout: 60000 });
  await chat.getByRole("button", { name: /Open in journal/ }).nth(1).waitFor({ timeout: 15000 });
  r.doubleEnterRequests = requests.length - before;

  // 3. Follow-up carries the topic and conversation history.
  await box.fill("tell me more");
  await page.keyboard.press("Enter");
  await chat.getByRole("article").nth(2).waitFor({ timeout: 60000 });
  const lastBody = JSON.parse(requests[requests.length - 1]);
  r.followUp = { historyTurns: lastBody.history.length, question: lastBody.question, form: lastBody.form, bodyKeys: Object.keys(lastBody).sort() };

  // 4. Horror vs human wording, using the existing toggle (no selector).
  await page.getByRole("button", { name: "Before the forgetting" }).click();
  await box.fill("Why did you die?");
  await page.keyboard.press("Enter");
  await chat.getByRole("article").nth(3).waitFor({ timeout: 60000 });
  await chat.getByRole("button", { name: /Open in journal/ }).nth(3).waitFor({ timeout: 15000 });
  const humanText = await chat.getByRole("article").nth(3).innerText();
  await page.screenshot({ path: join(outDir, `dialogue-human-${name}.png`) });
  await page.getByRole("button", { name: "As it is now" }).click();
  await box.fill("Why did you die?");
  await page.keyboard.press("Enter");
  await chat.getByRole("article").nth(4).waitFor({ timeout: 60000 });
  await chat.getByRole("button", { name: /Open in journal/ }).nth(4).waitFor({ timeout: 15000 });
  const horrorText = await chat.getByRole("article").nth(4).innerText();
  await page.screenshot({ path: join(outDir, `dialogue-horror-${name}.png`) });
  r.voices = { humanHasEllipsis: humanText.includes("…"), horrorHasEllipsis: horrorText.includes("…"), humanSample: humanText.split("\n").filter((l) => /Ghost/.test(l)).slice(0, 2), horrorSample: horrorText.split("\n").filter((l) => /Ghost/.test(l)).slice(0, 2) };
  r.userMessageCount = await chat.getByText("You", { exact: true }).count();

  // 4b. Loading state: hold one request open so the thinking state can be seen.
  await page.route("**/api/chat", async (route) => { await new Promise((r) => setTimeout(r, 1800)); await route.continue(); });
  await box.fill("What were people complaining about?");
  await page.keyboard.press("Enter");
  await chat.getByTestId("dialogue-log").getByText(/is thinking/).waitFor();
  r.loading = { thinkingPose: await pose(), sendDisabled: await chat.getByRole("button", { name: "Thinking…" }).isDisabled(), statusText: await chat.locator('p[role="status"]').innerText() };
  await page.screenshot({ path: join(outDir, `dialogue-loading-${name}.png`) });
  await chat.getByRole("article").nth(5).waitFor({ timeout: 60000 });
  await page.unroute("**/api/chat");

  // 5. Errors and retry without duplicates.
  const failBefore = requests.length;
  await page.route("**/api/chat", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, code: "github_unavailable", message: "GitHub could not be reached. Try again shortly." }) }));
  await box.fill("Any bugs?");
  await page.keyboard.press("Enter");
  const alert = chat.getByRole("alert");
  await alert.waitFor();
  r.errorState = { text: (await alert.innerText()).replace(/\n/g, " | "), retryButton: await alert.getByRole("button", { name: "Try again" }).count() };
  await page.screenshot({ path: join(outDir, `dialogue-error-${name}.png`) });
  const usersBeforeRetry = await chat.getByText("You", { exact: true }).count();
  await page.unroute("**/api/chat");
  await alert.getByRole("button", { name: "Try again" }).click();
  await chat.getByRole("article").nth(6).waitFor({ timeout: 60000 });
  await page.screenshot({ path: join(outDir, `dialogue-after-retry-${name}.png`) });
  r.retry = { youLabelsBeforeRetry: usersBeforeRetry, youLabelsAfterRetry: await chat.getByText("You", { exact: true }).count(), requestsDuringErrorAndRetry: requests.length - failBefore, alertGone: (await chat.getByRole("alert").count()) === 0 };

  // 6. Keyboard order, focus indicators, announcements.
  await page.goto(base + path, { waitUntil: "networkidle" });
  r.tabStops = (await tabStops(page, 60)).filter((s) => /textarea|div:|Why did|What|How did|Ask|Thinking|Before|As it is|Open in|Evidence/.test(s.el) || !s.visible);
  r.liveRegions = await page.evaluate(() => ({
    logLive: document.querySelector('[role="log"]')?.getAttribute("aria-live"),
    logFocusable: document.querySelector('[role="log"]')?.getAttribute("tabindex"),
    status: document.querySelector('p[role="status"].sr-only') !== null,
    labelledTextarea: !!document.querySelector("textarea")?.labels?.length,
  }));
  r.consoleErrors = errors;
  report[name] = r;
  await ctx.close();
}

// Reduced motion while speaking: real emulation.
async function reduced(emulate: boolean) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: emulate ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "networkidle" });
  const chat = page.getByRole("region", { name: "Ask the ghost" });
  await chat.getByRole("button", { name: "Why did you die?" }).click();
  await chat.getByRole("article").first().waitFor({ timeout: 60000 });
  const info = await page.evaluate(() => {
    const a = document.querySelector(".ghost-frame-a"), b = document.querySelector(".ghost-frame-b");
    return { pose: document.querySelector('svg[role="img"]')?.getAttribute("data-pose"), animA: a ? getComputedStyle(a).animationName : "(no speaking frame)", animB: b ? getComputedStyle(b).animationName : "(none)", opacityB: b ? getComputedStyle(b).opacity : "(none)" };
  });
  await ctx.close();
  return info;
}
report.reducedMotion = await reduced(true);
report.normalMotion = await reduced(false);

await browser.close();
writeFileSync(join(outDir, "chat-browser-check.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
