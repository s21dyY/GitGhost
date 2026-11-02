import type { CodeOutline, CodeSymbol } from "./code";

/**
 * Outline helpers shared by the server and the browser. Pure: no parser, no WebAssembly.
 *  - approximateOutline: a map from indentation and keywords, for languages without a tree-sitter grammar.
 *  - enclosing / symbolPath: which declarations contain a line range ("TextEditor › deserialize").
 */
export const MAX_SYMBOLS = 600;

type Rule = { re: RegExp; kind: CodeSymbol["kind"] };
/** Declarations as most languages write them. Group 1 is always the name. */
const RULES: Rule[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:class|struct|interface|trait|protocol|record)\s+([A-Za-z_$][\w$.:]*)/, kind: "class" },
  { re: /^\s*(?:export\s+)?(?:enum|type)\s+([A-Za-z_$][\w$]*)\s*(?:=|\{|$)/, kind: "type" },
  { re: /^\s*(?:module|namespace|package|mod)\s+([A-Za-z_$][\w$.:]*)/, kind: "module" },
  { re: /^\s*(?:export\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:static\s+)?(?:async\s+)?(?:function\*?|def|func|fn|sub|proc|fun)\s+([A-Za-z_$][\w$.!?]*)/, kind: "function" },
  // CoffeeScript and friends: name: (args) -> / name = (args) =>
  { re: /^\s*@?([A-Za-z_$][\w$]*)\s*[:=]\s*(?:\([^)]*\)\s*)?[-=]>/, kind: "function" },
  // JavaScript: const name = (args) => / const name = function
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, kind: "function" },
];
/** Stylesheets (Less, Sass, CSS without a grammar): top-level selectors. */
const STYLE_RULE = /^([^\s@/{}][^{]*?)\s*\{\s*$/;
const isStyle = (ext: string) => /^(css|less|scss|sass|styl)$/i.test(ext);
const indentOf = (line: string) => (/^\s*/.exec(line)?.[0].replace(/\t/g, "  ").length ?? 0);

/** The last line of a block that starts at `start`: its last non-blank line before the indentation returns to its own. */
function blockEnd(lines: readonly string[], start: number): number {
  const base = indentOf(lines[start]);
  let last = start;
  for (let i = start + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    if (indentOf(lines[i]) <= base) return /^\s*(\}|\]|\)|end\b|fi\b|done\b)/.test(lines[i]) ? i : last;
    last = i;
  }
  return last;
}

export function approximateOutline(lines: readonly string[], ext: string, language: string | null = null): CodeOutline {
  const symbols: CodeSymbol[] = [];
  const style = isStyle(ext);
  for (let i = 0; i < lines.length && symbols.length < MAX_SYMBOLS; i++) {
    const line = lines[i];
    if (line.length > 400 || !line.trim()) continue;
    let name: string | null = null, kind: CodeSymbol["kind"] = "function";
    if (style) {
      const m = indentOf(line) === 0 ? STYLE_RULE.exec(line) : null;
      if (m) [name, kind] = [m[1].replace(/\s+/g, " ").slice(0, 80), "rule"];
    } else {
      for (const r of RULES) {
        const m = r.re.exec(line);
        if (m) {
          [name, kind] = [m[1], r.kind];
          break;
        }
      }
    }
    if (!name) continue;
    const to = blockEnd(lines, i);
    symbols.push({ name, kind, from: i + 1, to: Math.max(i + 1, to + 1), depth: 0 });
  }
  nest(symbols);
  return { method: symbols.length ? "approximate" : "none", language, symbols };
}

/** Depth from containment; a function directly inside a class becomes a method. Symbols must be in order of `from`. */
export function nest(symbols: CodeSymbol[]): void {
  const open: CodeSymbol[] = [];
  for (const s of symbols) {
    while (open.length && open[open.length - 1].to < s.from) open.pop();
    s.depth = open.length;
    if (s.kind === "function" && open.at(-1)?.kind === "class") s.kind = "method";
    open.push(s);
  }
}

/** The declarations that contain lines from..to, outermost first. */
export function enclosing(symbols: readonly CodeSymbol[], from: number, to: number = from): CodeSymbol[] {
  return symbols.filter((s) => s.from <= from && to <= s.to).sort((a, b) => a.depth - b.depth || a.from - b.from);
}

/** "TextEditor › deserialize", or null when the lines are at the top level. */
export function symbolPath(symbols: readonly CodeSymbol[], from: number, to: number = from): string | null {
  const chain = enclosing(symbols, from, to);
  return chain.length ? chain.map((s) => s.name).join(" › ") : null;
}
