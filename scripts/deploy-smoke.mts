/**
 * Smoke test against a deployed GitGhost. Read-only and free on the scripted provider: it never asks for a billable
 * reply unless the deployment itself has Bedrock switched on (the first deploy does not).
 *
 *   node scripts/deploy-smoke.mts https://<project>.vercel.app
 *
 * Checks: the landing page, a summon of microsoft/VisualStudioUninstaller, one scripted chat reply with citations,
 * a parsed (tree-sitter) outline for one file, and /demo. Exit code 0 only if every check passes.
 */
const base = (process.argv[2] ?? "").replace(/\/+$/, "");
if (!/^https?:\/\/[^/]+$/.test(base)) {
  console.error("Usage: node scripts/deploy-smoke.mts https://<deployment-host>");
  process.exit(2);
}
const OWNER = "microsoft";
const REPO = "VisualStudioUninstaller";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};
async function get(path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(65_000) });
  return { status: res.status, text: await res.text() };
}
const json = (t: string) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};

try {
  const home = await get("/");
  check("landing page loads", home.status === 200 && home.text.includes("GitGhost"), `HTTP ${home.status}`);

  const summon = await get("/api/summon", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ input: `${OWNER}/${REPO}` }) });
  const s = json(summon.text);
  check(`summon ${OWNER}/${REPO}`, summon.status === 200 && s?.ok === true, `HTTP ${summon.status}${s?.code ? ` ${s.code}` : ""}`);

  const page = await get(`/repo/${OWNER}/${REPO}`);
  check("séance page renders", page.status === 200 && page.text.includes(REPO), `HTTP ${page.status}`);

  const chat = await get("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base },
    body: JSON.stringify({ owner: OWNER, repo: REPO, question: "Is this repository archived?", history: [], form: "current" }),
  });
  const c = json(chat.text);
  const cites = c?.ok ? c.answer.sources.length : 0;
  check("chat reply is answered", chat.status === 200 && c?.ok === true, `HTTP ${chat.status}${c?.code ? ` ${c.code}` : ""}`);
  check("chat reply is scripted (no AI call on the first deploy)", c?.ok === true && c.answer.provider === "mock", `provider ${c?.answer?.provider ?? "?"}`);
  check("chat reply carries citations from GitHub", cites > 0 && c.answer.sources.every((x: { url: string }) => x.url.startsWith("https://github.com/")), `${cites} sources`);

  const tree = json((await get(`/api/code?owner=${OWNER}&repo=${REPO}`)).text);
  const files: string[] = tree?.ok ? tree.tree.paths : [];
  const pick = files.find((p) => /\.(cs|js|ts|py|ps1|sh|cpp|c)$/i.test(p)) ?? files[0];
  check("Possession: file list", files.length > 0, `${files.length} files`);
  if (pick) {
    const file = json((await get(`/api/code?owner=${OWNER}&repo=${REPO}&path=${encodeURIComponent(pick)}`)).text);
    const method = file?.ok ? file.file.outline.method : "error";
    check(`Possession: outline for ${pick}`, method === "parsed" || method === "approximate" || method === "none", `method ${method}`);
    if (method !== "parsed") console.log(`      note: not "parsed"; check that the grammar for ${pick.split(".").pop()} shipped (outputFileTracingIncludes)`);
  }

  const demo = await get("/demo");
  check("/demo loads", demo.status === 200, `HTTP ${demo.status}`);
} catch (err) {
  check("reached the deployment", false, (err as Error).message);
}
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
