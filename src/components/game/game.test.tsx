import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DURATION, INITIAL, poseFor, reduce, type AnimEvent, type AnimState, type Machine } from "./anim";
import { ERAS, EVIDENCE, MOCK_REPO, OBSERVED, READINGS, SHORTCUTS, mockReply } from "./fixtures";
import { mockGameData } from "./mock-data";
import { Game } from "./Game";

const run = (events: AnimEvent[], from: Machine = INITIAL) => events.reduce(reduce, from);

describe("ghost animation state machine", () => {
  it("starts idle and maps every state to an authored sprite pose", () => {
    expect(INITIAL.state).toBe("idle");
    const states: AnimState[] = ["idle", "listening", "speaking", "disturbed", "transforming", "stabilizing"];
    for (const s of states) expect(["idle", "thinking", "speaking", "blink"]).toContain(poseFor(s));
  });
  it("walks listen -> speak -> done back to idle", () => {
    expect(run([{ type: "LISTEN" }]).state).toBe("listening");
    expect(run([{ type: "LISTEN" }, { type: "SPEAK" }]).state).toBe("speaking");
    expect(run([{ type: "LISTEN" }, { type: "SPEAK" }, { type: "DONE" }]).state).toBe("idle");
  });
  it("timed states settle through stabilizing to idle, only with a matching token", () => {
    const t = run([{ type: "TRANSFORM" }]);
    expect(DURATION.transforming).toBeGreaterThan(0);
    expect(run([{ type: "TIMEOUT", token: t.token - 1 }], t)).toEqual(t); // stale timer: ignored
    const s = run([{ type: "TIMEOUT", token: t.token }], t);
    expect(s.state).toBe("stabilizing");
    expect(run([{ type: "TIMEOUT", token: s.token }], s).state).toBe("idle");
  });
  it("a disturbance never cuts a transformation short, but conversation can always interrupt", () => {
    const t = run([{ type: "TRANSFORM" }]);
    expect(run([{ type: "DISTURB" }], t)).toEqual(t);
    expect(run([{ type: "DONE" }], t)).toEqual(t);
    expect(run([{ type: "LISTEN" }], t).state).toBe("listening");
  });
  it("an interrupted timed state cannot be moved by its old timer", () => {
    const d = run([{ type: "DISTURB" }]);
    const l = run([{ type: "LISTEN" }], d);
    expect(run([{ type: "TIMEOUT", token: d.token }], l)).toEqual(l);
  });
});

describe("mock fixtures", () => {
  it("are clearly invented: a made-up repo, short mock revisions, no GitHub links or 40-character SHAs", () => {
    expect(MOCK_REPO.owner).toBe("mock-fixture");
    const text = JSON.stringify({ ERAS, EVIDENCE, OBSERVED, READINGS });
    expect(text).not.toMatch(/github\.com|https?:\/\//);
    expect(text).not.toMatch(/\b[0-9a-f]{40}\b/);
    for (const e of ERAS) expect(e.sha).toMatch(/^[0-9a-f]{7}$/);
  });
  it("eras are ordered and every era points at evidence that exists in that era", () => {
    const dates = ERAS.map((e) => e.date);
    expect([...dates].sort()).toEqual(dates);
    ERAS.forEach((e, i) => {
      const ev = EVIDENCE.find((x) => x.id === e.evidenceId);
      expect(ev?.since).toBeLessThanOrEqual(i);
    });
  });
  it("every observation and reading cites evidence, and observations are never worded as causes", () => {
    const ids = new Set(EVIDENCE.map((e) => e.id));
    for (const o of OBSERVED) {
      expect(o.evidence.length).toBeGreaterThan(0);
      o.evidence.forEach((id) => expect(ids.has(id)).toBe(true));
      expect(o.text).not.toMatch(/\b(because|due to|caused|reason was)\b/i);
    }
    for (const r of READINGS) r.basis.forEach((id) => expect(ids.has(id)).toBe(true));
  });
  it("replies are scoped to the selected era: later evidence never appears earlier", () => {
    for (let i = 0; i < ERAS.length; i++) {
      for (const q of [...SHORTCUTS, "tell me everything", "is it archived?"]) {
        const r = mockReply(q, i);
        for (const id of r.sources) expect(EVIDENCE.find((e) => e.id === id)!.since).toBeLessThanOrEqual(i);
        if (i < ERAS.length - 1) for (const s of r.segments) if (s.kind !== "ghost") expect(s.text).not.toContain(ERAS[ERAS.length - 1].sha);
      }
    }
    expect(mockReply("Why did you die?", 0).segments.some((s) => /archived/i.test(s.text))).toBe(false);
    expect(mockReply("Why did you die?", ERAS.length - 1).segments.some((s) => /archived/i.test(s.text))).toBe(true);
  });
  it("always keeps fiction apart from facts and says when nothing was found", () => {
    const r = mockReply("why did this die?", ERAS.length - 1);
    expect(r.segments.some((s) => s.kind === "unknown")).toBe(true);
    expect(r.segments.filter((s) => s.kind === "ghost").every((s) => s.cites.length === 0)).toBe(true);
    expect(mockReply("what colour is the moon", 2).segments[0].kind).toBe("unknown");
  });
});

describe("Game markup (server render)", () => {
  const html = renderToStaticMarkup(<Game data={mockGameData()} />);
  it("has no mode bar: no Talk, Memories, Rewind or Inspect buttons, and no section tabs", () => {
    for (const gone of ['data-testid="act-', 'aria-label="Player actions"', 'data-testid="tab-', "Archive sections"]) expect(html).not.toContain(gone);
    expect(html).not.toMatch(/>Inspect</);
  });
  it("labels everything as mock data and offers free-form input with small inline prompts", () => {
    expect(html).toMatch(/Invented data\. No real repository\. No AI model\./);
    expect(html).toContain('placeholder="Ask in your own words');
    expect(html).not.toContain('class="gg-prompt"'); // the suggestion chips no longer sit under the text box
    expect(html).not.toContain("Scripted mock replies from fixtures"); // developer wording lives behind ?dev=1
  });
  it("has no Spirit Mirror, no separate suggestions panel, no developer metadata", () => {
    expect(html).not.toContain("Spirit Mirror");
    expect(html).not.toContain("Suggested questions");
    expect(html).not.toContain("storytelling convention");
    expect(html).not.toContain('data-testid="tools"');
    expect(html).not.toContain('class="rpg-tag tag-speech"');
  });
  it("has three regions: archive on the left, the conversation in the centre, the Memory Journal on the right", () => {
    expect(html).toContain('aria-label="Haunted Archive"');
    expect(html).toContain('aria-label="Memory Journal"');
    expect(html).toContain('data-testid="gg-dialogue"');
    expect(html).toContain('data-testid="journal"');
    expect(html).toContain('data-testid="archive"');
  });
  it("lists every available commit as a clickable memory, newest first, with the latest marked as the present", () => {
    const ids = [...html.matchAll(/data-testid="era-(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual([4, 3, 2, 1, 0]);
    expect(html).toMatch(/aria-current="true"[^>]*data-selected="true"[^>]*data-present="true"[^>]*data-testid="era-4"/);
    expect(html).toContain("Present");
    expect(html).not.toContain('data-testid="return-present"'); // already in the present
  });
  it("keeps the question box in the dialogue", () => {
    expect(html).toContain('placeholder="Ask in your own words');
  });
  it("contains no invented stats", () => {
    expect(html).not.toMatch(/\b(HP|XP|level|power)\b/i);
  });
});

describe("one way back to the present", () => {
  it("the interface source has exactly one Return to present control (the stage chip) and no second button", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const dir = "src/components/game";
    const src = readdirSync(dir).filter((f) => /\.tsx$/.test(f) && !/test/.test(f)).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
    expect((src.match(/Return to present/gi) ?? []).length).toBe(1);
    expect(src).not.toContain("return-present");
    expect((src.match(/data-testid="return-chip"/g) ?? []).length).toBe(1);
  });
});
