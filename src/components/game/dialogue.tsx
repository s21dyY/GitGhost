"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Reply, ReplySegment, SegmentKind } from "./data";
import { EMOTION_LABEL, type Emotion } from "./fixtures";
import { useDevMode } from "./dev";
import { useGame } from "./game-context";
import { CiteChip } from "./panels";
import { playSfx, playVoice } from "@/lib/sound";
import type { Choice } from "./encounter";
import { fragment } from "./speech";
import { useReveal } from "./typewriter";
import { Ghost, type Form, type Frame } from "./Ghost";

export type Turn = { id: number; q: string; eraIdx: number; reply: Reply };
export type AskError = { question: string; code: string; message: string; retryAfterSec?: number };
/** The conversation is one continuous log: questions and answers, with a marker wherever the player moved to another memory. */
export type LogItem = { type: "turn"; turn: Turn } | { type: "travel"; id: string; eraIdx: number };

const TAG: Record<SegmentKind, { label: string; cls: string }> = {
  record: { label: "Record", cls: "tag-record" },
  reading: { label: "Reading", cls: "tag-reading" },
  unknown: { label: "Not found", cls: "tag-missing" },
  ghost: { label: "Ghost", cls: "tag-speech" },
};

/** A line's label. Players hear the ghost, not the bookkeeping: the label is spoken to screen readers and shown only in dev mode. */
function Tag({ cls, children }: { cls: string; children: React.ReactNode }) {
  const dev = useDevMode();
  return dev ? <span className={`rpg-tag ${cls}`}>{children}</span> : <span className="sr-only">{children}: </span>;
}

type Prepared = { seg: ReplySegment; visual: string; holds: number[]; start: number };

/**
 * A reply as the player sees it. The ghost's own lines come out broken (stutters, trailing off, stalls) and
 * the screen-reader text stays whole. Records, readings and gaps are clean, in their own slip, and never
 * change shape: the horror is in the voice, not in the facts.
 */
function Typed({ segments, animate, resetKey, onDone, onCite, sources, voice }: { segments: ReplySegment[]; animate: boolean; resetKey: string | number; onDone?: () => void; onCite: (ids: string[]) => void; sources?: string[]; voice: Form }) {
  const dev = useDevMode();
  const seed = typeof resetKey === "number" ? resetKey : resetKey.length;
  const prepared = useMemo<Prepared[]>(() => {
    // How much the on-screen text breaks follows the form: a person speaks cleanly, the changed form stutters,
    // and the thing underneath mostly loops its own words (written into the line) with only a few breaks.
    const breakage = voice === "human" ? 0 : voice === "distorted" ? 1 : 0.5;
    const parts = segments.map((seg, i) => (seg.kind === "ghost" ? fragment(seg.text, seed + i, breakage) : { visual: seg.text, holds: [] as number[] }));
    return segments.map((seg, i) => ({ seg, visual: parts[i].visual, holds: parts[i].holds, start: parts.slice(0, i).reduce((a, p) => a + p.visual.length, 0) }));
  }, [segments, seed, voice]);
  const total = prepared.reduce((a, p) => a + p.visual.length, 0);
  const holds = useMemo(() => prepared.flatMap((p) => (p.holds.length ? p.holds : Array(p.visual.length).fill(0))), [prepared]);
  const { n, done, skip } = useReveal(total, animate, resetKey, holds);
  // Retro speech: each letter that appears makes a sound, in the ghost's voice or the dry tick of a record.
  useEffect(() => {
    if (!animate || n === 0 || n > total) return;
    const at = prepared.findLast((p) => p.start < n);
    const ch = at?.visual[n - 1 - at.start] ?? "";
    if (/[\p{L}\p{N}]/u.test(ch)) playVoice(at!.seg.kind === "ghost" ? voice : "record", n);
  }, [n, animate, total, prepared, voice]);
  useEffect(() => {
    if (animate && done) onDone?.();
  }, [animate, done, onDone]);
  const typingNow = animate && !done;
  return (
    <>
      {/* While the text types, assistive tech gets the whole reply at once; the typed copy is hidden from it. */}
      {typingNow ? <span className="sr-only">{segments.map((g) => g.text).join(" ")}</span> : null}
      {prepared.map(({ seg, visual, start }, i) => {
        const visible = Math.max(0, Math.min(visual.length, n - start));
        if (animate && visible === 0) return null;
        const tag = TAG[seg.kind];
        const typing = animate && visible < visual.length;
        const ghost = seg.kind === "ghost";
        return (
          <p key={i} className={`gg-line ${ghost ? "gg-ghostline" : dev ? "gg-ghostline gg-spoken gg-devfact" : "gg-ghostline gg-spoken"}`} data-kind={seg.kind} aria-hidden={typingNow || undefined}>
            <Tag cls={tag.cls}>{tag.label}</Tag>
            {ghost ? (
              <>
                <span aria-hidden="true">
                  {typing ? visual.slice(0, visible) : visual}
                  {typing ? <span className="gg-rest">{visual.slice(visible)}</span> : null}
                </span>
                {typingNow ? null : <span className="sr-only">{seg.text}</span>}
              </>
            ) : typing ? (
              <>
                <span>{visual.slice(0, visible)}</span>
                <span className="gg-rest">{visual.slice(visible)}</span>
              </>
            ) : (
              seg.text
            )}
            {dev && !typing && seg.cites.length ? <CiteChip ids={seg.cites} onCite={onCite} /> : null}
          </p>
        );
      })}
      {/* Normal mode: one quiet seal per reply opens the Records drawer. Per-line seals and labels are for ?dev=1. */}
      {!dev && !typingNow && sources && sources.length ? (
        <p className="gg-line gg-seal" data-testid="reply-seal"><CiteChip ids={sources} onCite={onCite} /></p>
      ) : null}
      {animate && !done ? (
        <button type="button" className="gg-skip" onClick={skip}>Skip ▶</button>
      ) : null}
    </>
  );
}

/** The head-and-shoulders portrait: the same expression and form as the figure in the scene. */
function Portrait({ form, expr, frame, talking }: { form: Form; expr: Emotion; frame: Frame | null; talking: boolean }) {
  const g = useGame();
  return (
    <div className="gg-portrait" aria-hidden="true" data-form={form}>
      <div className="gg-portrait-inner">
        <Ghost sprite={g.sprite ?? "archivist"} form={form} expr={expr} frame={frame ?? { kind: "atlas", state: "idle" }} talking={talking && !frame} bob={false} decorative />
      </div>
    </div>
  );
}

/** One quiet line under an answer: what wrote it, and the commit it was held to. Full wording only in dev mode. */
function ReplyNote({ reply }: { reply: Reply }) {
  const g = useGame();
  const dev = useDevMode();
  const who = reply.provider === "bedrock" ? "AI-written, checked against sources" : reply.provider === "mock" ? (g.mode === "mock" ? "scripted, invented fixtures" : "scripted, no AI") : null;
  return (
    <p className="gg-replynote" data-testid="reply-note" data-provider={reply.provider ?? "unknown"}>
      {reply.provider === "bedrock" ? <span className="gg-ai-tag" aria-hidden="true">AI</span> : null}
      {who}
      {reply.asOf ? `${who ? " · " : ""}held to ${reply.asOf.shortSha} (${reply.asOf.date})` : null}
      {dev && reply.provider === "mock" && g.mode === "live" ? ". Fixed templates and real GitHub evidence; no AI model was called" : null}
      {reply.gaps?.length ? ` · could not read: ${reply.gaps.map((x) => x.split(":")[0]).join(", ")}` : null}
    </p>
  );
}

export type Intro = { beats: ReplySegment[][]; step: number; done: boolean; onNext: () => void; onDone: () => void };

/**
 * True when keyboard focus is on nothing the visitor can see. Next keeps earlier pages alive but hidden, so after the
 * first ghost, focus is often left on an element of a page that is no longer on screen: that counts as nothing too.
 */
function focusIsIdle(el: Element | null = document.activeElement): boolean {
  if (!el || el === document.body || !el.isConnected) return true;
  const h = el as HTMLElement;
  return typeof h.checkVisibility === "function" ? !h.checkVisibility() : h.offsetParent === null && getComputedStyle(h).position !== "fixed";
}

/** The RPG choice menu: a ▶ cursor on the focused line, arrow keys move it, Enter chooses. */
function ChoiceMenu({ choices, onChoose }: { choices: Choice[]; onChoose: (c: Choice) => void }) {
  const ref = useRef<HTMLUListElement>(null);
  // Fresh from the opening (focus on nothing, or on the continue button), the cursor lands on the first line.
  useEffect(() => {
    if (focusIsIdle() || document.activeElement?.classList.contains("gg-beat-next")) ref.current?.querySelector("button")?.focus();
  }, []);
  // Its height, as --menu-h on the game, so the code panel can end above the window instead of under it.
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest<HTMLElement>(".gg");
    if (!el || !root) return;
    const ro = new ResizeObserver(() => root.style.setProperty("--menu-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--menu-h");
    };
  }, []);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const all = Array.from(ref.current?.querySelectorAll("button") ?? []);
    const at = all.indexOf(document.activeElement as HTMLButtonElement);
    e.preventDefault();
    all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return (
    <ul ref={ref} className="gg-menu" aria-label="What do you say?" onKeyDown={onKey} data-testid="choices">
      {choices.map((c) => (
        <li key={c.id}>
          <button type="button" className="gg-menu-item" data-choice={c.id} onClick={() => onChoose(c)} onMouseEnter={() => playSfx("hover")} data-testid={`choice-${c.id}`}>
            {c.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Dialogue({
  eraIdx, form, expr, frame, talking, corrupt, items, revealId, busy, reduced, draft, inputRef,
  error, onRetry, onDraft, onAsk, onRevealDone, onCite, intro, choices, onChoose,
}: {
  eraIdx: number; form: Form; expr: Emotion; frame: Frame | null; talking: boolean; corrupt: boolean;
  items: LogItem[]; revealId: number | null; busy: boolean; reduced: boolean; draft: string;
  inputRef: React.RefObject<HTMLInputElement | null>; error: AskError | null; onRetry: () => void;
  onDraft: (v: string) => void; onAsk: (q: string) => void; onRevealDone: (id: number) => void; onCite: (ids: string[]) => void;
  intro: Intro | null; choices: Choice[] | null; onChoose: (c: Choice) => void;
}) {
  const uid = useId();
  // The opening: which beat has finished typing. With reduced motion every beat is shown whole at once.
  const [beatDone, setBeatDone] = useState(-1);
  const lastBeat = intro ? intro.beats.length - 1 : -1;
  const beatReady = !!intro && (reduced || beatDone >= intro.step);
  const opening = !!intro && !intro.done;
  useEffect(() => {
    if (intro && !intro.done && beatReady && intro.step === lastBeat) intro.onDone();
  }, [intro, beatReady, lastBeat]);
  // When a line has finished, the ▼ takes keyboard focus (unless the visitor is busy with another visible control),
  // so Enter or Space moves on. Enter or Space with focus on nothing visible does the same.
  const nextRef = useRef<HTMLButtonElement>(null);
  const canNext = opening && beatReady && !!intro && intro.step < lastBeat;
  useEffect(() => {
    if (canNext && focusIsIdle()) nextRef.current?.focus({ preventScroll: true });
  }, [canNext, intro?.step]);
  useEffect(() => {
    if (!canNext) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && focusIsIdle(e.target as Element | null)) {
        e.preventDefault();
        intro!.onNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, intro]);
  const g = useGame();
  const dev = useDevMode();
  const era = g.eras[eraIdx];
  const past = g.mode === "live" && g.eras.length > 0 && eraIdx < g.eras.length - 1;
  const greeting = era?.ghostLine ?? "Ask. I will tell you what the pages still hold.";
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // A reply that fits is shown from its first line. A longer one follows the typing, so the ghost's own line
    // (which comes last) is never hidden below the fold. A failure and its retry button are always brought into view.
    const el = logRef.current;
    if (!el) return;
    const place = () => {
      const newest = Array.from(el.querySelectorAll<HTMLElement>(".gg-turn")).at(-1);
      el.scrollTop = el.querySelector('[data-testid="ask-error"]') ? el.scrollHeight : newest && newest.offsetHeight <= el.clientHeight ? newest.offsetTop : newest ? el.scrollHeight : 0;
    };
    place();
    const mo = new MutationObserver(place);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [items.length, revealId, error]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onAsk(draft);
  };
  // Phones show the choices OR the typing row, not both; "Say something else…" switches to typing until the next turn.
  const [typingAt, setTypingAt] = useState<number | null>(null);
  const typing = typingAt === items.length;
  useEffect(() => {
    if (typing) inputRef.current?.focus();
  }, [typing, inputRef]);
  const choose = (c: Choice) => {
    if (c.id === "other") setTypingAt(items.length);
    onChoose(c);
  };
  const lastItem = items.at(-1);
  return (
    <section className="gg-dlg" aria-labelledby={`${uid}-h`} data-typing={typing || undefined} data-form={form} data-expr={expr} data-past={past || undefined} data-talking={talking || undefined} data-corrupt={corrupt || undefined} data-testid="gg-dialogue">
      <div className="gg-dlg-tab">
        <h2 id={`${uid}-h`} className="gg-nameplate" data-testid="nameplate">{g.ghostName}</h2>
        {dev ? <span className="gg-quiet">{EMOTION_LABEL[expr]}</span> : null}
        {past && era ? <span className="rpg-tag tag-reading gg-mock" data-testid="dlg-era">as of {era.sha}</span> : null}
      </div>
      <div className="gg-dlg-box">
        <Portrait form={form} expr={expr} frame={frame} talking={talking} />
        <div className="gg-dlg-main">
          {/* during the opening, a click anywhere in the conversation moves it on, as in an RPG text box */}
          <div ref={logRef} className="gg-log" role="log" aria-live="off" tabIndex={0} aria-label="Conversation" data-testid="gg-log" data-opening={canNext || undefined}
            onClick={(e) => { if (canNext && !(e.target as Element).closest("button, a")) intro!.onNext(); }}>
            {intro ? (
              <>
                {intro.beats.slice(0, intro.step + 1).map((beat, i) => (
                  <div key={`beat-${i}`} className="gg-turn gg-beat" data-testid="encounter-beat">
                    <Typed segments={beat} animate={!reduced && opening && i === intro.step} resetKey={`beat-${i}`} onDone={() => setBeatDone((d) => Math.max(d, i))} onCite={onCite} voice={form} />
                  </div>
                ))}
                {opening && beatReady && intro.step < lastBeat ? (
                  <button ref={nextRef} type="button" className="gg-beat-next" onClick={intro.onNext} aria-label="Continue" data-testid="beat-next">▼</button>
                ) : null}
              </>
            ) : items.length === 0 ? (
              <div className="gg-turn">
                <Typed segments={[{ kind: "ghost", text: greeting, cites: [] }]} animate={!reduced} resetKey={era?.id ?? "none"} onCite={onCite} voice={form} />
                {era && dev ? (
                  <p className="gg-line gg-fact" data-kind="record">
                    <Tag cls="tag-record">Record</Tag>
                    {eraIdx >= g.eras.length - 1 ? "The newest commit is dated" : "This memory is dated"} {era.date}.
                    <CiteChip ids={[era.evidenceId]} onCite={onCite} />
                  </p>
                ) : null}
              </div>
            ) : null}
            {items.map((it, idx) => {
              if (it.type === "travel") {
                const e = g.eras[it.eraIdx];
                if (!e) return null;
                return (
                  <div key={it.id} className="gg-turn gg-travel" data-testid="travel-mark">
                    <Typed segments={[{ kind: "ghost", text: e.ghostLine, cites: [] }]} animate={!reduced && lastItem === it && idx === items.length - 1} resetKey={it.id} onCite={onCite} voice={form} />
                  </div>
                );
              }
              const t = it.turn;
              return (
                <div key={`t${t.id}`} className="gg-turn">
                  <p className="gg-you"><span className="sr-only">You: </span><span className="gg-speaker gg-speaker-you" aria-hidden="true">You</span><span className="gg-you-text">{t.q}</span>{dev || t.eraIdx < g.eras.length - 1 ? <span className="gg-asof"> · {g.eras[t.eraIdx]?.sha ?? "now"}</span> : null}</p>
                  <p className="gg-speaker gg-speaker-ghost" aria-hidden="true">{g.ghostName}</p>
                  <Typed segments={t.reply.segments} animate={revealId === t.id && !reduced} resetKey={t.id} onDone={() => onRevealDone(t.id)} onCite={onCite} sources={t.reply.sources} voice={form} />
                  {dev && t.id !== revealId ? <ReplyNote reply={t.reply} /> : null}
                  {lastItem === it && t.id !== revealId && !busy ? <span className="gg-next" aria-hidden="true">▼</span> : null}
                </div>
              );
            })}
            {busy ? <p className="gg-line" aria-hidden="true"><span className="gg-quiet">…</span></p> : null}
            {error ? (
              <div className="gg-error" role="alert" data-testid="ask-error">
                <p className="gg-line gg-fact" data-kind="unknown"><span className="rpg-tag tag-missing">Could not answer</span>{error.message}</p>
                <p>
                  <button type="button" className="rpg-btn !min-h-11 !text-xs" onClick={onRetry} disabled={busy}>Try again</button>{" "}
                  {g.mode === "live" && /github|network|rate|kill_switch|bedrock_disabled|daily_limit|budget|provider_|invalid_config/i.test(error.code) ? <a href="/demo" className="gg-link">Open the offline demo (invented data)</a> : null}
                </p>
              </div>
            ) : null}
          </div>
          <form onSubmit={submit} className="gg-form">
            <div className="gg-askrow">
              <label htmlFor={`${uid}-q`} className="sr-only">Your question</label>
              <input id={`${uid}-q`} ref={inputRef} className="rpg-input" value={draft} maxLength={200} autoComplete="off" placeholder={past ? "Ask about this era, or about a file…" : "Ask in your own words… or about a file, like src/app.js:12"} onChange={(e) => onDraft(e.target.value)} onBlur={() => { if (!draft.trim()) setTypingAt(null); }} />
              <button type="submit" className="rpg-btn rpg-btn-primary" disabled={busy || !draft.trim()}>Ask</button>
            </div>
            {dev ? <p className="gg-hint">{g.mode === "mock" ? "Scripted mock replies from fixtures. No AI model is called." : g.replyMode === "model" ? "Replies are written by an AI model and checked against GitHub sources." : g.replyMode === "unavailable" ? "Replies are unavailable: chat is not configured on this server." : "Replies are scripted from real GitHub evidence. No AI model is called."}</p> : null}
          </form>
        </div>
      </div>
      {/* the choices get their own window, as in an RPG, so they never take room from what the ghost is saying */}
      {choices ? <ChoiceMenu choices={choices} onChoose={choose} /> : null}
    </section>
  );
}
