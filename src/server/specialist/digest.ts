/**
 * The codebase at a glance, without reading it: from the file list alone, which folders hold how many files, which
 * languages they are written in, and a few examples of each. No model is involved; the Specialist is given this map
 * (with the README and a manifest) to introduce the codebase, and the same map frames every later file it explains.
 */
export type Digest = { text: string; files: Set<string>; dirs: Set<string> };

const LANG: Record<string, string> = {
  js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript", ts: "TypeScript", tsx: "TypeScript", coffee: "CoffeeScript",
  py: "Python", rb: "Ruby", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", scala: "Scala", swift: "Swift", m: "Objective-C",
  c: "C", h: "C/C++ header", cc: "C++", cpp: "C++", hpp: "C++", cs: "C#", php: "PHP", lua: "Lua", ex: "Elixir", exs: "Elixir",
  erl: "Erlang", hs: "Haskell", clj: "Clojure", dart: "Dart", sh: "Shell", vue: "Vue", svelte: "Svelte", elm: "Elm",
  css: "CSS", scss: "SCSS", less: "Less", html: "HTML", md: "Markdown", json: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML",
};
/** Manifests that say what a project is, in the order they are worth reading. */
export const MANIFESTS = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "setup.py", "pom.xml", "build.gradle", "Gemfile", "composer.json", "mix.exs", "CMakeLists.txt"];

const TOP_DIRS = 12, SUB_DIRS = 6, EXAMPLES = 4;
const ext = (p: string) => (p.includes(".") ? p.slice(p.lastIndexOf(".") + 1).toLowerCase() : "");
const count = <K>(keys: K[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>())].sort((a, b) => b[1] - a[1]);

export function digestTree(paths: readonly string[], truncated: boolean): Digest {
  const files = new Set(paths);
  const dirs = new Set<string>();
  for (const p of paths) for (let i = p.indexOf("/"); i > 0; i = p.indexOf("/", i + 1)) dirs.add(p.slice(0, i));
  const langs = count(paths.map((p) => LANG[ext(p)]).filter(Boolean));
  const rootFiles = paths.filter((p) => !p.includes("/"));
  const lines = [
    `Files listed: ${paths.length}${truncated ? " (the list was cut short: a very large repository)" : ""}.`,
    `Languages by file count: ${langs.slice(0, 6).map(([l, n]) => `${l} ${n}`).join(", ") || "none recognised"}.`,
    `Top-level files: ${rootFiles.slice(0, 15).join(", ") || "none"}.`,
    "Folders (files inside, the largest first):",
  ];
  for (const [top, n] of count(paths.filter((p) => p.includes("/")).map((p) => p.slice(0, p.indexOf("/")))).slice(0, TOP_DIRS)) {
    const inside = paths.filter((p) => p.startsWith(`${top}/`));
    const subs = count(inside.map((p) => p.slice(top.length + 1)).filter((p) => p.includes("/")).map((p) => p.slice(0, p.indexOf("/"))))
      .slice(0, SUB_DIRS).map(([s, k]) => `${top}/${s}/ (${k})`);
    const examples = inside.filter((p) => !p.slice(top.length + 1).includes("/")).slice(0, EXAMPLES);
    lines.push(`- ${top}/ (${n})${subs.length ? `; folders: ${subs.join(", ")}` : ""}${examples.length ? `; e.g. ${examples.join(", ")}` : ""}`);
  }
  return { text: lines.join("\n"), files, dirs };
}
