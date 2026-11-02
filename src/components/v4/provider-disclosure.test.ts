import { describe, expect, it } from "vitest";
import type { GroundedAnswer } from "@/domain/chat";
import { toAskResult } from "./ask";

const answer = (provider: "mock" | "bedrock"): GroundedAnswer => ({
  segments: [
    { kind: "ghost", text: "The lamp.", citations: [] },
    { kind: "verified", text: "Archived.", citations: [{ id: "E1", ref: "E1", kind: "repo-metadata", label: "Repository record", url: "https://github.com/acme/ghostly", excerpt: "archived: true" } as never] },
  ],
  sources: [{ id: "E1", ref: "E1", kind: "repo-metadata", label: "Repository record", url: "https://github.com/acme/ghostly", excerpt: "archived: true" } as never],
  intent: "history", form: "current", stage: "distorted", voice: "horror", provider, scripted: provider === "mock", gaps: [], identityStatus: "persisted",
} as GroundedAnswer);

describe("the dialogue keeps the server's statement of who wrote the reply", () => {
  it("carries bedrock as bedrock and mock as mock, never one for the other", () => {
    expect(toAskResult(answer("bedrock"), 3).reply.provider).toBe("bedrock");
    expect(toAskResult(answer("mock"), 3).reply.provider).toBe("mock");
  });
  it("maps segment kinds and keeps the evidence tied to the era it was read for", () => {
    const r = toAskResult(answer("bedrock"), 3);
    expect(r.reply.segments.map((s) => s.kind)).toEqual(["ghost", "record"]);
    expect(r.evidence[0]).toMatchObject({ id: "E1", since: 3, source: "answer", url: "https://github.com/acme/ghostly" });
  });
});
