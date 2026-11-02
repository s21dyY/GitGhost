import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CodeOutline, CodeSymbol } from "@/domain/code";
import { approximateOutline, MAX_SYMBOLS, nest } from "@/domain/outline";
import { cleanUntrustedText } from "@/server/github/summon";

/**
 * A file's outline (its functions, classes, methods…), for every language GitGhost may meet.
 *
 *   extension ─▶ grammar? ─ yes ─▶ tree-sitter parse ─▶ one generic declaration walker ─▶ exact outline
 *                         └─ no ──▶ indentation and keywords (domain/outline.ts)        ─▶ approximate outline
 *
 * One walker serves all 33 grammars: it keeps any named node whose type reads like a declaration
 * ("function_declaration", "class_definition", "impl_item", "method", …), plus a few shapes that are not
 * spelled that way (JavaScript arrow functions held in a variable, CSS rules). Adding a language is one line in
 * GRAMMAR. Grammars load on first use and stay loaded; every syntax tree is freed after use, since WebAssembly
 * memory is not garbage-collected. Parsing is server-side only: the grammars are about 49 MB together.
 */

/** File extension → tree-sitter-wasms grammar. Elm, CodeQL and YAML grammars do not load with this runtime. */
const GRAMMAR: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript", ts: "typescript", mts: "typescript", cts: "typescript", tsx: "tsx",
  py: "python", go: "go", rs: "rust", java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", swift: "swift", dart: "dart",
  c: "c", h: "c", cc: "cpp", cpp: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", cs: "c_sharp", m: "objc", mm: "objc",
  rb: "ruby", php: "php", lua: "lua", ex: "elixir", exs: "elixir", ml: "ocaml", el: "elisp", zig: "zig", sol: "solidity",
  sh: "bash", bash: "bash", css: "css", vue: "vue", res: "rescript",
};
/** Files with nothing worth mapping. */
const NOTHING = /\.(json|lock|txt|csv|tsv|svg|xml|html?|md|rst|ini|cfg|conf|env|toml|yml|yaml)$/i;

export const extOf = (path: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? "";

// ---------------------------------------------------------------- the runtime, loaded once
type TS = typeof import("web-tree-sitter");
type Lang = import("web-tree-sitter").Language;
type Node = import("web-tree-sitter").Node;
let runtime: Promise<TS> | null = null;
const languages = new Map<string, Promise<Lang | null>>();
const fromRoot = createRequire(join(process.cwd(), "package.json"));

function loadRuntime(): Promise<TS> {
  return (runtime ??= import("web-tree-sitter").then(async (ts) => {
    await ts.Parser.init();
    return ts;
  }));
}
function loadLanguage(name: string): Promise<Lang | null> {
  let p = languages.get(name);
  if (!p) {
    p = loadRuntime()
      .then((ts) => ts.Language.load(join(dirname(fromRoot.resolve("tree-sitter-wasms/package.json")), "out", `tree-sitter-${name}.wasm`)))
      .catch(() => null); // a grammar that will not load: the file gets the approximate outline instead
    languages.set(name, p);
  }
  return p;
}

// ---------------------------------------------------------------- the generic walker
const DECL = /^(function|generator_function|method|class|abstract_class|struct|interface|enum|trait|protocol|object|module|namespace|impl|type_alias|record|constructor|singleton_method|mod|protocol|extension)(_(declaration|definition|item|specifier|spec))?$/;
const ALSO = new Set(["method_definition", "function_item", "type_spec", "rule_set", "function_signature_item"]);
const FN_VALUE = /^(arrow_function|function|function_expression|generator_function)$/;
const NAME_NODE = /^(identifier|type_identifier|property_identifier|field_identifier|constant|name|simple_identifier|word|private_property_identifier)$/;

/** The kind from the node type's leading word ("constructor_declaration" is a method, not a "struct"). */
function kindOf(type: string): CodeSymbol["kind"] {
  if (type === "rule_set") return "rule";
  const head = type.replace(/_(declaration|definition|item|specifier|spec|signature_item)$/, "");
  if (/^(method|constructor|singleton_method)$/.test(head)) return "method";
  if (/^(class|abstract_class|struct|record|object|impl)$/.test(head)) return "class";
  if (/^(interface|trait|protocol|enum|type_alias|type|extension)$/.test(head)) return "type";
  if (/^(module|namespace|mod)$/.test(head)) return "module";
  return "function";
}

/** A node's named children (the runtime's list may hold nulls). */
const kids = (n: Node): Node[] => n.namedChildren.filter((c): c is Node => c !== null);

/** A declaration's name: its `name` field, or through C-style declarators, or its first identifier. */
function nameOf(n: Node): string | null {
  if (n.type === "rule_set") return kids(n)[0]?.text.replace(/\s+/g, " ") ?? null;
  if (n.type === "impl_item") {
    const t = n.childForFieldName("type")?.text, tr = n.childForFieldName("trait")?.text;
    return t ? (tr ? `${tr} for ${t}` : t) : null;
  }
  const named = n.childForFieldName("name");
  if (named) return named.text;
  let d: Node | null = n.childForFieldName("declarator");
  for (let i = 0; d && i < 8; i++) {
    if (NAME_NODE.test(d.type)) return d.text;
    d = d.childForFieldName("declarator") ?? d.childForFieldName("name") ?? kids(d).find((c) => NAME_NODE.test(c.type)) ?? null;
  }
  return kids(n).find((c) => NAME_NODE.test(c.type))?.text ?? null;
}

function collect(root: Node): CodeSymbol[] {
  const out: CodeSymbol[] = [];
  const push = (n: Node, name: string | null, kind: CodeSymbol["kind"]) => {
    const clean = name ? cleanUntrustedText(name).replace(/\s+/g, " ").trim().slice(0, 80) : null;
    if (clean && out.length < MAX_SYMBOLS) out.push({ name: clean, kind, from: n.startPosition.row + 1, to: n.endPosition.row + 1, depth: 0 });
  };
  // `inFn`: inside a function body, small helpers held in variables are not part of the map
  const walk = (n: Node, inFn: boolean) => {
    if (out.length >= MAX_SYMBOLS) return;
    let isFn = false;
    if (DECL.test(n.type) || ALSO.has(n.type)) {
      const kind = kindOf(n.type);
      push(n, nameOf(n), kind);
      isFn = kind === "function" || kind === "method";
    } else if (!inFn && /^(variable_declarator|public_field_definition|field_definition)$/.test(n.type)) {
      const value = n.childForFieldName("value");
      if (value && FN_VALUE.test(value.type)) {
        push(n, nameOf(n), n.type === "variable_declarator" ? "function" : "method");
        isFn = true;
      }
    }
    for (const c of kids(n)) walk(c, inFn || isFn);
  };
  walk(root, false);
  return out.sort((a, b) => a.from - b.from || b.to - a.to);
}

/** The outline of one file. Never throws: a file that cannot be parsed gets the approximate outline. */
export async function outlineFor(path: string, text: string): Promise<CodeOutline> {
  const ext = extOf(path);
  const lines = text.split("\n");
  if (NOTHING.test(path)) return { method: "none", language: null, symbols: [] };
  const grammar = GRAMMAR[ext];
  if (!grammar || lines.length > 50_000) return approximateOutline(lines, ext, grammar ?? null);
  const lang = await loadLanguage(grammar);
  if (!lang) return approximateOutline(lines, ext, grammar);
  const ts = await loadRuntime();
  const parser = new ts.Parser();
  try {
    parser.setLanguage(lang);
    const tree = parser.parse(text);
    if (!tree) return approximateOutline(lines, ext, grammar);
    try {
      const symbols = collect(tree.rootNode);
      nest(symbols);
      return { method: symbols.length ? "parsed" : "none", language: grammar, symbols };
    } finally {
      tree.delete();
    }
  } catch {
    return approximateOutline(lines, ext, grammar);
  } finally {
    parser.delete();
  }
}
