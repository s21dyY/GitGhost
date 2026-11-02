import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A recording stand-in for Web Audio, so the tests can see whether anything would have been played. */
function fakeAudio() {
  const created: string[] = [];
  const node = () => ({ connect: (n: unknown) => n, disconnect: () => undefined, start: () => undefined, stop: () => undefined, type: "", frequency: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, gain: { value: 0, setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined }, Q: { value: 0 }, loop: false, buffer: null });
  class Ctx {
    state = "running";
    currentTime = 0;
    sampleRate = 8000;
    destination = {};
    resume = () => Promise.resolve();
    createOscillator = () => (created.push("osc"), node());
    createGain = () => node();
    createBiquadFilter = () => node();
    createBufferSource = () => (created.push("noise"), node());
    createBuffer = (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) });
  }
  return { Ctx, created };
}

function fakeWindow(Ctx: unknown) {
  const store = new Map<string, string>();
  return {
    AudioContext: Ctx,
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (fn: () => void) => fn,
    store,
  };
}

describe("sound", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it("does nothing on the server or where Web Audio is missing", async () => {
    const s = await import("./sound");
    expect(() => { s.playSfx("summon"); s.wantAmbient(true); s.wantAmbient(false); }).not.toThrow();
    expect(s.isSoundOn()).toBe(false);
  });

  it("is silent until the player turns sound on", async () => {
    const { Ctx, created } = fakeAudio();
    vi.stubGlobal("window", fakeWindow(Ctx));
    const s = await import("./sound");
    s.playSfx("summon");
    s.playSfx("transform");
    expect(created).toEqual([]);
    s.setSound(true);
    const afterToggle = created.length;
    expect(afterToggle).toBeGreaterThan(0); // the confirmation blip
    s.playSfx("memory");
    expect(created.length).toBeGreaterThan(afterToggle);
    s.setSound(false);
    const afterOff = created.length;
    s.playSfx("memory");
    expect(created.length).toBe(afterOff);
  });

  it("remembers the choice", async () => {
    const { Ctx } = fakeAudio();
    const w = fakeWindow(Ctx);
    vi.stubGlobal("window", w);
    const s = await import("./sound");
    s.setSound(true);
    expect(w.store.get(s.SOUND_KEY)).toBe("on");
    s.setSound(false);
    expect(w.store.get(s.SOUND_KEY)).toBe("off");
  });

  it("starts the ambient bed only while sound is on", async () => {
    const { Ctx, created } = fakeAudio();
    vi.stubGlobal("window", fakeWindow(Ctx));
    const s = await import("./sound");
    s.wantAmbient(true);
    expect(created).toEqual([]);
    s.setSound(true);
    expect(created).toContain("noise");
    s.wantAmbient(false);
  });

  it("throttles hover blips", async () => {
    const { Ctx, created } = fakeAudio();
    vi.stubGlobal("window", fakeWindow(Ctx));
    const s = await import("./sound");
    s.setSound(true);
    const base = created.length;
    s.playSfx("hover");
    s.playSfx("hover");
    s.playSfx("hover");
    expect(created.length - base).toBe(1);
  });
});
