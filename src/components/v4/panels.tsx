"use client";

import { STAGE_LABELS } from "@/components/entity/archivist/describe";
import { EmotionGlyph } from "./icons";
import { EMOTIONS, EMOTION_LABEL, type Emotion } from "./fixtures";
import { chipLabel, useGame } from "./game-context";
import { playSfx } from "@/lib/sound";
import { useDevMode } from "./dev";
import { SCENE_PLACE } from "./scene-theme";
import type { Form } from "./V4Ghost";

const MANIFEST_LABEL: Record<Form, string> = { human: "Before the forgetting", distorted: "Gory", horror: "Eldritch" };
const KIND_LABEL: Record<string, string> = {
  commit: "Commit",
  readme: "README",
  issue: "Issue",
  "pull-request": "Pull request",
  "issue-comment": "Issue comment",
  "repo-metadata": "Repository record",
};

/** The honesty marker: shown on every screen that carries invented data, and nowhere else. */
export function MockBadge({ className = "" }: { className?: string }) {
  const g = useGame();
  if (g.mode !== "mock") return null;
  return <span className={`rpg-tag tag-reading v4-mock ${className}`} title="All data on this screen is invented">Mock</span>;
}

/** A tiny seal drawn in pixels (9 x 9): the quiet mark that says "there are records behind this line". */
function Seal() {
  const rows = ["..XXXXX..", ".X.....X.", "X..XXX..X", "X.X...X.X", "X.X.X.X.X", "X.X...X.X", "X..XXX..X", ".X.....X.", "..XXXXX.."];
  return (
    <svg viewBox="0 0 9 9" width="12" height="12" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "X" ? <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  );
}

/**
 * The quiet way to reach the proof. A small seal after a line; it opens the records behind that line (type, text,
 * GitHub link) in a drawer. It never navigates away and takes almost no room in the reading flow.
 */
export function CiteChip({ ids, onCite }: { ids: string[]; onCite: (ids: string[]) => void }) {
  const g = useGame();
  if (ids.length === 0) return null;
  const labels = ids.map((id) => chipLabel(g, id)).join(", ");
  return (
    <button type="button" className="v4-cite" onClick={() => onCite(ids)} aria-label={`Open records for this line: ${labels}`} aria-haspopup="dialog" title="Records">
      <Seal />
    </button>
  );
}

/** The records drawer: every source behind one line, each with its own heading. */
export function RecordsBody({ ids }: { ids: string[] }) {
  const g = useGame();
  return (
    <div className="v4-records" data-testid="records">
      {ids.map((id) => (
        <section key={id} aria-labelledby={`rec-${id}`}>
          <h3 id={`rec-${id}`} className="v4-h">{chipLabel(g, id)}</h3>
          <EvidenceDetail id={id} />
        </section>
      ))}
    </div>
  );
}

/** Left panel: short and atmospheric. Archetype and identity notes only appear with ?dev=1. */
export function ArchiveSummary({ form, emotion, eraIdx }: { form: Form; emotion: Emotion; eraIdx: number }) {
  const g = useGame();
  const dev = useDevMode();
  const last = Math.max(0, g.eras.length - 1);
  const era = g.eras[eraIdx];
  const past = g.mode === "live" && eraIdx < last;
  return (
    <div className="v4-archive" data-testid="archive">
      <section aria-labelledby="v4-id-h">
        <h3 id="v4-id-h" className="v4-h">Haunting <MockBadge /></h3>
        <p className="v4-big" data-testid="repo-name">{g.repo.fullName}</p>
        <p className="v4-place" data-testid="place">Haunts {SCENE_PLACE[g.scene ?? "graveyard"]}</p>
        {g.repo.description ? <p className="v4-quiet v4-clamp">{g.repo.description}</p> : null}
        {g.repo.url ? (
          <p><a href={g.repo.url} target="_blank" rel="noopener noreferrer" className="v4-link">View on GitHub<span className="sr-only"> (opens in a new tab)</span> ↗</a></p>
        ) : null}
        <dl className="v4-dl">
          <dt>Status</dt><dd data-testid="status-line">{past ? "Hidden in older eras." : g.statusLine}</dd>
          <dt>Era</dt><dd>{era ? `${era.sha}, ${era.date}${past ? " (older)" : ""}` : "no commit"}</dd>
        </dl>
      </section>
      {dev ? (
        <section aria-labelledby="v4-sr-id">
          <h3 id="v4-sr-id" className="v4-h" data-testid="ghost-name">{g.ghostName}</h3>
          <p className="v4-quiet">A fictional ghost. {g.archetype}{g.sprite && g.sprite !== "archivist" ? `, drawn as the ${g.sprite}` : ""}. Scene: {g.scene ?? "graveyard"}.</p>
          <p className="v4-quiet" data-testid="identity-state">
            {g.identity.state === "saved" ? "Identity saved: the same ghost every visit." : g.identity.state === "provisional" ? g.identity.note : "Invented fixture."}
          </p>
          <p className="v4-emotion" data-testid="emotion"><EmotionGlyph emotion={emotion} scale={3} /> <span>{EMOTION_LABEL[emotion]}</span></p>
          <p className="v4-quiet" data-testid="manifestation">{MANIFEST_LABEL[form]}. Its look in each era is a storytelling convention, not a finding.</p>
        </section>
      ) : null}
    </div>
  );
}

/** "9 years", "7 months", "12 days": the span between the first and last commit dates shown. */
function spanText(from: string, to: string): string | null {
  const a = Date.parse(from), b = Date.parse(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const days = Math.round((b - a) / 86_400_000);
  const unit = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (days >= 730) return unit(Math.floor(days / 365), "year");
  if (days >= 60) return unit(Math.floor(days / 30), "month");
  return unit(days, "day");
}

/** Right panel: the life of the repository as a vertical timeline, newest first. Selecting a point is the only way to move through time. */
export function MemoryJournal({ eraIdx, onSelect }: { eraIdx: number; visited?: number[]; onSelect: (i: number) => void }) {
  const g = useGame();
  const dev = useDevMode();
  const eras = g.eras;
  const last = Math.max(0, eras.length - 1);
  const era = eras[eraIdx];
  const past = eras.length > 0 && eraIdx < last;
  const order = eras.map((_, i) => i).reverse();
  const span = eras.length > 1 ? spanText(eras[0].date, eras[last].date) : null;
  const total = g.history.total;
  return (
    <div className="v4-journal" data-testid="journal">
      <div className="v4-journal-top">
        {eras.length > 0 ? (
          <div className="v4-life" data-testid="life-summary">
            <p className="v4-life-row"><span className="v4-quiet">Earliest</span> <span className="v4-date">{eras[0].date}</span></p>
            <p className="v4-life-row"><span className="v4-quiet">Last commit</span> <span className="v4-date">{eras[last].date}</span></p>
            <p className="v4-life-row v4-quiet">
              {span ? `${span} of life` : "A single point in time"}
              {total && total > eras.length ? ` · ${eras.length} of ${total.toLocaleString("en-US")} commits` : ` · ${eras.length} commit${eras.length === 1 ? "" : "s"}`}
            </p>
          </div>
        ) : null}
        {past && era ? (
          <div className="v4-past" role="status" data-testid="past-banner">
            <p><strong>An older memory.</strong> It knows nothing after <span className="v4-sha">{era.sha}</span>.</p>
          </div>
        ) : era ? (
          <p className="v4-quiet" data-testid="present-note">The present. Choose a point to go back.</p>
        ) : null}
        {era ? (
          <div className="v4-context" data-testid="journal-context">
            <p className="v4-msg">{era.message}</p>
            {era.url ? <p><a href={era.url} target="_blank" rel="noopener noreferrer" className="v4-link">This commit on GitHub<span className="sr-only"> (opens in a new tab)</span> ↗</a></p> : null}
          </div>
        ) : null}
        {eras.length === 0 ? <p className="v4-quiet">No commits could be read for this repository, so there is nothing to browse.</p> : null}
      </div>
      <ol className="v4-memories v4-timeline" aria-label={`Timeline of commits, newest first (${eras.length} shown)`}>
        {order.map((i) => {
          const e = eras[i];
          const selected = i === eraIdx;
          return (
            <li key={e.id}>
              <button type="button" className="v4-memory" aria-current={selected ? "true" : undefined} data-selected={selected || undefined} data-present={i === last || undefined} onClick={() => onSelect(i)} onMouseEnter={() => playSfx("hover")} data-testid={`era-${i}`}>
                <span className="v4-node-dot" aria-hidden="true" />
                <span className="v4-date">{e.date}</span>
                <span className="v4-msg">{e.message}</span>
                <span className="v4-quiet v4-memory-tags">
                  <span className="v4-sha">{e.sha}</span>
                  {i === last ? " · Last commit · Present" : i === 0 ? " · Earliest read" : ""}
                  {dev ? ` · ${STAGE_LABELS[e.stage].label}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What is inside one piece of evidence: type, identifier, retrieved text, the GitHub page, and the era it was read for. */
export function EvidenceDetail({ id }: { id: string }) {
  const g = useGame();
  const e = g.allEvidence.find((x) => x.id === id);
  if (!e) return <p className="v4-quiet">That source is not available.</p>;
  const last = Math.max(0, g.eras.length - 1);
  const era = g.eras[Math.min(e.since, last)];
  const context =
    g.mode === "mock"
      ? "Invented fixture. It has no GitHub page."
      : e.source === "answer"
        ? e.since < last && era
          ? `Read for the era of commit ${era.sha} (${era.date}). Nothing after that commit was used.`
          : "Read from the present repository."
        : e.since < last && era
          ? `This exists at commit ${era.sha} (${era.date}) and in every later era.`
          : "Present-day record, retrieved from GitHub when the page opened.";
  return (
    <div className="v4-evdetail" data-testid="evidence-detail">
      <dl className="v4-dl">
        <dt>Type</dt><dd>{KIND_LABEL[e.kind] ?? e.kind}</dd>
        <dt>Source</dt><dd>{g.mode === "mock" ? `${e.id} ${e.label}` : e.label}{e.revision ? ` at ${e.revision}` : ""}</dd>
      </dl>
      <h3 className="v4-h">Retrieved text</h3>
      <p className="v4-excerpt" data-testid="evidence-excerpt">{e.excerpt || "(no text was kept)"}</p>
      <h3 className="v4-h">Context</h3>
      <p className="v4-quiet">{context}</p>
      <p>
        {e.url ? (
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="v4-link" data-testid="evidence-link">Open on GitHub<span className="sr-only"> (opens in a new tab)</span> ↗</a>
        ) : (
          <span className="v4-quiet">Source: mock fixture, no link.</span>
        )}
      </p>
    </div>
  );
}

/** Review-only controls for the offline demo and the prototype. Never shown for a live repository. */
export function ToolsPanel({ expr, onExpr, onTwitch, onTransform, onGlitch }: { expr: Emotion; onExpr: (e: Emotion) => void; onTwitch: () => void; onTransform: () => void; onGlitch: () => void }) {
  return (
    <details className="v4-tools" data-testid="tools" open>
      <summary className="v4-quiet">Prototype tools</summary>
      <div role="group" aria-label="Preview expression" className="v4-tabs">
        {EMOTIONS.map((e) => (
          <button key={e} type="button" className="v4-tab" aria-pressed={expr === e} onClick={() => onExpr(e)} data-testid={`expr-${e}`}>{EMOTION_LABEL[e]}</button>
        ))}
      </div>
      <div className="v4-tool-row">
        <button type="button" className="rpg-btn !text-xs" onClick={onTwitch} data-testid="tool-twitch">Twitch + freeze</button>
        <button type="button" className="rpg-btn !text-xs" onClick={onTransform} data-testid="tool-transform">Transform</button>
        <button type="button" className="rpg-btn !text-xs" onClick={onGlitch} data-testid="tool-glitch">Rare glitch</button>
      </div>
    </details>
  );
}
