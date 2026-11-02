"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { GhostSprite } from "@/components/entity/archivist/GhostSprite";
import { PORTRAIT_CROP, type Pose } from "@/components/entity/archivist/sprites";
import { useGhostForm } from "@/components/entity/GhostFormContext";
import { STATUS_TEXT, useGhostLook, type GhostView, type Nameplate } from "@/components/entity/GhostPanel";
import type { AnswerSegment, GroundedAnswer, SegmentKind } from "@/domain/chat";
import { MAX_QUESTION_CHARS, useConversation, type Turn } from "./ConversationProvider";

const STARTERS = ["Why did you die?", "What happened lately?", "How did you begin?", "What were people complaining about?"];

/** Concise in-dialogue indicator. Color is never the only signal: each has a word. */
const TAGS: Record<SegmentKind, { label: string; cls: string; icon: string }> = {
  verified: { label: "Record", cls: "tag-record", icon: "✦" },
  interpretation: { label: "Reading", cls: "tag-reading", icon: "◇" },
  unknown: { label: "Not found", cls: "tag-missing", icon: "✕" },
  ghost: { label: "Ghost", cls: "tag-speech", icon: "♦" },
};

/** Reveals text progressively; the full text is always in the DOM so assistive tech and copy/paste see all of it. */
function useReveal(total: number, active: boolean, onTick: () => void, onDone: () => void) {
  const [shown, setShown] = useState(0);
  const callbacks = useRef({ onTick, onDone });
  const skipped = useRef(false);
  useLayoutEffect(() => {
    callbacks.current = { onTick, onDone };
  });
  useEffect(() => {
    if (!active) return;
    const step = Math.max(3, Math.ceil(total / 110)); // the whole answer in about 3.3 seconds at most
    let n = 0;
    const id = setInterval(() => {
      n = skipped.current ? total : Math.min(total, n + step);
      setShown(n);
      callbacks.current.onTick();
      if (n >= total) {
        clearInterval(id);
        callbacks.current.onDone();
      }
    }, 30);
    return () => clearInterval(id);
  }, [active, total]);
  return { shown: active ? shown : total, skip: () => { skipped.current = true; } };
}

function AnswerBody({ turn, answer, onTick }: { turn: Turn; answer: GroundedAnswer; onTick: () => void }) {
  const { openJournalFor, revealDone } = useConversation();
  const number = new Map(answer.sources.map((s, i) => [s.id, i + 1]));
  const lens = answer.segments.map((s) => s.text.length);
  const total = lens.reduce((a, b) => a + b, 0);
  const animating = turn.revealing === true;
  const { shown, skip } = useReveal(total, animating, onTick, () => revealDone(turn.id));

  const starts = lens.map((_, i) => lens.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <article aria-label="The ghost's reply" className="mt-2">
      <div className="space-y-3">
        {answer.segments.map((s: AnswerSegment, i: number) => {
          const visible = Math.max(0, Math.min(lens[i], shown - starts[i]));
          const complete = visible >= lens[i];
          const tag = TAGS[s.kind];
          return (
            <p key={i} className={`dlg-line ${s.kind === "ghost" ? "italic dlg-ghost" : ""}`}>
              <span className={`rpg-tag ${tag.cls}`}>
                <span aria-hidden="true">{tag.icon} </span>
                {tag.label}
              </span>
              {animating && !complete ? (
                <>
                  <span>{s.text.slice(0, visible)}</span>
                  <span className="reveal-rest">{s.text.slice(visible)}</span>
                </>
              ) : (
                s.text
              )}
              {animating && visible > 0 && !complete ? <span className="caret" aria-hidden="true" /> : null}
              {s.citations.map((c) => (
                <a
                  key={c.id}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Source ${number.get(c.id)}: ${c.label} (opens in a new tab)`}
                  className={`ml-1 inline-block min-w-6 px-1 text-center text-gold underline underline-offset-2 hover:text-white ${complete ? "" : "invisible"}`}
                >
                  [{number.get(c.id)}]
                </a>
              ))}
            </p>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 text-sm" style={{ color: "var(--bone-dim)" }}>
        {animating ? (
          <button type="button" onClick={skip} className="rpg-btn !min-h-9 !py-1 !text-xs">
            Skip
          </button>
        ) : (
          <button type="button" onClick={() => openJournalFor(turn.id)} className="rpg-btn !min-h-9 !py-1 !text-xs">
            Open in journal ({answer.sources.length} {answer.sources.length === 1 ? "source" : "sources"})
          </button>
        )}
        {answer.scripted ? (
          <span>
            <span className="rpg-tag tag-reading !mr-1">Scripted</span> Fixed templates, no AI model was called.
          </span>
        ) : null}
      </div>
      {answer.gaps.length ? <p className="mt-2 text-sm text-crimson">Could not read: {answer.gaps.join("; ")}</p> : null}
    </article>
  );
}

function Portrait({ view, pose, devTools }: { view: Extract<GhostView, { assignment: unknown }>; pose: Pose; devTools: boolean }) {
  const { stage } = useGhostLook(view, devTools);
  // The portrait repeats the figure in the scene, so it is hidden from assistive tech. A speaking portrait is the default.
  return (
    <div className="dlg-portrait" data-stage={stage}>
      <GhostSprite stage={stage} pose={pose === "idle" ? "speaking" : pose} mutationIds={view.assignment.mutationParts} crop={PORTRAIT_CROP} decorative className="portrait-art" />
    </div>
  );
}

export function ChatPanel({ repo, ghost, plate, devTools = false }: { repo: string; ghost: Extract<GhostView, { assignment: unknown }>; plate?: Nameplate; devTools?: boolean }) {
  const { form, chatPose } = useGhostForm();
  const { turns, busy, announce, send } = useConversation();
  const uid = useId();
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const toBottom = useCallback(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);
  useLayoutEffect(() => {
    if (turns.length > 0) toBottom(); // an empty log stays at its top so the greeting is visible
  }, [turns, toBottom]);

  const submit = useCallback(
    (q: string) => {
      if (busy || !q.trim()) return;
      setDraft("");
      void send(q).finally(() => input.current?.focus({ preventScroll: true }));
    },
    [busy, send],
  );
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft);
    }
  };

  const speakingAs = form === "human" ? "Speaking as it was before the forgetting" : "Speaking as it is now";
  const pose: Pose = busy ? "thinking" : chatPose;

  return (
    <div className="dock">
      <section className="dlg" aria-labelledby={`${uid}-h`} data-testid="dialogue" data-expression={pose} data-voice={form === "human" ? "human" : "horror"}>
        <div className="dlg-tabs">
          <h1 className="dlg-tab" data-testid="nameplate">
            <span className="sr-only">Repository: </span>
            {plate ? `${plate.owner}/${plate.name}` : repo}
            {plate ? (
              <span className={`dlg-status ${STATUS_TEXT[plate.statusTone]}`} title={plate.statusDefinition}>
                {plate.statusLabel}
              </span>
            ) : null}
          </h1>
          <span className="dlg-tab dlg-tab-quiet" title="This conversation is scripted. No AI model is called.">
            Scripted mock
            <span className="sr-only">. This conversation is scripted. No AI model is called.</span>
          </span>
        </div>
        <div className="dlg-box">
          <Portrait view={ghost} pose={pose} devTools={devTools} />
          <div className="dlg-main">
            <h2 id={`${uid}-h`} className="sr-only">
              Ask the ghost
            </h2>
            <p className="sr-only">{speakingAs}</p>
            <div
              ref={log}
              role="log"
              aria-label="Conversation"
              aria-live="off"
              tabIndex={0}
              className="dlg-log"
              data-testid="dialogue-log"
            >
              {turns.length === 0 ? (
                <div>
                  <p className="dlg-line">
                    <span className="rpg-tag tag-speech">Ghost</span>
                    {form === "human" ? "A reader. Let me find your place. What would you like to know?" : "Something stirs in the margins… ask."}
                  </p>
                  <p className="dlg-choose font-label mt-2 text-xs text-gold">Choose, or write your own below</p>
                  <ul className="dlg-choices">
                    {STARTERS.map((s) => (
                      <li key={s}>
                        <button type="button" disabled={busy} onClick={() => submit(s)} className="rpg-btn w-full justify-start !min-h-10 !py-1 !text-xs !normal-case">
                          <span aria-hidden="true" className="text-gold">▶</span> {s}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {turns.map((t) => (
                <div key={t.id}>
                  <p className="dlg-you">
                    <span className="rpg-tag text-fog">You</span>
                    {t.question}
                  </p>
                  {t.status === "pending" ? (
                    <p className="dlg-line mt-2" aria-hidden="true">
                      <span className="rpg-tag tag-speech">Ghost</span>
                      <span className="dots"><span>.</span><span>.</span><span>.</span></span> <span style={{ color: "var(--bone-dim)" }}>{repo} is thinking</span>
                    </p>
                  ) : null}
                  {t.status === "done" && t.answer ? <AnswerBody turn={t} answer={t.answer} onTick={toBottom} /> : null}
                  {t.status === "failed" ? (
                    <div role="alert" className="mt-2 border-l-4 border-rust bg-[#2a1520]/70 p-3">
                      <p className="text-crimson">
                        <span className="rpg-tag tag-missing">Error</span>
                        {t.error}
                      </p>
                      <button type="button" disabled={busy} onClick={() => void send(t.question, t.id)} className="rpg-btn mt-2">
                        Try again
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>

            <form onSubmit={onSubmit} className="dlg-form">
              <label htmlFor={`${uid}-q`} className="sr-only">
                Your question
              </label>
              <div className="flex items-stretch gap-2">
                <span aria-hidden="true" className="font-pixel hidden pt-3 text-gold sm:block">▶</span>
                <textarea
                  id={`${uid}-q`}
                  ref={input}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  maxLength={MAX_QUESTION_CHARS}
                  aria-describedby={`${uid}-hint`}
                  placeholder="Ask about this repository…"
                  className="rpg-input min-h-11 flex-1 resize-none"
                />
                <button type="submit" disabled={busy || draft.trim().length === 0} aria-busy={busy} className="rpg-btn rpg-btn-primary">
                  {busy ? "Thinking…" : "Ask"}
                </button>
              </div>
              <p id={`${uid}-hint`} className="dlg-hint">
                <span>Answers come only from sources retrieved from GitHub for this repository.</span>{" "}
                <span className="dlg-hint-keys">Enter sends. Shift+Enter adds a new line.</span>{" "}
                <span>{draft.length}/{MAX_QUESTION_CHARS}</span>
              </p>
            </form>
          </div>
        </div>
        <p role="status" className="sr-only">{announce}</p>
      </section>
    </div>
  );
}
