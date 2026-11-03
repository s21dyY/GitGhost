import { describe, expect, it } from "vitest";
import { classifyTurn } from "@/server/chat/conversation";
import { classifyIntent, detectFileRef } from "@/server/evidence/intent";
import { askable, codeQuestions, codeSource, rankPaths } from "./code";
import { mockGameData } from "./mock-data";

describe("Possession: the ghost's code", () => {
  it("lists code folders first, then other files, then docs, then dotfiles; shallow before deep", () => {
    expect(rankPaths([".github/workflows/ci.yml", "docs/guide.md", "README.md", "src/deep/inner/x.js", "src/a.js", "index.js"])).toEqual([
      "src/a.js", "src/deep/inner/x.js", "index.js", "README.md", "docs/guide.md", ".github/workflows/ci.yml",
    ]);
  });
  it("only offers questions about files the chat recognises as files", () => {
    expect(askable("src/text-editor.js")).toBe(true);
    expect(askable("static/variables/ui-variables.less")).toBe(true);
    expect(askable("menus/darwin.cson")).toBe(false);
    expect(askable("Makefile")).toBe(false);
  });
  it("every question names the file and lines and is answered as a factual file question (cited, not fiction)", () => {
    for (const lines of [null, { from: 42, to: 42 }, { from: 120, to: 134 }]) {
      for (const q of codeQuestions("src/text-editor.js", lines)) {
        expect(classifyIntent(q.question)).toBe("file");
        expect(classifyTurn(q.question)).toBe("factual");
        expect(detectFileRef(q.question)).toEqual({ path: "src/text-editor.js", ...(lines ? { line: lines.from } : {}), ...(lines && lines.to > lines.from ? { endLine: lines.to } : {}) });
      }
    }
  });
  it("labels the first question by whether lines are chosen", () => {
    expect(codeQuestions("a.js", null)[0].label).toBe("What is this file for?");
    expect(codeQuestions("a.js", { from: 1, to: 3 })[0].label).toBe("What does this part do?");
  });
  it("the offline demo reads its invented files without any network", async () => {
    const src = codeSource(mockGameData());
    const tree = await src.tree(null);
    expect(tree.ok && tree.value.paths).toEqual(["src/notes.js", "src/sync.js", "README.md"]);
    const file = await src.file("src/sync.js", null);
    expect(file.ok && file.value.lines[3]).toMatch(/^export function sync/);
    expect((await src.file("nope.js", null)).ok).toBe(false);
  });
});
