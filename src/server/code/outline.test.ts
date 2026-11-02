import { describe, expect, it } from "vitest";
import { symbolPath } from "@/domain/outline";
import { outlineFor } from "./outline";

const map = async (path: string, text: string) => {
  const o = await outlineFor(path, text);
  return { method: o.method, symbols: o.symbols.map((s) => `${"  ".repeat(s.depth)}${s.kind} ${s.name} ${s.from}-${s.to}`) };
};

describe("outlines from real parsers (tree-sitter), one generic walker for every grammar", () => {
  it("JavaScript: classes, methods, functions, arrow functions in variables (not helpers inside functions)", async () => {
    const js = [
      "class TextEditor {",            // 1
      "  static deserialize(state) {", // 2
      "    const helper = () => 1;",   // 3
      "    return helper();",          // 4
      "  }",                           // 5
      "  handler = () => {}",          // 6
      "}",                             // 7
      "function open(path) { return path }", // 8
      "export const close = async (x) => x;", // 9
    ].join("\n");
    expect(await map("src/a.js", js)).toEqual({ method: "parsed", symbols: [
      "class TextEditor 1-7", "  method deserialize 2-5", "  method handler 6-6", "function open 8-8", "function close 9-9",
    ] });
  });
  it("TypeScript: interfaces, type aliases, classes and methods", async () => {
    const ts = ["interface Ghost { name: string }", "type Form = 'human' | 'horror';", "export class Archive {", "  read(): void {}", "}"].join("\n");
    expect((await map("a.ts", ts)).symbols).toEqual(["type Ghost 1-1", "type Form 2-2", "class Archive 3-5", "  method read 4-4"]);
  });
  it("Python: classes, methods, nested functions", async () => {
    const py = ["class Lantern:", "    def light(self):", "        def inner():", "            pass", "        return inner", "", "def main():", "    pass"].join("\n");
    expect((await map("x.py", py)).symbols).toEqual(["class Lantern 1-5", "  method light 2-5", "    function inner 3-4", "function main 7-8"]);
  });
  it("Go: types, functions and methods", async () => {
    const go = ["package main", "", "type Grave struct { name string }", "", "func (g *Grave) Rest() {}", "", "func main() {}"].join("\n");
    expect((await map("main.go", go)).symbols).toEqual(["type Grave 3-3", "method Rest 5-5", "function main 7-7"]);
  });
  it("Rust: structs, traits, impl blocks and their functions", async () => {
    const rs = ["struct Ghost;", "trait Haunt { fn haunt(&self); }", "impl Haunt for Ghost {", "    fn haunt(&self) {}", "}", "fn main() {}"].join("\n");
    const s = (await map("lib.rs", rs)).symbols;
    expect(s).toContain("class Ghost 1-1");
    expect(s).toContain("class Haunt for Ghost 3-5");
    expect(s).toContain("  method haunt 4-4");
    expect(s).toContain("function main 6-6");
  });
  it("C: functions through pointer declarators", async () => {
    const c = ["#include <stdio.h>", "static char *name_of(int id) {", "  return 0;", "}", "int main(void) { return 0; }"].join("\n");
    expect((await map("main.c", c)).symbols).toEqual(["function name_of 2-4", "function main 5-5"]);
  });
  it("Java and Ruby", async () => {
    expect((await map("A.java", "class A {\n  A() {}\n  void run() {}\n}")).symbols).toEqual(["class A 1-4", "  method A 2-2", "  method run 3-3"]);
    expect((await map("a.rb", "module Crypt\n  class Bone\n    def rattle\n    end\n  end\nend")).symbols).toEqual(["module Crypt 1-6", "  class Bone 2-5", "    method rattle 3-4"]);
  });
  it("CSS: rules", async () => {
    expect((await map("a.css", ".grave { color: red }\nh1, h2 {\n  margin: 0;\n}")).symbols).toEqual(["rule .grave 1-1", "rule h1, h2 2-4"]);
  });
  it("finds which declaration a line belongs to", async () => {
    const o = await outlineFor("src/a.js", "class TextEditor {\n  static deserialize(state) {\n    return state;\n  }\n}");
    expect(symbolPath(o.symbols, 3)).toBe("TextEditor › deserialize");
    expect(symbolPath(o.symbols, 1, 5)).toBe("TextEditor");
  });
});

describe("files without a grammar get an approximate outline; data files get none", () => {
  it("CoffeeScript (Atom has many) by indentation and arrows", async () => {
    const coffee = ["module.exports =", "class Pane", "  constructor: (params) ->", "    @items = []", "", "  activate: ->", "    @focus()", "", "helper = (x) => x"].join("\n");
    const o = await map("src/pane.coffee", coffee);
    expect(o.method).toBe("approximate");
    expect(o.symbols).toEqual(["class Pane 2-7", "  method constructor 3-4", "  method activate 6-7", "function helper 9-9"]);
  });
  it("Less stylesheets by top-level rules", async () => {
    const o = await map("static/a.less", "@import 'x';\n.tab-bar {\n  .tab { color: red; }\n}\n.pane {\n}");
    expect(o).toEqual({ method: "approximate", symbols: ["rule .tab-bar 2-4", "rule .pane 5-6"] });
  });
  it("JSON, Markdown and lockfiles have nothing to map", async () => {
    for (const p of ["package.json", "README.md", "yarn.lock"]) expect((await outlineFor(p, '{"a": 1}')).method).toBe("none");
  });
  it("never throws on broken code", async () => {
    const o = await outlineFor("bad.js", "class { ((( function");
    expect(["parsed", "none"]).toContain(o.method);
  });
});
