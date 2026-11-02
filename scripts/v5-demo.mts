/**
 * Milestone V5.2 end-to-end check against the running app and REAL GitHub (no AI model: the server stays on
 * the scripted provider unless the operator has opted in to Bedrock).
 *   npx next start -p 3100     (production build; .env.local supplies GITHUB_TOKEN and the identity table)
 *   node scripts/v5-demo.mts <baseUrl> <outDir> [owner/repo]
 * One conversation scene with a Memory Journal: it clicks only real controls (no prototype tools, no mode bar),
 * saves screenshots, and prints PASS/FAIL lines. It never prints secrets.
 * Default repository: microsoft/VisualStudioUninstaller (public, archived, 76 commits).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://127.0.0.1:3100", outDir = "docs/screenshots/v5-2", target = "microsoft/VisualStudioUninstaller"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
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



const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);

async function ask(page: Page, text: string) {
  const before = await page.getByTestId("reply-note").count();
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="reply-note"]').length > n || !!document.querySelector('[data-testid="ask-error"]'), before, { timeout: 90000 });
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
}
const formOf = (page: Page) => page.getByTestId("v4").getAttribute("data-form");
const eraCount = (page: Page) => page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])').count();

/** Open the Memory Journal drawer on small screens; on desktop it is always there. */
async function openJournal(page: Page, small: boolean) {
  if (small && (await page.getByRole("complementary", { name: "Memory Journal" }).isHidden())) await page.getByTestId("journal-button").click();
}

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, laptop: { width: 1366, height: 768 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = (f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });

  // 1. summon through the landing form
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.getByRole("textbox").first().fill(`github.com/${target}`);
  await page.keyboard.press("Enter");
  await page.waitForURL(`**/repo/${target}`, { timeout: 60000 });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="v4-arrive"]'), null, { timeout: 8000 }); // the arrival from the summoning takes about a second
  await page.waitForTimeout(600);
  await shot("01-summoned");
  check(`${name}: the ghost is named for the repository`, (await page.getByTestId("nameplate").innerText()) === target.split("/")[1]);
  check(`${name}: no Spirit Mirror, no suggestions panel, no visible Ghost/Record/Memory labels in the dialogue`, (await page.getByText("Spirit Mirror").count()) === 0 && (await page.getByText("Suggested questions").count()) === 0 && (await page.locator(".v4-dlg .rpg-tag").count()) === 0 && (await page.locator(".v4-prompt").count()) >= 1);
  check(`${name}: no mode bar, no section tabs, no prototype tools`, (await page.locator('[data-testid^="act-"], [data-testid^="tab-"], [data-testid="tools"]').count()) === 0 && (await page.getByRole("navigation", { name: "Player actions" }).count()) === 0);
  check(`${name}: the question box is on screen without scrolling`, await page.evaluate(() => { const r = document.querySelector<HTMLElement>("#main input")!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.width > 0; }));
  check(`${name}: the page itself does not scroll`, await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1 && document.documentElement.scrollWidth <= innerWidth));
  check(`${name}: the whole ghost is on screen`, await page.evaluate(() => { const r = document.querySelector<HTMLElement>(".v4-ghost .v4g")!.getBoundingClientRect(); const top = document.querySelector<HTMLElement>(".v4-top")!.getBoundingClientRect().bottom; return r.top >= top - 2 && r.bottom <= innerHeight + 2 && r.left >= 0 && r.right <= innerWidth; }));
  check(`${name}: the dialogue box does not scroll on its own (only the conversation does)`, await page.evaluate(() => { const b = document.querySelector<HTMLElement>(".v4-dlg-box")!; return b.scrollHeight <= b.clientHeight + 1; }));
  const a1 = await page.evaluate(audit);
  check(`${name}: summoned screen has no contrast failures and no text under 12px`, a1.contrastFails.length === 0 && a1.minFont >= 12, `min ${a1.minFont}px ${a1.contrastFails.slice(0, 2).join(" ; ")}`);

  // 2. the Memory Journal lists real commits
  await openJournal(page, small);
  await shot("02-journal");
  const nodes = await eraCount(page);
  check(`${name}: the Memory Journal lists real commits`, nodes >= 3, `${nodes} memories`);
  const newestFirst = await page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])').first().getAttribute("data-testid");
  check(`${name}: the journal is newest first and starts at the present`, newestFirst === `era-${nodes - 1}` && (await page.locator('[data-present="true"][aria-current="true"]').count()) === 1);
  const first = await page.getByTestId("era-0").innerText();
  check(`${name}: an entry shows a 7-character sha, a date and a message`, /\b[0-9a-f]{7}\b/.test(first) && /\d{4}-\d{2}-\d{2}/.test(first), first.replace(/\n/g, " | ").slice(0, 80));
  if (!small) {
    const scrolls = await page.evaluate(() => { const l = document.querySelector<HTMLElement>(".v4-memories")!; return { scrollable: l.scrollHeight > l.clientHeight, page: document.documentElement.scrollHeight <= innerHeight + 1 }; });
    check(`${name}: a long journal scrolls by itself and not the page`, scrolls.page && (nodes < 8 || scrolls.scrollable), JSON.stringify(scrolls));
  }
  if (small) await page.getByRole("button", { name: "Close", exact: true }).first().click();

  // 3. a factual question, then a creative one
  await ask(page, "Why did you die?");
  await shot("03-answer-now");
  const a2 = await page.evaluate(audit);
  check(`${name}: the answer view has no contrast failures`, a2.contrastFails.length === 0 && a2.minFont >= 12, a2.contrastFails.slice(0, 2).join(" ; "));
  check(`${name}: the answer is grounded (a Record line and source chips)`, (await page.locator('.v4-turn .v4-fact[data-kind="record"]').count()) > 0 && (await page.locator(".v4-turn .v4-cite").count()) > 0);
  check(`${name}: the answer states the scripted mode honestly`, /scripted|no AI model/i.test(await page.getByTestId("reply-note").last().innerText()));
  await ask(page, "Tell me a story about your last night.");
  check(`${name}: a creative question still gets a grounded or honest answer`, /record|not found|reading/i.test(await page.locator(".v4-turn").last().innerText()));

  // 4. contextual evidence: a chip opens a lightweight dialog with the text and the GitHub link
  await page.locator(".v4-turn .v4-cite").first().click();
  await page.getByTestId("evidence-detail").first().waitFor();
  await shot("04-evidence");
  const det = page.getByTestId("evidence-detail").first();
  check(`${name}: a source chip opens type, source, retrieved text and a GitHub link`, (await det.getByText("Type", { exact: true }).count()) === 1 && (await det.getByTestId("evidence-excerpt").innerText()).length > 5 && (await det.getByTestId("evidence-link").count()) === 1);
  const safe = await det.getByTestId("evidence-link").evaluate((a) => (a as HTMLAnchorElement).target === "_blank" && /noopener/.test((a as HTMLAnchorElement).rel) && (a as HTMLAnchorElement).href.startsWith("https://github.com/"));
  check(`${name}: the source link is safe (_blank, noopener, github.com)`, safe);
  check(`${name}: the ghost stays visible beside the evidence`, await page.evaluate(() => { const g = document.querySelector<HTMLElement>(".v4-ghost .v4g")!.getBoundingClientRect(); const d = document.querySelector<HTMLElement>(".drawer-inner")!.getBoundingClientRect(); return innerWidth < 1024 || g.right <= d.left + 2; }));
  const a3 = await page.evaluate(audit);
  check(`${name}: the evidence view has no contrast failures`, a3.contrastFails.length === 0 && a3.minFont >= 12, a3.contrastFails.slice(0, 2).join(" ; "));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check(`${name}: Escape closes the evidence and the question box is reachable again`, (await page.getByTestId("evidence-detail").count()) === 0 || !(await page.getByTestId("evidence-drawer").evaluate((d) => (d as HTMLDialogElement).open)));

  // 5. travel to a middle memory: the conversation stays on screen, the ghost changes, the era is clear
  await openJournal(page, small);
  const mid = Math.max(1, Math.floor((nodes - 1) * 0.25));
  const midText = (await page.getByTestId(`era-${mid}`).innerText()).replace(/\n/g, " | ");
  const midSha = /\b[0-9a-f]{7}\b/.exec(midText)?.[0] ?? "?";
  const formBefore = await formOf(page);
  await page.getByTestId(`era-${mid}`).click();
  await page.waitForTimeout(2800);
  await shot("05-old-era");
  check(`${name}: the stage chip shows the chosen commit and says it is an older era`, (await page.getByTestId("era-chip").innerText()).includes(midSha) && /older era/i.test(await page.getByTestId("era-chip").innerText()));
  check(`${name}: the ghost changes form for that era`, (await formOf(page)) !== formBefore, `${formBefore} -> ${await formOf(page)}`);
  check(`${name}: the conversation is still there (earlier answers and a travel marker)`, (await page.getByTestId("travel-mark").count()) >= 1 && (await page.locator(".v4-turn .v4-you").count()) >= 2);
  check(`${name}: the question box says it is about this era`, /this era/i.test((await page.getByLabel("Your question").getAttribute("placeholder")) ?? ""));
  check(`${name}: the dialogue is tagged with the commit`, (await page.getByTestId("dlg-era").innerText()).toLowerCase().includes(midSha));
  await openJournal(page, small);
  check(`${name}: the journal marks the selected memory and says it is an older era`, (await page.locator('[data-selected="true"]').count()) === 1 && (await page.getByTestId("past-banner").count()) === 1);
  if (small) await page.getByRole("button", { name: "Close", exact: true }).first().click();

  // 6. ask about the era straight away (no mode switch)
  await page.getByLabel("Your question").fill("What happened during this time?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="reply-note"]').length >= 3 || !!document.querySelector('[data-testid="ask-error"]'), null, { timeout: 90000 });
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
  await shot("06-old-era-answer");
  const note = await page.getByTestId("reply-note").last().innerText();
  check(`${name}: the era answer says it was held to that commit`, new RegExp(`held to ${midSha}`).test(note), note.slice(-110));
  const eraText = await page.locator(".v4-turn").last().innerText();
  check(`${name}: the era answer does not state the present-day archived flag`, !/\barchived\b/i.test(eraText));

  // 7. selecting a memory with the same look does not transform the ghost
  await openJournal(page, small);
  await page.getByTestId("era-0").click();
  await page.waitForTimeout(2800);
  check(`${name}: the earliest memory shows the human form`, (await formOf(page)) === "human");
  await openJournal(page, small);
  await page.getByTestId("era-1").click();
  await page.waitForTimeout(800);
  check(`${name}: choosing a neighbour with the same look plays no transformation`, (await page.locator('.v4-ghostwrap[data-playing="transform"]').count()) === 0 && (await formOf(page)) === "human");

  // 8. keyboard: focus a memory, see the ring, press Enter
  if (!small) {
    await page.keyboard.press("Shift");
    await page.getByTestId("era-3").focus();
    check(`${name}: a memory shows a visible focus ring`, await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 3; }));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2800);
    check(`${name}: Enter on a memory travels there`, (await page.getByTestId("era-chip").innerText()).includes((await page.getByTestId("era-3").innerText()).match(/\b[0-9a-f]{7}\b/)![0]));
  }

  // 9. return to the present
  const returnBtn = page.getByTestId("return-chip"); // the one Return to present control
  await returnBtn.click();
  await page.waitForTimeout(2800);
  await shot("07-returned");
  check(`${name}: Return to Present selects the latest commit and restores the saved form`, ["distorted", "horror"].includes((await formOf(page)) ?? "") && /present/i.test(await page.getByTestId("era-chip").innerText()) && (await page.getByTestId("past-banner").count()) === 0);
  check(`${name}: no console errors`, errors.length === 0);
  if (errors.length) log.push("  " + errors.slice(0, 3).join(" | ").slice(0, 300));
  await ctx.close();
}

// Reduced motion: selecting a memory changes the ghost at once, with no sweep or transformation
const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const rp = await rctx.newPage();
await rp.goto(`${base}/repo/${target}`, { waitUntil: "networkidle" });
await rp.getByTestId("v4").waitFor({ timeout: 60000 });
await rp.getByTestId("era-0").click();
await rp.waitForTimeout(250);
check("reduced motion: choosing a memory changes the ghost at once, with no sweep or transformation", (await formOf(rp)) === "human" && (await rp.locator(".v4-stage[data-rewinding], .v4-stage[data-transforming]").count()) === 0);
check("reduced motion: the older-era state is still shown in words", (await rp.getByTestId("past-banner").count()) === 1);
await rctx.close();
await browser.close();
console.log(log.join("\n"));
