import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CodeRecordBody } from "./CodeRecordBody";
import { mockGameData } from "./mock-data";
import { askSpecialist, modelLabel, type CodeRecord } from "./specialist";

const SHA = "e".repeat(40);
const record: CodeRecord = {
  findings: {
    summary: "Rebuilds an editor from saved state, or returns null when it cannot.",
    observations: [{ path: "src/text-editor.js", text: "Returns null when the saved version is not `SERIALIZATION_VERSION`.", from: 104, to: 104, url: `https://github.com/atom/atom/blob/${SHA}/src/text-editor.js#L104-L104` }],
    uncertainties: ["What bufferForIdSync does is not shown."],
    followUps: ["Where is deserialize called?"],
  },
  framing: ["Someone looked so closely at me."],
  model: "us.anthropic.claude-sonnet-5-5",
  commit: { sha: SHA, shortSha: SHA.slice(0, 7), date: "2026-10-01T00:00:00.000Z" },
  path: "src/text-editor.js",
  dropped: 1,
};

describe("the Code Record", () => {
  const html = renderToStaticMarkup(<CodeRecordBody record={record} busy={false} onFollowUp={() => undefined} />);
  it("says it is AI-written, by which model, checked against the code, at which commit", () => {
    expect(html).toMatch(/AI<\/span>Written by Claude Sonnet 5\.5, checked against the code/);
    expect(html).toContain("eeeeeee");
  });
  it("links every observation to its exact lines at the exact commit, and opens in a new tab", () => {
    expect(html).toContain(`href="https://github.com/atom/atom/blob/${SHA}/src/text-editor.js#L104-L104"`);
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("shows uncertainty as uncertain, admits what was left out, and offers the follow-ups as questions", () => {
    expect(html).toContain("Not certain");
    expect(html).toContain("1 more observation was left out");
    expect(html).toMatch(/<button[^>]*>Where is deserialize called\?<\/button>/);
  });
});

describe("asking the Specialist from the page", () => {
  it("sends the exact commit and lines, and reads the answer", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, answer: record })));
    const r = await askSpecialist({ owner: "atom", repo: "atom", path: "src/text-editor.js", at: SHA, from: 103, to: 135 }, f as unknown as typeof fetch);
    expect(r).toEqual({ ok: true, record });
    expect(JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ owner: "atom", repo: "atom", path: "src/text-editor.js", at: SHA, from: 103, to: 135 });
  });
  it("turns failures, including a lost connection, into a plain message", async () => {
    const off = vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "specialist_disabled", message: "The Specialist cannot be reached right now." }), { status: 503 }));
    expect(await askSpecialist({ owner: "a", repo: "b", path: "x.js", at: SHA }, off as unknown as typeof fetch)).toEqual({ ok: false, code: "specialist_disabled", message: "The Specialist cannot be reached right now." });
    const down = vi.fn(async () => { throw new TypeError("offline"); });
    expect((await askSpecialist({ owner: "a", repo: "b", path: "x.js", at: SHA }, down as unknown as typeof fetch)).ok).toBe(false);
  });
  it("names models readably", () => {
    expect(modelLabel("us.anthropic.claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
    expect(modelLabel("us.anthropic.claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(modelLabel("anthropic.claude-haiku-4-5-20251001-v1:0")).toBe("Claude Haiku 4.5");
    expect(modelLabel("amazon.nova-lite-v1:0")).toBe("Amazon Nova Lite");
  });
  it("the offline demo never offers it (its repository has no real commit to read)", () => {
    expect(mockGameData().specialist).toBe(false);
  });
});
