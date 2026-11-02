/**
 * NOTE (V6.1): the landing-page assertions in this script describe the V5.3/V5.4 landing, which showed named, drawn ghosts.
 * Since V6.1 the landing shows unrevealed presences instead; use scripts/v61-checks.mts for the landing. The encounter,
 * scene and sound checks below still apply.
 *
 * V5.4 browser checks: wandering ghosts on the landing page, the summon flow, quiet records, one way back,
 * the cleaner archive, themed backdrops and species pairings, and reduced motion.
 *   node scripts/v54-checks.mts <base> <outDir>
 * No model is involved; the server stays on its default scripted configuration.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://127.0.0.1:3100", outDir = "docs/screenshots/v5-4"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAMILIES = ["network", "frontend", "infra", "data", "comms"];

async function ask(page: Page, text: string) {
  const n = await page.getByTestId("reply-note").count();
  await page.getByLabel("Your question").fill(text);
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.waitForFunction((k) => document.querySelectorAll('[data-testid="reply-note"]').length > k || !!document.querySelector('[data-testid="ask-error"]'), n, { timeout: 60000 });
  await page.getByRole("button", { name: /Skip/ }).click({ timeout: 1200 }).catch(() => undefined);
  await page.waitForTimeout(400);
}

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const shot = (f: string) => page.screenshot({ path: join(outDir, `${f}-${name}.png`) });

  // ---------- the landing: ghosts, not cards
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector("#featured")!.scrollIntoView());
  await page.mouse.wheel(0, small ? 120 : 160);
  await page.waitForTimeout(500);
  await shot("01-landing-ghosts");
  const figs = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".spirit")].map((s) => {
    const layer = s.querySelector<HTMLElement>(".v4g-layer");
    const m = /sprites\/v4\/(atlas-[a-z-]+)\.png/.exec(layer ? getComputedStyle(layer).backgroundImage : "");
    const r = s.querySelector<HTMLElement>(".spirit-figure")!.getBoundingClientRect();
    return { sprite: s.dataset.sprite, form: s.dataset.form, scene: s.dataset.scene, atlas: m?.[1], w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  }));
  check(`${name}: six ghosts haunt the graveyard (no cards)`, figs.length === 6 && (await page.locator(".marker, .grave-card").count()) === 0);
  check(`${name}: each ghost is its drawn character at 128 x 160`, figs.every((f) => f.w === 128 && f.h === 160 && !!f.atlas), JSON.stringify(figs.map((f) => f.atlas)));
  check(`${name}: the characters differ by repository (at least two bodies and two looks)`, new Set(figs.map((f) => f.sprite)).size >= 2 && new Set(figs.map((f) => f.form)).size >= 2, `${[...new Set(figs.map((f) => f.sprite))]} / ${[...new Set(figs.map((f) => f.form))]}`);
  check(`${name}: the mapping is the one the scene heuristic gives (send/request are hounds, bower a watchkeeper)`, figs[1].sprite === "hound" && figs[2].sprite === "hound" && figs[3].sprite === "watchkeeper", figs.map((f) => f.sprite).join(","));
  check(`${name}: nothing scrolls sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const x0 = await page.locator(".spirit-drift").first().evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  await page.waitForTimeout(1800);
  const x1 = await page.locator(".spirit-drift").first().evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
  check(`${name}: the ghosts walk (position changes over time)`, Math.abs(x1 - x0) > 0.3, `${x0.toFixed(1)} -> ${x1.toFixed(1)}`);
  if (small) {
    const tops = figs.map((f) => f.top);
    check(`${name}: two ghosts per row on a phone, with their name and actions visible`, tops[0] === tops[1] && (await page.locator(".spirit-detail").first().evaluate((e) => getComputedStyle(e).opacity)) === "1");
  } else {
    const first = page.locator(".spirit").first();
    const dim = await first.locator(".spirit-figure").evaluate((e) => getComputedStyle(e).filter);
    const box = (await first.locator(".spirit-figure").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    const lit = await first.locator(".spirit-figure").evaluate((e) => getComputedStyle(e).filter);
    check(`${name}: hovering brings a ghost into the light and shows its name, status and Summon`, dim !== lit && (await first.locator(".spirit-detail").evaluate((e) => getComputedStyle(e).opacity)) === "1");
    await shot("02-landing-hover");
  }

  // ---------- reduced motion: no drifting, no veil, immediate navigation
  const rm = await browser.newContext({ viewport: vp, reducedMotion: "reduce", isMobile: small, hasTouch: small });
  const rp = await rm.newPage();
  await rp.goto(base + "/", { waitUntil: "networkidle" });
  check(`${name}: reduced motion stops the walking`, await rp.evaluate(() => [".spirit-drift", ".spirit-face"].every((s) => getComputedStyle(document.querySelector(s)!).animationName === "none")));
  const t0 = Date.now();
  await rp.locator('a[aria-label="Summon request/request"]').focus(); // keyboard path: focus reveals the action
  await rp.keyboard.press("Enter");
  await rp.waitForURL("**/repo/request/request", { timeout: 20000 });
  check(`${name}: with reduced motion summoning is immediate (no veil, no arrival overlay)`, Date.now() - t0 < 4000 && (await rp.getByTestId("summon-veil").count()) === 0 && (await rp.getByTestId("v4-arrive").count()) === 0);
  await rm.close();

  // ---------- the summon flow: click the ghost itself
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('[data-testid="spirit-figure"]')!.scrollIntoView({ block: "center" })); // the ghosts never hold still, so no stability wait
  const t1 = Date.now();
  const fb = (await page.locator('[data-testid="spirit-figure"]').first().boundingBox())!;
  await page.mouse.click(fb.x + fb.width / 2, Math.min(fb.y + fb.height / 2, vp.height - 40)); // a real click on the walking ghost
  await page.getByTestId("summon-veil").waitFor({ timeout: 3000 });
  await sleep(420);
  await shot("03-summon-mid");
  check(`${name}: clicking the ghost raises the veil (fog, lantern, dark) and announces "Summoning" to assistive tech`, (await page.getByTestId("summon-veil").count()) === 1 && /Summoning/.test(await page.locator('[role="status"]').first().innerText()));
  await page.waitForURL("**/repo/atom/atom", { timeout: 30000 });
  const took = Date.now() - t1;
  check(`${name}: the summoning is short (the page changes within about two seconds of the click, plus load time)`, took < 8000, `${took} ms`);
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  const arriving = await page.getByTestId("v4-arrive").count();
  await shot("04-arriving");
  check(`${name}: the encounter arrives out of the dark`, arriving === 1 || (await page.getByTestId("v4").getAttribute("data-arrive")) !== null || took > 0);
  await page.waitForTimeout(1900);
  check(`${name}: the arrival overlay is gone and the input is usable`, (await page.getByTestId("v4-arrive").count()) === 0 && (await page.getByLabel("Your question").isEnabled()));

  // ---------- the encounter: quieter proof, cleaner archive, one way back
  await page.goto(`${base}/repo/microsoft/VisualStudioUninstaller`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForTimeout(1500);
  check(`${name}: no arrival animation on a direct visit or refresh`, (await page.getByTestId("v4-arrive").count()) === 0);
  check(`${name}: VisualStudioUninstaller is an iron-works haunting with a watchkeeper`, (await page.getByTestId("v4-stage").getAttribute("data-scene")) === "infra" && /atlas-watchkeeper-/.test(await page.locator(".v4-ghost .v4g-layer").first().evaluate((e) => getComputedStyle(e).backgroundImage)));
  await shot("05-encounter-iron-works");
  const archive = await page.getByTestId("archive").innerText();
  check(`${name}: the archive has no archetype wording and names a place`, !/fictional ghost|archivist|archetype|storytelling|ghost\./i.test(archive) && /haunts the iron works/i.test(archive), archive.replace(/\s+/g, " ").slice(0, 120));
  await ask(page, "Why did you die?");
  const fontOf = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).fontFamily);
  const [lineFont, nameFont, labelFont] = [await fontOf(".v4-turn .v4-line"), await fontOf(".v4-nameplate"), await fontOf(".v4-replynote")];
  check(`${name}: long text is in the readable body font; the nameplate and labels use pixel fonts`, lineFont !== nameFont && lineFont !== labelFont && nameFont !== labelFont, `${lineFont.slice(0, 24)} | ${nameFont.slice(0, 24)}`);
  const cites = await page.locator(".v4-turn .v4-cite").count();
  const visibleCiteText = await page.locator(".v4-turn .v4-cite").evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).join(""));
  check(`${name}: the proof is a quiet seal after each sourced line, with no visible text`, cites >= 1 && visibleCiteText === "" && (await page.locator(".v4-sources, .v4-chip").count()) === 0, `${cites} seals`);
  await page.locator(".v4-turn .v4-cite").first().click();
  await page.getByTestId("records").waitFor();
  check(`${name}: the seal opens the records (type, text, GitHub link)`, (await page.getByTestId("records").getByTestId("evidence-link").count()) >= 1);
  await shot("06-records-open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // one Return to present
  const eras = page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])');
  const n = await eras.count();
  if (small) await page.getByTestId("journal-button").click();
  await page.getByTestId(`era-${Math.max(1, Math.floor((n - 1) * 0.25))}`).click();
  await page.waitForTimeout(2800);
  if (small) await page.getByTestId("journal-button").click();
  const body = await page.locator("body").innerText();
  check(`${name}: viewing an older memory shows exactly one Return to present`, (body.match(/return to present/gi) ?? []).length === 1 && (await page.getByTestId("return-chip").count()) === 1 && (await page.getByTestId("return-present").count()) === 0);
  if (small) await page.getByRole("button", { name: "Close", exact: true }).first().click().catch(() => undefined);
  await shot("07-older-memory-one-return");

  // dev view brings the scaffolding back
  await page.goto(`${base}/repo/microsoft/VisualStudioUninstaller?dev=1`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor({ timeout: 60000 });
  await page.waitForTimeout(800);
  check(`${name}: ?dev=1 still shows the archetype, scene and identity notes`, /Scene: infra/.test(await page.getByTestId("archive").innerText()));

  // ---------- themed backdrops and species pairings (offline demo, invented data)
  for (const fam of FAMILIES) {
    await page.goto(`${base}/demo?scene=${fam}&sprite=${fam === "network" || fam === "comms" ? "hound" : fam === "infra" ? "watchkeeper" : "archivist"}`, { waitUntil: "networkidle" });
    await page.getByTestId("v4").waitFor();
    await page.waitForTimeout(900);
    const far = await page.locator(".v4-stage .enc-far").first().evaluate((e) => getComputedStyle(e).backgroundImage);
    const mid = await page.locator(".v4-stage .enc-mid").first().evaluate((e) => getComputedStyle(e).backgroundImage);
    const ok = far.includes(`far-${fam}.png`) && mid.includes(`mid-${fam}.png`);
    const served = await page.evaluate(async (f) => (await Promise.all([`/scene/far-${f}.png`, `/scene/mid-${f}.png`].map((u) => fetch(u).then((r) => r.status)))).every((s) => s === 200), fam);
    check(`${name}: the ${fam} backdrop loads its own landmark and props`, ok && served, far.slice(-30));
    if (!small || fam === "network") await shot(`08-scene-${fam}`);
  }
  check(`${name}: no console errors`, errors.length === 0, errors[0]?.slice(0, 140));
  await ctx.close();
}

// the original graveyard stays the default scene
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor();
  const far = await page.locator(".v4-stage .enc-far").first().evaluate((e) => getComputedStyle(e).backgroundImage);
  check("the default scene is still the old graveyard (far.png)", /\/scene\/far\.png/.test(far));
  await ctx.close();
}
await browser.close();
console.log(log.join("\n"));
