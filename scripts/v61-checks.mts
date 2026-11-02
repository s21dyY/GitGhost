/**
 * V6.1 targeted browser matrix (visual pass). Not a replacement for the older scripts: it covers only what the pass changed.
 *   node scripts/v61-checks.mts <base> <outDir>
 * Landing (unrevealed presences, summon, keyboard, reduced motion) and encounter (dialogue, quiet records, memories,
 * keyboard, no clipping) at 1440x900 and 390x844. No model is involved; the server stays on its default scripted setup.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://127.0.0.1:3100", outDir = "docs/screenshots/v6-1/after"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
const NAMES = /atom|mozilla|request|bower|moment|pdf\.js|\bsend\b/i;

async function ask(page: Page, text: string) {
  const n = await page.getByTestId("reply-note").count();
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid="reply-note"]').length > k || !!document.querySelector('[data-testid="ask-error"]'), n, { timeout: 60000 });
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 1200 }).catch(() => undefined);
  await page.waitForTimeout(400);
}
const inView = (page: Page, sel: string) =>
  page.evaluate((s) => { const r = document.querySelector<HTMLElement>(s)!.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1 && r.left >= 0 && r.right <= innerWidth + 1 && r.width > 40; }, sel);

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = (f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });

  // ---------------- landing: unrevealed
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector("#featured")!.scrollIntoView());
  await page.mouse.wheel(0, small ? 140 : 150);
  await page.waitForTimeout(600);
  await shot("01-landing");
  const visible = await page.evaluate(() => document.body.innerText);
  const labels = await page.evaluate(() => [...document.querySelectorAll("[aria-label]")].map((e) => e.getAttribute("aria-label")).join(" | "));
  check(`${name}: six unrevealed presences, as buttons`, (await page.getByTestId("presence").count()) === 6);
  check(`${name}: no repository name, status or metadata is visible or in any accessible name`, !NAMES.test(visible.replace(/pdf\.js is|GitHub/g, "")) && !NAMES.test(labels) && !/archived|quiet by|last push|javascript/i.test(visible), labels.slice(0, 80));
  check(`${name}: no ghost character is drawn on the landing (no sprites, no repo links)`, (await page.locator(".v4g, a[href^='/repo/']").count()) === 0);
  check(`${name}: the manual summon form is still there`, (await page.getByLabel(/Summon your own/i).count()) === 1 || (await page.locator("#summon-input").count()) === 1);
  check(`${name}: nothing scrolls sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const x0 = await page.locator(".presence-drift").first().evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  await page.waitForTimeout(1800);
  const x1 = await page.locator(".presence-drift").first().evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  check(`${name}: the presences wander`, Math.abs(x1 - x0) > 0.3);
  if (!small) {
    const b = (await page.getByTestId("presence").nth(1).boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(500);
    check(`${name}: hovering a presence shows only a cue to approach`, (await page.locator(".presence-cue").nth(1).evaluate((e) => getComputedStyle(e).opacity)) === "1" && !NAMES.test(await page.locator(".presence").nth(1).innerText()));
    await shot("02-landing-hover");
  }

  // keyboard: focus a presence, see the ring, Enter summons
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByTestId("presence").first().focus();
  await page.keyboard.press("Shift");
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement!); return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 3; });
  check(`${name}: a presence takes keyboard focus with a visible ring`, ring);
  await page.keyboard.press("Enter");
  await page.getByTestId("summon-veil").waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  await shot("03-summon");
  check(`${name}: choosing a presence plays the summon veil and tells assistive tech`, (await page.getByTestId("summon-veil").count()) === 1 && /Summoning/.test(await page.locator('[role="status"]').first().innerText()));
  await page.waitForURL("**/repo/**", { timeout: 30000 });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForTimeout(250);
  await shot("04-arriving");
  await page.waitForFunction(() => !document.querySelector('[data-testid="v4-arrive"]'), null, { timeout: 8000 });
  check(`${name}: the real character appears only now, inside the encounter`, (await page.locator(".v4-ghost .v4g").count()) >= 1);

  // reduced motion
  const rm = await browser.newContext({ viewport: vp, reducedMotion: "reduce", isMobile: small, hasTouch: small });
  const rp = await rm.newPage();
  await rp.goto(base + "/", { waitUntil: "networkidle" });
  check(`${name}: reduced motion: the presences hold still`, await rp.evaluate(() => [".presence-drift", ".presence-face"].every((s) => getComputedStyle(document.querySelector(s)!).animationName === "none")));
  await rp.getByTestId("presence").nth(2).focus();
  await rp.keyboard.press("Enter");
  await rp.waitForURL("**/repo/**", { timeout: 30000 });
  check(`${name}: reduced motion: summoning is immediate, with no veil and no arrival overlay`, (await rp.getByTestId("summon-veil").count()) === 0 && (await rp.getByTestId("v4-arrive").count()) === 0);
  await rm.close();

  // ---------------- encounter
  await page.goto(`${base}/repo/microsoft/VisualStudioUninstaller`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  // Guard: this matrix asks questions. It must never do that against a server that would call a model.
  if (!/scripted replies|replies unavailable/i.test(((await page.locator(".v4-top").textContent()) ?? ""))) {
    console.error("ABORT: the server at " + base + " is configured for AI replies. Start the mock server instead: ./infra/v6/serve-mock.sh");
    process.exit(3);
  }
  await shot("05-encounter");
  const gh = await page.locator(".v4-ghost .v4g").first().boundingBox();
  check(`${name}: the ghost is large and fully on screen`, !!gh && gh.height >= (small ? 200 : 300) && gh.y >= 0 && gh.y + gh.height <= vp.height, `${gh?.width}x${gh?.height}`);
  check(`${name}: the question input is on screen and not clipped`, await inView(page, "#main input"));
  const head = ((await page.locator(".v4-top").textContent()) ?? "").replace(/\s+/g, " ");
  check(`${name}: no developer wording in the header (only a quiet provider badge${small ? ", hidden on phones: each reply carries its own label" : ""})`, (small || /scripted replies/i.test(head)) && !/microsoft\/|LIVE/.test(head), head.slice(0, 80));
  await ask(page, "Why did you die?");
  const dlg = await page.getByTestId("v4-dialogue").innerText();
  check(`${name}: the dialogue shows the ghost's words and plain facts, with no evidence blocks, excerpts or links`, !/Retrieved text|Open on GitHub|Source:/i.test(dlg) && (await page.locator(".v4-dlg .v4-excerpt, .v4-dlg [data-testid='evidence-detail']").count()) === 0, dlg.replace(/\s+/g, " ").slice(0, 100));
  const seals = await page.locator(".v4-turn .v4-cite").count();
  check(`${name}: sources are small seals`, seals >= 1 && (await page.locator(".v4-turn .v4-cite").first().evaluate((e) => (e.textContent ?? "").trim())) === "");
  check(`${name}: facts and the ghost's voice are told apart (gold rule vs italic crimson rule)`, (await page.locator('.v4-turn .v4-fact[data-kind="record"]').count()) >= 1 && (await page.locator(".v4-turn .v4-ghostline").count()) >= 1);
  await shot("06-conversation");

  // records drawer: open, content, does not take over the conversation, close, focus returns
  const seal = page.locator(".v4-turn .v4-cite").first();
  await seal.focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("records").waitFor();
  await page.waitForTimeout(300);
  const dr = (await page.getByTestId("evidence-drawer").locator(".drawer-inner").boundingBox())!;
  if (small) check(`${name}: the records sheet covers at most 45% of the screen and leaves the input visible`, dr.height <= vp.height * 0.45 && (await inView(page, "#main input")), `${Math.round(dr.height)}px`);
  else check(`${name}: the records drawer sits beside the scene and the input stays visible`, dr.width <= 560 && (await inView(page, "#main input")), `${Math.round(dr.width)}px`);
  check(`${name}: the records show type, text and a GitHub link, and a heading`, (await page.getByTestId("records").getByTestId("evidence-link").count()) >= 1 && /./.test(await page.getByTestId("records").locator("h3").first().innerText()));
  await shot("07-records");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check(`${name}: Escape closes the records and focus returns to the seal`, (await page.getByTestId("evidence-drawer").evaluate((d) => (d as HTMLDialogElement).open)) === false && (await page.evaluate(() => document.activeElement?.classList.contains("v4-cite") === true)));
  await seal.click();
  await page.getByTestId("records").waitFor();
  await page.getByTestId("evidence-drawer").getByRole("button", { name: "Close", exact: true }).click();
  await page.waitForTimeout(300);
  check(`${name}: the Close button closes the records`, (await page.getByTestId("evidence-drawer").evaluate((d) => (d as HTMLDialogElement).open)) === false);

  // keyboard through the dialogue
  await page.getByLabel("Your question").focus();
  await page.keyboard.type("What happened during this time?");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 8000 }).catch(() => undefined); // the note appears when the typing ends
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="reply-note"]').length >= 2, null, { timeout: 60000 });
  check(`${name}: a question typed and sent with the keyboard alone gets an answer`, (await page.getByTestId("reply-note").count()) >= 2);
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 800 }).catch(() => undefined);

  // memory selection + transformation + one way back
  const eras = page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])');
  const n = await eras.count();
  const formBefore = await page.getByTestId("v4").getAttribute("data-form");
  if (small) await page.getByTestId("journal-button").click();
  await page.getByTestId(`era-${Math.max(1, Math.floor((n - 1) * 0.25))}`).click();
  await page.waitForTimeout(700);
  await shot("08-transforming");
  await page.waitForTimeout(2300);
  check(`${name}: choosing an earlier memory transforms the ghost and marks the era`, (await page.getByTestId("v4").getAttribute("data-form")) !== formBefore && /older era/i.test(await page.getByTestId("era-chip").innerText()));
  check(`${name}: the conversation is still on screen after travelling`, (await page.getByTestId("travel-mark").count()) >= 1 && (await inView(page, "#main input")));
  await shot("09-older-memory");
  check(`${name}: exactly one Return to present`, ((await page.locator("body").innerText()).match(/return to present/gi) ?? []).length === 1);
  await page.getByTestId("return-chip").click();
  await page.waitForTimeout(2600);
  check(`${name}: Return to present restores the saved look`, (await page.getByTestId("v4").getAttribute("data-form")) === formBefore);

  // dev view
  await page.goto(`${base}/repo/microsoft/VisualStudioUninstaller?dev=1`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  const devHead = (await page.locator(".v4-top").textContent()) ?? "";
  check(`${name}: ?dev=1 brings back the labels and notes`, /microsoft\/visualstudiouninstaller/i.test(devHead) && /Scene: infra/.test(await page.getByTestId("archive").innerText()));
  check(`${name}: no console errors`, errors.length === 0, errors[0]?.slice(0, 120));
  await ctx.close();
}

await browser.close();
console.log(log.join("\n"));
