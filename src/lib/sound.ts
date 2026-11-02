"use client";

/**
 * Sound for GitGhost. Everything is synthesised with the Web Audio API: no audio files, no downloads, no network.
 *
 * Rules this module keeps:
 * - Sound is OFF until the player turns it on (the toggle is a user gesture, so browsers allow it). It never autoplays.
 * - The choice is remembered in localStorage and can be changed at any time.
 * - Every function is a safe no-op where Web Audio does not exist (server render, tests, old browsers).
 * - Volumes are low on purpose. The ambient bed sits well below the effects.
 */
import { useSyncExternalStore } from "react";

export const SOUND_KEY = "gitghost.sound";
export type Sfx = "hover" | "select" | "summon" | "memory" | "transform" | "open" | "appear" | "flee" | "return";
/** Whose voice a typed line has: the ghost in each of its forms, or the dry tick of a record. */
export type Voice = "human" | "distorted" | "horror" | "record";

type Win = typeof globalThis & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };

let enabled = false;
let loaded = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ambient: { stop: () => void } | null = null;
let ambientWanted = false;
let lastHover = 0;
let lastVoice = 0;
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    enabled = window.localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    enabled = false;
  }
}

function audio(): { ctx: AudioContext; out: GainNode } | null {
  if (typeof window === "undefined") return null;
  const W = window as Win;
  const Ctor = W.AudioContext ?? W.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return master ? { ctx, out: master } : null;
}

export function isSoundOn(): boolean {
  load();
  return enabled;
}

export function setSound(on: boolean) {
  load();
  enabled = on;
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* the choice just will not be remembered */
  }
  if (on) {
    if (ambientWanted) startAmbientNow();
    playSfx("select");
  } else {
    stopAmbientNow();
  }
  emit();
}

/** React hook: the current on/off state, rendered as off on the server so markup never differs. */
export function useSound(): boolean {
  return useSyncExternalStore(subscribe, isSoundOn, () => false);
}

type Tone = { f: number; to?: number; at?: number; dur: number; type?: OscillatorType; vol?: number };

function tones(list: Tone[]) {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime;
  for (const t of list) {
    const o = a.ctx.createOscillator();
    const g = a.ctx.createGain();
    const start = t0 + (t.at ?? 0);
    o.type = t.type ?? "square";
    o.frequency.setValueAtTime(t.f, start);
    if (t.to) o.frequency.exponentialRampToValueAtTime(t.to, start + t.dur);
    const v = t.vol ?? 0.05;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(v, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t.dur);
    o.connect(g).connect(a.out);
    o.start(start);
    o.stop(start + t.dur + 0.02);
  }
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; // brown noise: soft, low, wind-like
    d[i] = last * 3.5;
  }
  return buf;
}

/** Short retro effects. Cheap, quiet, and silent unless the player turned sound on. */
export function playSfx(name: Sfx) {
  load();
  if (!enabled) return;
  switch (name) {
    case "hover": {
      // a heartbeat: two low thumps, the second softer
      const now = Date.now();
      if (now - lastHover < 400) return;
      lastHover = now;
      tones([{ f: 70, to: 48, dur: 0.09, type: "triangle", vol: 0.07 }, { f: 62, to: 44, at: 0.16, dur: 0.08, type: "triangle", vol: 0.045 }]);
      break;
    }
    case "select":
      tones([{ f: 330, dur: 0.06, vol: 0.04 }, { f: 495, at: 0.06, dur: 0.08, vol: 0.04 }]);
      break;
    case "open":
      tones([{ f: 392, dur: 0.05, vol: 0.03, type: "triangle" }, { f: 262, at: 0.05, dur: 0.09, vol: 0.03, type: "triangle" }]);
      break;
    case "summon":
      // the encounter sting: a falling chromatic run, a hit, and a low wail under the closing dark
      tones([
        ...[880, 831, 784, 740, 698, 659, 622, 587].map((f, i) => ({ f, at: i * 0.045, dur: 0.05, type: "square" as const, vol: 0.03 })),
        { f: 98, at: 0.36, dur: 0.22, type: "sawtooth", vol: 0.06 },
        { f: 104, at: 0.36, dur: 0.22, type: "sawtooth", vol: 0.04 },
        { f: 220, to: 55, at: 0.5, dur: 0.9, type: "triangle", vol: 0.045 },
      ]);
      break;
    case "appear":
      // a minor arpeggio rising into a held, wrong note
      tones([
        { f: 220, dur: 0.09, vol: 0.035 }, { f: 262, at: 0.09, dur: 0.09, vol: 0.035 }, { f: 330, at: 0.18, dur: 0.09, vol: 0.035 },
        { f: 466, at: 0.27, dur: 0.5, type: "triangle", vol: 0.035 }, { f: 455, at: 0.27, dur: 0.5, type: "triangle", vol: 0.025 },
      ]);
      break;
    case "flee":
      // running steps, then the door
      tones([
        ...[0, 0.1, 0.2, 0.3, 0.4].map((at, i) => ({ f: i % 2 ? 140 : 160, at, dur: 0.05, type: "square" as const, vol: 0.035 })),
        { f: 330, to: 82, at: 0.55, dur: 0.35, type: "sawtooth", vol: 0.04 },
      ]);
      break;
    case "return":
      tones([{ f: 196, dur: 0.18, type: "triangle", vol: 0.03 }, { f: 185, at: 0.2, dur: 0.4, type: "triangle", vol: 0.025 }]);
      break;
    case "memory":
      tones([{ f: 660, to: 330, dur: 0.16, type: "triangle", vol: 0.04 }, { f: 220, at: 0.12, dur: 0.14, type: "square", vol: 0.02 }]);
      break;
    case "transform": {
      tones([
        { f: 200, to: 45, dur: 0.9, type: "sawtooth", vol: 0.05 },
        { f: 90, to: 360, at: 0.2, dur: 0.6, type: "square", vol: 0.02 },
        { f: 61, at: 0.7, dur: 0.5, type: "sine", vol: 0.05 },
      ]);
      break;
    }
  }
}

/**
 * One syllable of typed speech, retro-RPG style. Called per revealed letter; it throttles itself so fast text
 * does not turn into a buzz. Each form has its own voice: a tired person, something broken, something underneath.
 */
export function playVoice(voice: Voice, i: number) {
  load();
  if (!enabled) return;
  const now = Date.now();
  if (now - lastVoice < (voice === "record" ? 30 : 55)) return;
  lastVoice = now;
  const wob = [0, 14, -9, 22, 5, -15, 9][i % 7];
  switch (voice) {
    case "human":
      tones([{ f: 300 + wob, dur: 0.035, vol: 0.022 }]);
      break;
    case "distorted":
      // a voice that keeps catching: every so often it drops an octave and grinds
      if (i % 9 === 4) tones([{ f: 120, to: 70, dur: 0.07, type: "sawtooth", vol: 0.03 }]);
      else tones([{ f: 190 + wob * 2, dur: 0.035, vol: 0.024 }, { f: 197 + wob * 2, dur: 0.035, vol: 0.012, type: "sawtooth" }]);
      break;
    case "horror":
      // two voices a semitone apart, low, as if more than one thing is speaking
      tones([{ f: 98 + wob, dur: 0.06, type: "triangle", vol: 0.04 }, { f: 104 + wob, dur: 0.06, type: "triangle", vol: 0.03 }, { f: 1568, dur: 0.012, type: "sine", vol: 0.006 }]);
      break;
    case "record":
      tones([{ f: 1200, dur: 0.012, vol: 0.008 }]);
      break;
  }
}

function startAmbientNow() {
  if (ambient || !enabled) return;
  const a = audio();
  if (!a) return;
  const { ctx: c, out } = a;
  const bed = c.createGain();
  bed.gain.value = 0;
  bed.gain.linearRampToValueAtTime(0.5, c.currentTime + 3);
  bed.connect(out);

  // Wind: looped brown noise through a band-pass whose centre drifts slowly.
  const wind = c.createBufferSource();
  wind.buffer = noiseBuffer(c, 6);
  wind.loop = true;
  const band = c.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 380;
  band.Q.value = 0.7;
  const windGain = c.createGain();
  windGain.gain.value = 0.16;
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 220;
  lfo.connect(lfoDepth).connect(band.frequency);
  wind.connect(band).connect(windGain).connect(bed);

  // Drone: two low sines a hair apart, so they beat slowly.
  const drones = [55, 55.7].map((f) => {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.value = 0.05;
    o.connect(g).connect(bed);
    return o;
  });

  wind.start();
  lfo.start();
  drones.forEach((o) => o.start());
  ambient = {
    stop: () => {
      const t = c.currentTime;
      bed.gain.cancelScheduledValues(t);
      bed.gain.setValueAtTime(bed.gain.value, t);
      bed.gain.linearRampToValueAtTime(0, t + 0.6);
      window.setTimeout(() => {
        try {
          wind.stop();
          lfo.stop();
          drones.forEach((o) => o.stop());
        } catch {
          /* already stopped */
        }
        bed.disconnect();
      }, 700);
    },
  };
}

function stopAmbientNow() {
  ambient?.stop();
  ambient = null;
}

/** The landing page asks for its ambient bed. It plays only while sound is on; leaving the page ends it. */
export function wantAmbient(on: boolean) {
  load();
  ambientWanted = on;
  if (on && enabled && typeof window !== "undefined") {
    // A remembered "on" cannot start sound before the player does anything; the first touch or key wakes it.
    const wake = () => {
      audio(); // resumes a context the browser kept suspended
      if (ambientWanted) startAmbientNow();
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
    window.addEventListener("pointerdown", wake, { once: true });
    window.addEventListener("keydown", wake, { once: true });
  }
  if (on) startAmbientNow();
  else stopAmbientNow();
}
