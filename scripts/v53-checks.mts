/**
 * NOTE (V6.1): the landing-page assertions in this script describe the V5.3/V5.4 landing, which showed named, drawn ghosts.
 * Since V6.1 the landing shows unrevealed presences instead; use scripts/v61-checks.mts for the landing. The encounter,
 * scene and sound checks below still apply.
 *
 * V5.3 browser checks: the landing graveyard, sound controls, the quieter encounter, and the three ghost bodies.
 *   node scripts/v53-checks.mts <base> <outDir>
 * Uses the installed Chrome (playwright-core). No network beyond the given base URL. No audio is heard: the checks
 * observe Web Audio through a recording stand-in injected before the page loads.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";

const [base = "http://127.0.0.1:3100", outDir = "docs/screenshots/v5-3/final"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const log: string[] = [];
const check = (name: string, ok: boolean, extra = "") => log.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` (${extra})` : ""}`);

/** Replace AudioContext with a counter so the checks can see what would have been played. */
const AUDIO_SPY = `
  window.__audio = { contexts: 0, oscillators: 0, noise: 0 };
  const node = () => new Proxy(function(){}, { get: (t, k) => k === "connect" ? (n) => n : (k === "value" ? 0 : node()), set: () => true, apply: () => node() });
  window.AudioContext = class { constructor(){ window.__audio.contexts++; this.state = "running"; this.currentTime = 0; this.sampleRate = 8000; this.destination = {}; }
    resume(){ return Promise.resolve(); } createGain(){ return node(); } createBiquadFilter(){ return node(); }
    createOscillator(){ window.__audio.oscillators++; return node(); } createBufferSource(){ window.__audio.noise++; return node(); }
    createBuffer(c, len){ return { getChannelData: () => new Float32Array(len) }; } };
`;

const overflowX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
  const page = await ctx.newPage();
  await page.addInitScript(AUDIO_SPY);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

  // ---- landing
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(outDir, `01-landing-${name}.png`) });
  const spirits = page.locator(".spirit");
  check(`${name}: the landing shows six presences, not cards`, (await spirits.count()) === 6 && (await page.locator(".grave-card, .marker").count()) === 0);
  check(`${name}: each presence names its repository and keeps a Summon action and a GitHub link`, await page.evaluate(() => [...document.querySelectorAll(".spirit")].every((s) => /\//.test(s.querySelector(".spirit-name")!.textContent ?? "") && s.querySelector('a[aria-label^="Summon "]') && s.querySelector('a[aria-label$="on GitHub (opens in a new tab)"][rel~="noopener"]'))));
  check(`${name}: the page does not scroll sideways`, await overflowX(page));
  check(`${name}: nothing plays before the player asks`, await page.evaluate(() => (window as unknown as { __audio: { contexts: number } }).__audio.contexts === 0));
  const toggle = page.getByTestId("sound-toggle");
  check(`${name}: the sound toggle starts off and says so`, (await toggle.getAttribute("aria-pressed")) === "false" && /off/i.test(await toggle.innerText()));
  const tb = await toggle.boundingBox();
  check(`${name}: the toggle is at least 44px tall`, !!tb && tb.height >= 44, `${tb?.height}`);
  if (!small) {
    await spirits.first().hover();
    await page.waitForTimeout(500);
    const opacity = await spirits.first().locator(".spirit-detail").evaluate((e) => getComputedStyle(e).opacity);
    check(`${name}: moving toward a presence reveals what is known and the Summon action`, opacity === "1", `opacity ${opacity}`);
    await page.screenshot({ path: join(outDir, `02-landing-hover-${name}.png`) });
    await page.mouse.move(5, 500);
    await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
    // keyboard: tab until a Summon link inside a presence is focused, then its detail must be visible
    for (let i = 0; i < 12; i++) { const inSpirit = await page.evaluate(() => !!document.activeElement?.closest(".spirit")); if (inSpirit) break; await page.keyboard.press("Tab"); }
    const kb = await page.evaluate(() => { const s = document.activeElement?.closest(".spirit"); return s ? getComputedStyle(s.querySelector(".spirit-detail")!).opacity : "none"; });
    check(`${name}: keyboard focus reveals the same detail`, kb === "1", `opacity ${kb}`);
  } else {
    check(`${name}: on a phone every presence shows its detail without hover`, await page.evaluate(() => [...document.querySelectorAll(".spirit-detail")].every((d) => getComputedStyle(d).opacity === "1")));
    check(`${name}: the sound toggle does not cover the title`, await page.evaluate(() => { const t = document.querySelector<HTMLElement>("[data-testid=sound-toggle]")!.getBoundingClientRect(); const h = document.querySelector<HTMLElement>(".landing-title")!.getBoundingClientRect(); return t.bottom <= h.top + 2 || t.top >= h.bottom || t.left >= h.right || t.right <= h.left; }));
  }
  // sound on: the toggle is a gesture, so a context is created and the ambient bed starts
  await toggle.click();
  await page.waitForTimeout(400);
  const a1 = await page.evaluate(() => (window as unknown as { __audio: { contexts: number; noise: number; oscillators: number } }).__audio);
  check(`${name}: turning sound on starts the ambient bed (wind and drone) and a confirmation blip`, (await toggle.getAttribute("aria-pressed")) === "true" && a1.contexts === 1 && a1.noise >= 1 && a1.oscillators >= 3, JSON.stringify(a1));
  await page.screenshot({ path: join(outDir, `03-sound-on-${name}.png`) });
  const remembered = await page.evaluate(() => localStorage.getItem("gitghost.sound"));
  check(`${name}: the choice is remembered`, remembered === "on");
  await toggle.click();
  check(`${name}: turning it off is one click`, (await toggle.getAttribute("aria-pressed")) === "false" && (await page.evaluate(() => localStorage.getItem("gitghost.sound"))) === "off");
  const before = await page.evaluate(() => (window as unknown as { __audio: { oscillators: number } }).__audio.oscillators);
  if (!small) await spirits.nth(1).hover();
  const after = await page.evaluate(() => (window as unknown as { __audio: { oscillators: number } }).__audio.oscillators);
  check(`${name}: when muted, hovering makes no sound`, after === before);
  check(`${name}: no console errors on the landing`, errors.length === 0, errors[0]?.slice(0, 120));

  // ---- reduced motion: the presences hold still
  const rm = await browser.newContext({ viewport: vp, reducedMotion: "reduce" });
  const rmPage = await rm.newPage();
  await rmPage.goto(base + "/", { waitUntil: "networkidle" });
  check(`${name}: reduced motion stops the drifting, the flicker and the mist`, await rmPage.evaluate(() => [".spirit-drift", ".spirit-face", ".landing-title", ".landing-mist-a"].every((s) => getComputedStyle(document.querySelector(s)!).animationName === "none")));
  await rm.close();

  // ---- the encounter: ghost bodies and the quiet dialogue
  for (const kind of ["archivist", "watchkeeper", "hound"]) {
    await page.goto(`${base}/demo?sprite=${kind}`, { waitUntil: "networkidle" });
    await page.getByTestId("v4").waitFor();
    await page.waitForTimeout(1200);
    const bg = await page.locator(".v4-ghost .v4g-layer").first().evaluate((e) => getComputedStyle(e).backgroundImage);
    const m = /\/sprites\/v4\/(atlas-[a-z-]+\.png)/.exec(bg)?.[1] ?? "";
    check(`${name}: /demo?sprite=${kind} draws the ${kind}`, kind === "archivist" ? /^atlas-(human|distorted|horror)\.png$/.test(m) : m.startsWith(`atlas-${kind}-`), m);
    const loaded = await page.evaluate(async (u) => (await fetch(u)).status, `/sprites/v4/${m}`);
    check(`${name}: the ${kind} atlas is served`, loaded === 200);
    if (kind !== "archivist") await page.screenshot({ path: join(outDir, `04-${kind}-human-${name}.png`) });
  }
  await ctx.close();
}

// ---- one transformation per body, on the desktop prototype tools page is not needed: use the journal on a live repo
for (const [name, vp] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } })) {
  const small = name === "mobile";
  const ctx = await browser.newContext({ viewport: vp, isMobile: small, hasTouch: small });
  const page = await ctx.newPage();
  await page.goto(`${base}/repo/microsoft/VisualStudioUninstaller`, { waitUntil: "networkidle" });
  await page.getByTestId("v4").waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, `05-encounter-${name}.png`) });
  const eras = page.locator('[data-testid^="era-"]:not([data-testid="era-chip"])');
  const n = await eras.count();
  if (small) await page.getByTestId("journal-button").click();
  await page.getByTestId(`era-${Math.max(1, Math.floor((n - 1) * 0.25))}`).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `06-transforming-${name}.png`) });
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(outDir, `07-memory-human-${name}.png`) });
  check(`${name}: choosing an earlier memory returns the human form`, (await page.getByTestId("v4").getAttribute("data-form")) === "human");
  await ctx.close();
}

await browser.close();
console.log(log.join("\n"));
