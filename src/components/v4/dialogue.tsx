"use client";

import { useEffect, useId, useMemo, useRef, type FormEvent } from "react";
import type { Reply, ReplySegment, SegmentKind } from "./data";
import { EMOTION_LABEL, type Emotion } from "./fixtures";
import { useDevMode } from "./dev";
import { useGame } from "./game-context";
import { CiteChip, MockBadge } from "./panels";
import { fragment } from "./speech";
import { useReveal } from "./typewriter";
import { V4Ghost, type Form, type Frame } from "./V4Ghost";

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
function Typed({ segments, animate, resetKey, onDone, onCite, sources }: { segments: ReplySegment[]; animate: boolean; resetKey: string | number; onDone?: () => void; onCite: (ids: string[]) => void; sources?: string[] }) {
  const dev = useDevMode();
  const seed = typeof resetKey === "number" ? resetKey : resetKey.length;
  const prepared = useMemo<Prepared[]>(() => {
    const parts = segments.map((seg, i) => (seg.kind === "ghost" ? fragment(seg.text, seed + i) : { visual: seg.text, holds: [] as number[] }));
    return segments.map((seg, i) => ({ seg, visual: parts[i].visual, holds: parts[i].holds, start: parts.slice(0, i).reduce((a, p) => a + p.visual.length, 0) }));
  }, [segments, seed]);
  const total = prepared.reduce((a, p) => a + p.visual.length, 0);
  const holds = useMemo(() => prepared.flatMap((p) => (p.holds.length ? p.holds : Array(p.visual.length).fill(0))), [prepared]);
  const { n, done, skip } = useReveal(total, animate, resetKey, holds);
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
          <p key={i} className={`v4-line ${ghost ? "v4-ghostline" : dev ? "v4-ghostline v4-spoken v4-devfact" : "v4-ghostline v4-spoken"}`} data-kind={seg.kind} aria-hidden={typingNow || undefined}>
            <Tag cls={tag.cls}>{tag.label}</Tag>
            {ghost ? (
              <>
                <span aria-hidden="true">
                  {typing ? visual.slice(0, visible) : visual}
                  {typing ? <span className="v4-rest">{visual.slice(visible)}</span> : null}
                </span>
                {typingNow ? null : <span className="sr-only">{seg.text}</span>}
              </>
            ) : typing ? (
              <>
                <span>{visual.slice(0, visible)}</span>
                <span className="v4-rest">{visual.slice(visible)}</span>
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
        <p className="v4-line v4-seal" data-testid="reply-seal"><CiteChip ids={sources} onCite={onCite} /></p>
      ) : null}
      {animate && !done ? (
        <button type="button" className="v4-skip" onClick={skip}>Skip ▶</button>
      ) : null}
    </>
  );
}

/** The head-and-shoulders portrait: the same expression and form as the figure in the scene. */
function Portrait({ form, expr, frame, talking }: { form: Form; expr: Emotion; frame: Frame | null; talking: boolean }) {
  const g = useGame();
  return (
    <div className="v4-portrait" aria-hidden="true" data-form={form}>
      <div className="v4-portrait-inner">
        <V4Ghost sprite={g.sprite ?? "archivist"} form={form} expr={expr} frame={frame ?? { kind: "atlas", state: "idle" }} talking={talking && !frame} bob={false} decorative />
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
    <p className="v4-replynote" data-testid="reply-note" data-provider={reply.provider ?? "unknown"}>
      {reply.provider === "bedrock" ? <span className="v4-ai-tag" aria-hidden="true">AI</span> : null}
      {who}
      {reply.asOf ? `${who ? " · " : ""}held to ${reply.asOf.shortSha} (${reply.asOf.date})` : null}
      {dev && reply.provider === "mock" && g.mode === "live" ? ". Fixed templates and real GitHub evidence; no AI model was called" : null}
      {reply.gaps?.length ? ` · could not read: ${reply.gaps.map((x) => x.split(":")[0]).join(", ")}` : null}
    </p>
  );
}

export function Dialogue({
  eraIdx, form, expr, frame, talking, corrupt, items, revealId, busy, reduced, draft, inputRef,
  error, onRetry, onDraft, onAsk, onRevealDone, onCite,
}: {
  eraIdx: number; form: Form; expr: Emotion; frame: Frame | null; talking: boolean; corrupt: boolean;
  items: LogItem[]; revealId: number | null; busy: boolean; reduced: boolean; draft: string;
  inputRef: React.RefObject<HTMLInputElement | null>; error: AskError | null; onRetry: () => void;
  onDraft: (v: string) => void; onAsk: (q: string) => void; onRevealDone: (id: number) => void; onCite: (ids: string[]) => void;
}) {
  const uid = useId();
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
      const newest = Array.from(el.querySelectorAll<HTMLElement>(".v4-turn")).at(-1);
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
  const lastItem = items.at(-1);
  return (
    <section className="v4-dlg" aria-labelledby={`${uid}-h`} data-form={form} data-expr={expr} data-past={past || undefined} data-talking={talking || undefined} data-corrupt={corrupt || undefined} data-testid="v4-dialogue">
      <div className="v4-dlg-tab">
        <h2 id={`${uid}-h`} className="v4-nameplate" data-testid="nameplate">{g.ghostName}</h2>
        {dev ? <span className="v4-quiet">{EMOTION_LABEL[expr]}</span> : null}
        {past && era ? <span className="rpg-tag tag-reading v4-mock" data-testid="dlg-era">as of {era.sha}</span> : null}
        <MockBadge />
      </div>
      <div className="v4-dlg-box">
        <Portrait form={form} expr={expr} frame={frame} talking={talking} />
        <div className="v4-dlg-main">
          <div ref={logRef} className="v4-log" role="log" aria-live="off" tabIndex={0} aria-label="Conversation" data-testid="v4-log">
            {items.length === 0 ? (
              <div className="v4-turn">
                <Typed segments={[{ kind: "ghost", text: greeting, cites: [] }]} animate={!reduced} resetKey={era?.id ?? "none"} onCite={onCite} />
                {era && dev ? (
                  <p className="v4-line v4-fact" data-kind="record">
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
                  <div key={it.id} className="v4-turn v4-travel" data-testid="travel-mark">
                    <Typed segments={[{ kind: "ghost", text: e.ghostLine, cites: [] }]} animate={!reduced && lastItem === it && idx === items.length - 1} resetKey={it.id} onCite={onCite} />
                  </div>
                );
              }
              const t = it.turn;
              return (
                <div key={`t${t.id}`} className="v4-turn">
                  <p className="v4-you"><span className="sr-only">You: </span><span className="v4-speaker v4-speaker-you" aria-hidden="true">You</span><span className="v4-you-text">{t.q}</span>{dev || t.eraIdx < g.eras.length - 1 ? <span className="v4-asof"> · {g.eras[t.eraIdx]?.sha ?? "now"}</span> : null}</p>
                  <p className="v4-speaker v4-speaker-ghost" aria-hidden="true">{g.ghostName}</p>
                  <Typed segments={t.reply.segments} animate={revealId === t.id && !reduced} resetKey={t.id} onDone={() => onRevealDone(t.id)} onCite={onCite} sources={t.reply.sources} />
                  {dev && t.id !== revealId ? <ReplyNote reply={t.reply} /> : null}
                  {lastItem === it && t.id !== revealId && !busy ? <span className="v4-next" aria-hidden="true">▼</span> : null}
                </div>
              );
            })}
            {busy ? <p className="v4-line" aria-hidden="true"><span className="v4-quiet">…</span></p> : null}
            {error ? (
              <div className="v4-error" role="alert" data-testid="ask-error">
                <p className="v4-line v4-fact" data-kind="unknown"><span className="rpg-tag tag-missing">Could not answer</span>{error.message}</p>
                <p>
                  <button type="button" className="rpg-btn !min-h-11 !text-xs" onClick={onRetry} disabled={busy}>Try again</button>{" "}
                  {g.mode === "live" && /github|network|rate|kill_switch|bedrock_disabled|daily_limit|budget|provider_|invalid_config/i.test(error.code) ? <a href="/demo" className="v4-link">Open the offline demo (invented data)</a> : null}
                </p>
              </div>
            ) : null}
          </div>
          <form onSubmit={submit} className="v4-form">
            <div className="v4-askrow">
              <label htmlFor={`${uid}-q`} className="sr-only">Your question</label>
              <input id={`${uid}-q`} ref={inputRef} className="rpg-input" value={draft} maxLength={200} autoComplete="off" placeholder={past ? "Ask about this era…" : "Ask in your own words…"} onChange={(e) => onDraft(e.target.value)} />
              <button type="submit" className="rpg-btn rpg-btn-primary" disabled={busy || !draft.trim()}>Ask</button>
            </div>
            {dev ? <p className="v4-hint">{g.mode === "mock" ? "Scripted mock replies from fixtures. No AI model is called." : g.replyMode === "model" ? "Replies are written by an AI model and checked against GitHub sources." : g.replyMode === "unavailable" ? "Replies are unavailable: chat is not configured on this server." : "Replies are scripted from real GitHub evidence. No AI model is called."}</p> : null}
          </form>
        </div>
      </div>
    </section>
  );
}
