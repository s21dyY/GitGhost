"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Drawer } from "@/components/encounter/Drawer";
import { SoundToggle } from "@/components/SoundToggle";
import { playSfx } from "@/lib/sound";
import { STAGE_LABELS } from "@/components/entity/archivist/describe";
import { useAnimMachine, useReducedMotion } from "./anim";
import { useArrival } from "./arrival";
import { PixelWipe } from "@/components/fx/PixelWipe";
import { LeaveLink } from "@/components/fx/transitions";
import { useDevMode } from "./dev";
import { liveAsk } from "./ask";
import type { Ask, EvidenceData, GameData, ReplySegment } from "./data";
import { Dialogue, type AskError, type LogItem, type Turn } from "./dialogue";
import { askable, codeQuestions, codeSource, type Lines } from "./code";
import { bodyReply, choicesFor, encounterBeats, markMet, meetingFor, type Choice } from "./encounter";
import { CodeRecordBody } from "./CodeRecordBody";
import { Possession } from "./Possession";
import { askSpecialist, type CodeRecord } from "./specialist";
import type { Emotion } from "./fixtures";
import { GameProvider, useGame, type Game } from "./game-context";
import { mockAsk } from "./mock-data";
import { ArchiveSummary, MemoryJournal, MockBadge, RecordsBody, ToolsPanel } from "./panels";
import { FORM_INDEX, transformSteps, TWITCH, useSequencer } from "./sequence";
import { BloodDrips, HorrorBleed, V4Ghost, WatchingEyes, type Form } from "./V4Ghost";
import "./v4.css";

const REWIND_MS = 1000;
const COMMIT_MS = 420;
const noSubscribe = () => () => undefined;
const formOf = (stage: string): Form => (stage === "transformed" ? "horror" : (stage as Form));
const plain = (segments: { text: string }[]) => segments.map((s) => s.text).join(" ").slice(0, 1200);

/**
 * The game. `data` decides what it shows: real GitHub data from the repository page, or the invented
 * fixtures of the offline demo and the prototype. `tools` adds the review controls (expression picker,
 * animation triggers); they are off unless asked for (the prototype page does).
 */
export function V4Game({ data, tools = false }: { data: GameData; tools?: boolean }) {
  const [cited, setCited] = useState<EvidenceData[]>([]);
  const game: Game = useMemo(() => ({ ...data, allEvidence: [...data.evidence, ...cited] }), [data, cited]);
  const ask = useMemo<Ask>(() => (data.mode === "live" ? liveAsk(data) : mockAsk), [data]);
  const addEvidence = useCallback((items: EvidenceData[]) => {
    if (!items.length) return;
    setCited((prev) => {
      const seen = new Set(prev.map((e) => e.id));
      const fresh = items.filter((e) => !seen.has(e.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);
  return (
    <GameProvider value={game}>
      <Inner ask={ask} addEvidence={addEvidence} tools={tools} />
    </GameProvider>
  );
}

function Inner({ ask, addEvidence, tools }: { ask: Ask; addEvidence: (e: EvidenceData[]) => void; tools: boolean }) {
  const g = useGame();
  const eras = g.eras;
  const lastIdx = Math.max(0, eras.length - 1);
  const reduced = useReducedMotion();
  const [anim, dispatch] = useAnimMachine(reduced);
  const seq = useSequencer(reduced);
  const [eraIdx, setEraIdx] = useState(lastIdx);
  const [, setVisited] = useState<number[]>([]);
  const [items, setItems] = useState<LogItem[]>([]);
  const [recordIds, setRecordIds] = useState<string[] | null>(null);
  const [revealId, setRevealId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AskError | null>(null);
  const [draft, setDraft] = useState("");
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [flash, setFlash] = useState(false);
  const [corrupt, setCorrupt] = useState(false);
  const arriving = useArrival(reduced);
  useEffect(() => {
    if (arriving) playSfx("appear");
  }, [arriving]);
  // The first encounter: how the visitor came is read once on the client (null on the server), then the opening plays
  // beat by beat. A ghost already met in this session goes straight to the choices.
  const meeting = useSyncExternalStore(noSubscribe, () => meetingFor(g.repo.fullName), () => null);
  const [introStep, setIntroStep] = useState(0);
  const [introDone, setIntroDone] = useState(false);
  const [exprOverride, setExprOverride] = useState<Emotion | null>(null);
  const [status, setStatus] = useState("");
  const timers = useRef<number[]>([]);
  const nextId = useRef(1);
  const travelId = useRef(1);
  const token = useRef(0); // a newer question, or a change of era, makes an older answer stale
  const inputRef = useRef<HTMLInputElement>(null);
  const archiveBtn = useRef<HTMLButtonElement>(null);
  const journalBtn = useRef<HTMLButtonElement>(null);
  const archiveHead = useRef<HTMLHeadingElement>(null);
  const journalHead = useRef<HTMLHeadingElement>(null);

  const era = eras[eraIdx];
  const stage = era?.stage ?? g.restingStage;
  const form = formOf(stage);
  const tone = era?.tone ?? "dim";
  const shownEmotion: Emotion = exprOverride ?? (era?.emotion ?? "neutral");
  const turns = useMemo(() => items.flatMap((it): Turn[] => (it.type === "turn" ? [it.turn] : [])), [items]);
  const past = eras.length > 0 && eraIdx < lastIdx;
  const frame = seq.playing?.frame ?? null;
  const frozen = seq.playing?.freeze === true;
  const talking = anim.state === "speaking";
  const live = g.mode === "live";
  const dev = useDevMode();

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  const closeDrawers = useCallback(() => {
    setArchiveOpen(false);
    setJournalOpen(false);
  }, []);

  /** A short tear across the dialogue, only ever on the ghost's voice. */
  const tearDialogue = useCallback(() => {
    setCorrupt(true);
    later(() => setCorrupt(false), 320);
  }, [later]);

  const playTwitch = useCallback(() => {
    if (reduced) {
      setStatus("The ghost twitches and goes still. Motion is reduced, so it is not animated.");
      return;
    }
    seq.play("twitch", TWITCH);
    tearDialogue();
  }, [reduced, seq, tearDialogue]);

  const playTransform = useCallback(
    (from: Form, to: Form) => {
      playSfx("transform");
      seq.play("transform", transformSteps(FORM_INDEX[from], FORM_INDEX[to]), () => setStatus(`The ghost is now: ${to === "human" ? "human" : to}.`));
    },
    [seq],
  );

  const triggerGlitch = () => {
    if (reduced) {
      setStatus("Glitch skipped because reduced motion is on.");
      return;
    }
    dispatch({ type: "DISTURB" });
    setFlash(true);
    tearDialogue();
    later(() => setFlash(false), 180);
  };

  // Rare events in the changed forms: a twitch now and then, and once in a long while the human face shows through.
  useEffect(() => {
    if (reduced || form === "human") return;
    const t1 = window.setTimeout(playTwitch, 28000 + Math.random() * 30000);
    const t2 = window.setTimeout(() => triggerGlitch(), 70000 + Math.random() * 60000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-arm only when the form or motion preference changes
  }, [reduced, form, flash]);

  /** Selecting a memory: the one way to move through time. Same form means no transformation, only a flicker. */
  const selectMemory = (i: number) => {
    if (i === eraIdx || !eras[i]) {
      closeDrawers();
      return;
    }
    playSfx("memory");
    timers.current.forEach((id) => window.clearTimeout(id)); // interruptible: the newest selection wins
    timers.current = [];
    token.current++; // an answer still on its way belongs to the old era
    seq.cancel();
    setBusy(false);
    setError(null);
    setRevealId(null);
    setExprOverride(null);
    const target = eras[i];
    const from = form, to = formOf(target.stage);
    const commit = () => {
      setEraIdx(i);
      setVisited((v) => (v.includes(i) ? v : [...v, i]));
      setItems((list) => [...list, { type: "travel", id: `travel-${travelId.current++}`, eraIdx: i }]);
      if (from !== to) playTransform(from, to);
      else dispatch({ type: "DISTURB" });
      setStatus(`${i === lastIdx ? "Returned to the present" : "Time travel"}: commit ${target.sha}, ${target.date}. The ghost now looks: ${STAGE_LABELS[target.stage].label}.${i === lastIdx ? "" : " Questions are answered only from what existed at or before this commit."}`);
    };
    if (reduced) {
      commit();
    } else {
      setRewinding(true);
      later(commit, COMMIT_MS);
      later(() => setRewinding(false), REWIND_MS);
    }
    closeDrawers();
  };

  const submit = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    playSfx("open");
    const asked = eraIdx;
    const mine = ++token.current;
    setBusy(true);
    setError(null);
    setDraft("");
    dispatch({ type: "LISTEN" });
    // Only turns from THIS era go back to the server: an earlier answer from another era could carry facts this one must not know.
    const history = turns.filter((t) => t.eraIdx === asked).slice(-3).flatMap((t) => [
      { role: "user" as const, content: t.q },
      { role: "assistant" as const, content: plain(t.reply.segments) },
    ]);
    const [result] = await Promise.all([ask({ question: text, eraIdx: asked, history }), new Promise((r) => window.setTimeout(r, reduced ? 0 : 500))]);
    if (token.current !== mine) return; // the era changed or a newer question started
    setBusy(false);
    if (!result.ok) {
      dispatch({ type: "DONE" });
      setError({ question: text, code: result.code, message: result.message, retryAfterSec: result.retryAfterSec });
      setStatus(`The ghost could not answer. ${result.message}`);
      return;
    }
    addEvidence(result.evidence);
    const id = nextId.current++;
    setItems((list) => [...list, { type: "turn", turn: { id, q: text, eraIdx: asked, reply: result.reply } }]);
    setStatus(`The ghost answers: ${result.reply.segments.map((s) => s.text).join(" ")}`);
    if (reduced) {
      dispatch({ type: "DONE" });
    } else {
      setRevealId(id);
      dispatch({ type: "SPEAK" });
    }
  };

  // Beats are fixed when the encounter opens (the form and first line of the era the visitor arrived in).
  const beats = useMemo(
    () => (meeting && !meeting.met ? encounterBeats(g, form, meeting.via, era?.ghostLine ?? "") : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the opening is written once, when the meeting is known
    [meeting],
  );
  // Asking a question or choosing a memory during the opening also ends it.
  const introOver = introDone || items.length > 0 || meeting?.met === true;
  const finishIntro = useCallback(() => {
    setIntroDone(true);
    markMet(g.repo.fullName);
  }, [g.repo.fullName]);
  useEffect(() => {
    if (items.length) markMet(g.repo.fullName);
  }, [items.length, g.repo.fullName]);
  const nextBeat = () => {
    playSfx("open");
    if (beats && introStep < beats.length - 1) setIntroStep((s) => s + 1);
  };

  /** A scripted line from the ghost (no model, no facts), shown as an ordinary turn. */
  const sayLocally = (q: string, segments: ReplySegment[]) => {
    playSfx("open");
    const id = nextId.current++;
    setItems((list) => [...list, { type: "turn", turn: { id, q, eraIdx, reply: { segments, sources: [] } } }]);
    setStatus(`The ghost answers: ${segments.map((s) => s.text).join(" ")}`);
    if (reduced) return;
    setRevealId(id);
    dispatch({ type: "SPEAK" });
  };

  // Possession: the ghost's code over the scene. `path` null is its body (the file list).
  const [body, setBody] = useState<{ path: string | null; lines: Lines } | null>(null);
  const shownBody = useRef(false);
  const code = useMemo(() => codeSource({ mode: g.mode, repo: g.repo }), [g.mode, g.repo]);
  const codeAt = past ? (era?.fullSha ?? null) : null;
  const openBody = () => {
    closeDrawers();
    setBody({ path: null, lines: null });
    if (!shownBody.current) {
      shownBody.current = true;
      sayLocally("Show me your code.", bodyReply(form));
    }
  };
  // The Specialist: a deep reading of the chosen code by a stronger model, asked for explicitly, at the era's exact commit.
  const [record, setRecord] = useState<CodeRecord | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const canAskSpecialist = g.specialist && !!body?.path && askable(body.path) && !!era?.fullSha;
  const askTheSpecialist = async (question?: string) => {
    if (!body?.path || !era?.fullSha || busy) return;
    const path = body.path, lines = body.lines;
    playSfx("open");
    setRecordOpen(false);
    setBusy(true);
    setError(null);
    dispatch({ type: "LISTEN" });
    const asked = question ?? `Specialist, read ${path}${lines ? `:${lines.from}${lines.to > lines.from ? `-${lines.to}` : ""}` : ""} for me.`;
    const r = await askSpecialist({ owner: g.repo.owner, repo: g.repo.name, path, at: era.fullSha, ...(lines ? { from: lines.from, to: lines.to } : {}), ...(question ? { question } : {}), stage });
    setBusy(false);
    const id = nextId.current++;
    // Facts reach the dialogue only as the validated summary (a reading); the ghost's own lines carry no facts.
    const segments: ReplySegment[] = r.ok
      ? [...r.record.framing.map((t): ReplySegment => ({ kind: "ghost", text: t, cites: [] })), { kind: "reading", text: r.record.findings.summary, cites: [] }]
      : [{ kind: "unknown", text: r.message, cites: [] }];
    if (r.ok) setRecord(r.record);
    setItems((list) => [...list, { type: "turn", turn: { id, q: asked, eraIdx, reply: { segments, sources: [] } } }]);
    setStatus(r.ok ? `The Specialist has read ${path}. ${r.record.findings.summary} Open the Code Record for its observations and source links.` : r.message);
    if (reduced) dispatch({ type: "DONE" });
    else {
      setRevealId(id);
      dispatch({ type: "SPEAK" });
    }
  };
  const codeChoices: Choice[] | null = body
    ? [
        ...(body.path && askable(body.path) ? codeQuestions(body.path, body.lines).map((q): Choice => ({ id: `code-${q.id}`, label: q.label })) : []),
        ...(canAskSpecialist ? [{ id: "code-specialist", label: "Ask the Specialist" } as Choice] : []),
        ...(record && record.path === body.path ? [{ id: "code-record", label: "Read the Code Record" } as Choice] : []),
        { id: "leave", label: "Leave its code" },
      ]
    : null;

  const choose = (c: Choice) => {
    finishIntro();
    if (c.id === "other") {
      inputRef.current?.focus();
      return;
    }
    if (c.id === "body") return openBody();
    if (c.id === "leave") return setBody(null);
    if (c.id === "code-specialist") return void askTheSpecialist();
    if (c.id === "code-record") {
      playSfx("open");
      return setRecordOpen(true);
    }
    if (c.id === "code-what" || c.id === "code-why" || c.id === "code-when") {
      const q = body?.path ? codeQuestions(body.path, body.lines).find((x) => `code-${x.id}` === c.id) : null;
      if (q) void submit(q.question);
      return;
    }
    void submit(c.label);
  };

  const cite = (ids: string[]) => {
    playSfx("open");
    setRecordIds(ids);
  };

  // Escape closes the phone drawers (a native dialog handles its own Escape).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawers();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDrawers]);

  // Phone drawers: move focus in on open, back to the opener on close.
  const wasOpen = useRef({ a: false, r: false });
  useEffect(() => {
    const small = window.matchMedia("(max-width: 1023px)").matches;
    if (small) {
      if (archiveOpen && !wasOpen.current.a) archiveHead.current?.focus();
      if (!archiveOpen && wasOpen.current.a) archiveBtn.current?.focus();
      if (journalOpen && !wasOpen.current.r) journalHead.current?.focus();
      if (!journalOpen && wasOpen.current.r) journalBtn.current?.focus();
    }
    wasOpen.current = { a: archiveOpen, r: journalOpen };
  }, [archiveOpen, journalOpen]);

  const flame = form === "human" ? "/scene/flame-warm.png" : "/scene/flame-ghostly.png";
  const horror = form !== "human";
  const transforming = seq.playing?.name === "transform";

  return (
    <div className="v4" data-vitality={g.vitality} data-stage={stage} data-form={form} data-tone={tone} data-anim={anim.state} data-frozen={frozen || undefined} data-mode={g.mode} data-arrive={arriving || undefined} data-testid="v4">
      <header className="v4-top">
        <LeaveLink className="rpg-btn !min-h-11 !px-3 !text-xs" label="Back to the graveyard"><span aria-hidden="true">←<span className="v4-hide-s"> </span></span><span className="v4-hide-s" aria-hidden="true">Graveyard</span></LeaveLink>
        <p className="v4-title">GitGhost {g.mode === "mock" ? <span className="v4-quiet">demo</span> : null}</p>
        {live ? (
          <p className="v4-banner" role="note" data-testid="live-banner">
            {dev ? <><span className="rpg-tag tag-record v4-mock">Live</span> {g.repo.fullName} · replies: </> : null}
            {g.replyMode === "model" ? "AI replies · each one labelled" : g.replyMode === "unavailable" ? "Replies unavailable" : "Scripted replies · no AI"}
          </p>
        ) : (
          <p className="v4-banner" role="note" data-testid="mock-banner"><MockBadge /> Invented data. No real repository. No AI model.</p>
        )}
        <span className="v4-spacer" />
        <SoundToggle />
        <button ref={archiveBtn} type="button" className="rpg-btn !min-h-11 !px-3 !text-xs v4-only-small" aria-expanded={archiveOpen} onClick={() => { setArchiveOpen((o) => !o); setJournalOpen(false); }}>Archive</button>
        <button ref={journalBtn} type="button" className="rpg-btn !min-h-11 !px-3 !text-xs v4-only-small" aria-expanded={journalOpen} onClick={() => { setJournalOpen((o) => !o); setArchiveOpen(false); }} data-testid="journal-button">Journal</button>
      </header>

      <aside className="v4-left rpg-panel" data-open={archiveOpen} aria-label="Haunted Archive">
        <div className="v4-side-head">
          <h2 ref={archiveHead} tabIndex={-1} className="rpg-title">Haunted Archive</h2>
          <button type="button" className="rpg-btn !min-h-11 !px-3 !text-xs v4-only-small" onClick={() => setArchiveOpen(false)}>Close</button>
        </div>
        <ArchiveSummary form={form} emotion={shownEmotion} eraIdx={eraIdx} />
        <button type="button" className="rpg-btn v4-body-btn" onClick={openBody} aria-pressed={!!body} data-testid="open-body">Read its code</button>
        {tools ? (
          <ToolsPanel
            expr={shownEmotion}
            onExpr={(e) => { setExprOverride(e); setStatus(`Expression preview: ${e}.`); }}
            onTwitch={playTwitch}
            onTransform={() => { setExprOverride(null); playTransform("human", "horror"); setStatus("Transformation preview: human to horror."); }}
            onGlitch={triggerGlitch}
          />
        ) : null}
      </aside>

      <main id="main" className="v4-center">
        <div className="v4-stage" data-scene={g.scene ?? "graveyard"} data-tone={tone} data-rewinding={rewinding || undefined} data-transforming={transforming || undefined} data-emotion={shownEmotion} data-possessed={body ? true : undefined} data-testid="v4-stage">
          <div className="v4-world" aria-hidden="true">
            <div className="enc-layer enc-sky" />
            <div className="enc-layer enc-far" />
            <div className="enc-layer enc-mid" />
            <span className="enc-light enc-moonlight" />
            <span className="enc-light enc-lamplight" />
            <span className="enc-ash" />
          </div>
          {form === "horror" && !transforming ? <WatchingEyes /> : null}
          <div className="v4-world v4-world-front">
            <div className="enc-ghost v4-ghost">
              <div className="v4-ghostwrap" data-state={anim.state} data-playing={seq.playing?.name}>
                <V4Ghost sprite={g.sprite ?? "archivist"} form={form} expr={shownEmotion} frame={frame ?? { kind: "atlas", state: "idle" }} talking={talking && !frame} bob={!frame} label={`${g.ghostName}, a fictional ghost. ${STAGE_LABELS[stage].label}. Expression: ${shownEmotion}.`} />
                {!transforming ? <BloodDrips form={form} sprite={g.sprite ?? "archivist"} /> : null}
                {form === "horror" && !transforming ? <HorrorBleed /> : null}
                {flash ? (
                  <div className="v4-flash" aria-hidden="true">
                    <V4Ghost sprite={g.sprite ?? "archivist"} form="human" expr="neutral" decorative bob={false} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="enc-layer enc-fog enc-fog-back" aria-hidden="true" />
            <div className="enc-layer enc-near" aria-hidden="true" />
            <div className="enc-layer enc-fog enc-fog-front" aria-hidden="true" />
            {/* eslint-disable-next-line @next/next/no-img-element -- pixel art, must not be resampled */}
            <img className="enc-flame" src={flame} alt="" width={8} height={12} aria-hidden="true" />
          </div>
          <div className="v4-tone" aria-hidden="true" />
          <div className="v4-sweep" aria-hidden="true" />
          <div className="v4-vignette" data-horror={horror || undefined} aria-hidden="true" />
          <p className="v4-era" data-testid="era-chip" data-past={past || undefined}>
            {era ? (
              <>
                <span className="v4-sha">{era.sha}</span> <span>{era.date}</span> <span className="v4-quiet">{eraIdx === lastIdx ? "present" : "older era"}</span>
              </>
            ) : (
              <span className="v4-quiet">no commits could be read</span>
            )}{" "}
            {/* the header banner carries the Mock label on wider screens; phones hide that banner, so the label shows here */}
            <MockBadge className="v4-phone-only" />
          </p>
          {rewinding ? <p className="v4-rewind-label" aria-hidden="true">◀◀ REWIND</p> : null}
          {body ? (
            <Possession
              source={code} at={codeAt} path={body.path} lines={body.lines}
              marks={record && record.path === body.path ? record.findings.observations : []}
              onOpen={(path) => setBody({ path, lines: null })}
              onSelect={(lines) => setBody((b) => (b ? { ...b, lines } : b))}
              onAsk={() => { const q = body.path && askable(body.path) ? codeQuestions(body.path, body.lines)[0] : null; if (q && !busy) void submit(q.question); }}
              onLeave={() => setBody(null)}
            />
          ) : null}
        </div>
        <Dialogue
          eraIdx={eraIdx} form={form} expr={shownEmotion} frame={frame} talking={talking} corrupt={corrupt && horror}
          items={items} revealId={revealId} busy={busy} reduced={reduced} draft={draft} inputRef={inputRef} error={error} onRetry={() => error && void submit(error.question)}
          onDraft={(v) => { setDraft(v); dispatch({ type: v.trim() ? "LISTEN" : "DONE" }); }}
          onAsk={(q) => void submit(q)}
          onRevealDone={(id) => { setRevealId((r) => (r === id ? null : r)); dispatch({ type: "DONE" }); }}
          onCite={cite}
          intro={beats ? { beats, step: introStep, done: introOver, onNext: nextBeat, onDone: finishIntro } : null}
          choices={introOver && !busy && revealId === null ? (codeChoices ?? choicesFor(g.vitality)) : null}
          onChoose={choose}
        />
      </main>

      <aside className="v4-right rpg-panel" data-open={journalOpen} aria-label="Memory Journal">
        <div className="v4-side-head">
          <h2 ref={journalHead} tabIndex={-1} className="rpg-title">Memory Journal</h2>
          <button type="button" className="rpg-btn !min-h-11 !px-3 !text-xs v4-only-small" onClick={() => setJournalOpen(false)}>Close</button>
        </div>
        {past ? <button type="button" className="v4-return v4-return-panel" onClick={() => selectMemory(lastIdx)} data-testid="return-chip">Return to present</button> : null}
        <MemoryJournal eraIdx={eraIdx} onSelect={selectMemory} />
      </aside>

      {archiveOpen || journalOpen ? <button type="button" className="v4-backdrop" aria-label="Close panel" tabIndex={-1} onClick={closeDrawers} /> : null}

      <Drawer title="Code Record" open={recordOpen && !!record} onOpenChange={setRecordOpen} testId="code-record-drawer">
        {record ? <CodeRecordBody record={record} busy={busy} onFollowUp={(q) => void askTheSpecialist(q)} /> : null}
      </Drawer>
      <Drawer title="Records" open={recordIds !== null} onOpenChange={(o) => !o && setRecordIds(null)} testId="evidence-drawer">
        {recordIds ? <RecordsBody ids={recordIds} /> : null}
      </Drawer>

      {arriving ? (
        <div className="v4-arrive" aria-hidden="true" data-testid="v4-arrive">
          <PixelWipe mode="open" pattern="spiral" ms={900} delay={150} />
          <p className="v4-arrive-card" data-alive={g.vitality === "alive" || undefined}><span>{g.vitality === "alive" ? "Someone is still here" : "A ghost appears"}</span><b>{g.ghostName}</b></p>
        </div>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite" data-testid="v4-status">{status}</p>
      {g.mode === "mock" ? <p className="sr-only">{g.repo.fullName} is an invented repository.</p> : null}
    </div>
  );
}
