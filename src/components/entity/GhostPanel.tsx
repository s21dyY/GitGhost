"use client";

import { useId, useState } from "react";
import { EncounterStage } from "@/components/encounter/EncounterStage";
import { GhostSprite } from "./archivist/GhostSprite";
import { describeArchivist, STAGE_LABELS } from "./archivist/describe";
import { composeOverlays, POSES, STAGES, type Pose, type Stage } from "./archivist/sprites";
import { useGhostForm } from "./GhostFormContext";
import type { EntityAssignment } from "@/domain/entity";
import { PROVISIONAL_TEXT } from "./provisional";

export type { ProvisionalReason } from "./provisional";
import type { ProvisionalReason } from "./provisional";

export type GhostView =
  | { status: "persisted"; assignment: EntityAssignment }
  | { status: "provisional"; assignment: EntityAssignment; reason?: ProvisionalReason }
  | { status: "error"; message: string };

/** What the nameplate shows. All values come from the GitHub retrieval, never from the entity config. */
export type Nameplate = { owner: string; name: string; statusLabel: string; statusDefinition: string; statusTone: "archived" | "quiet" | "active" | "unknown" };

const POSE_LABELS: Record<Pose, string> = { idle: "Idle", thinking: "Thinking", speaking: "Speaking", blink: "Blink" };



export const STATUS_TEXT: Record<Nameplate["statusTone"], string> = { archived: "text-crimson", quiet: "text-violet", active: "text-fog", unknown: "text-bone" };

function Radio<T extends string>({
  name, value, current, label, onChange,
}: { name: string; value: T; current: T; label: string; onChange: (v: T) => void }) {
  return (
    <label className="font-label cursor-pointer border-2 border-stone-edge px-2 py-1 text-xs has-[:checked]:border-gold has-[:checked]:text-gold has-[:focus-visible]:outline-4 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-bone">
      <input type="radio" name={name} value={value} checked={current === value} onChange={() => onChange(value)} className="sr-only" />
      {label}
    </label>
  );
}

/** Development-only controls. Never rendered unless the server says it is running `next dev`. */
function DevTools({
  uid, assignment, stage, setStage, pose, setPose, unsupported,
}: {
  uid: string; assignment: EntityAssignment; stage: Stage; setStage: (s: Stage) => void;
  pose: Pose; setPose: (p: Pose) => void; unsupported: string[];
}) {
  const a = assignment;
  return (
    <div className="mt-4 border-2 border-dashed border-violet bg-night/90 p-3 text-left" data-testid="dev-tools">
      <p className="text-sm font-bold text-violet">Development only. Not shown in production.</p>
      <fieldset className="mt-2">
        <legend className="text-sm text-bone/85">Form</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {STAGES.map((s) => (
            <Radio key={s} name={`${uid}-stage`} value={s} current={stage} label={STAGE_LABELS[s].label} onChange={setStage} />
          ))}
        </div>
      </fieldset>
      <fieldset className="mt-2">
        <legend className="text-sm text-bone/85">Preview state</legend>
        <div className="mt-1 flex flex-wrap gap-1">
          {POSES.map((p) => (
            <Radio key={p} name={`${uid}-pose`} value={p} current={pose} label={POSE_LABELS[p]} onChange={setPose} />
          ))}
        </div>
      </fieldset>
      {unsupported.length ? <p className="mt-2 text-sm text-bone/85">Not drawn yet: {unsupported.join(", ")}.</p> : null}
      <details className="mt-2 text-sm text-bone/85">
        <summary className="cursor-pointer">Technical identity record</summary>
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
          <dt>Origin</dt><dd>{a.originId}</dd>
          <dt>Voice</dt><dd>{a.voiceId}</dd>
          <dt>Temperament</dt><dd>{a.temperamentId}</dd>
          <dt>Overlays</dt><dd>{a.mutationParts.join(", ") || "none"}</dd>
          <dt>Current form</dt><dd>{a.currentStage}</dd>
          <dt>Config version</dt><dd>{a.schemaVersion}</dd>
          <dt>Seed</dt><dd className="break-all">{a.seed}</dd>
        </dl>
      </details>
    </div>
  );
}

/** Which form and pose the ghost shows right now. Dev previews apply only when the page says so. */
export function useGhostLook(view: GhostView, devTools: boolean): { stage: Stage; pose: Pose } {
  const { form, chatPose, devStage, devPose } = useGhostForm();
  const initialStage: Stage = view.status === "error" ? "distorted" : view.assignment.currentStage;
  const stage: Stage = form === "human" ? "human" : devTools && devStage ? devStage : initialStage;
  const pose: Pose = devTools && devPose !== "idle" ? devPose : chatPose;
  return { stage, pose };
}

/** The encounter itself: the haunted graveyard with the ghost standing in it. Fixed behind everything else. */
export function GhostScene({ view, devTools = false }: { view: GhostView; devTools?: boolean }) {
  const { stage, pose } = useGhostLook(view, devTools);
  const horror = stage !== "human";
  // Restart the short transformation flash whenever the form changes (render-phase derivation, no effect).
  const [prevStage, setPrevStage] = useState(stage);
  const [morph, setMorph] = useState(0);
  if (prevStage !== stage) {
    setPrevStage(stage);
    setMorph((m) => m + 1);
  }
  if (view.status === "error") return <EncounterStage form="human">{null}</EncounterStage>;
  return (
    <EncounterStage form={horror ? "horror" : "human"}>
      <div key={morph} data-form={horror ? "horror" : "human"} className={`${morph > 0 ? "ghost-morph" : ""} ${horror ? "ghost-glitch" : ""}`}>
        <GhostSprite stage={stage} pose={pose} mutationIds={view.assignment.mutationParts} className="ghost-fig" />
      </div>
    </EncounterStage>
  );
}

/** Two states of one character: how it looked before, and how it looks now. Compact; the full names are the accessible names. */
export function FormToggle() {
  const { form, setForm } = useGhostForm();
  return (
    <div role="group" aria-label="Ghost form" className="flex">
      <button type="button" aria-pressed={form === "human"} aria-label="Before the forgetting" onClick={() => setForm("human")} className="rpg-btn !min-h-11 !px-3 !text-xs">
        Before
      </button>
      <button type="button" aria-pressed={form === "current"} aria-label="As it is now" onClick={() => setForm("current")} className="rpg-btn !min-h-11 !px-3 !text-xs">
        Now
      </button>
    </div>
  );
}

/** Short badges for things a visitor must not miss. Each carries a word, not just a color. */
export function GhostBadges({ view }: { view: GhostView }) {
  if (view.status === "error") return null;
  const standIn = view.assignment.originId !== "archivist";
  return (
    <>
      {view.status === "provisional" ? (
        <span className="rpg-tag tag-missing !mr-0" title={PROVISIONAL_TEXT[view.reason ?? "store_unavailable"]}>
          Look not saved
        </span>
      ) : null}
      {standIn ? (
        <span className="rpg-tag tag-reading !mr-0" title="Art for this ghost's origin is not drawn yet, so a stand-in figure is shown.">
          Stand-in art
        </span>
      ) : null}
    </>
  );
}

/** Everything the encounter no longer needs on screen: honesty notes, the form description, dev controls. Lives in the Archive. */
export function GhostNotes({ view, devTools = false }: { view: GhostView; devTools?: boolean }) {
  const uid = useId();
  const { setForm, devStage, setDevStage, devPose, setDevPose } = useGhostForm();
  const { stage } = useGhostLook(view, devTools);
  if (view.status === "error") {
    return (
      <div role="status" className="text-base">
        <p className="font-bold text-crimson">Ghost unavailable</p>
        <p className="mt-1">{view.message}</p>
      </div>
    );
  }
  const a = view.assignment;
  const standIn = a.originId !== "archivist";
  const { summary, traits } = describeArchivist(stage, a.mutationParts);
  const { unsupported } = composeOverlays(stage, a.mutationParts);
  const note = STAGE_LABELS[stage].note;
  const setStage = (s: Stage) => {
    if (s === "human") setForm("human");
    else {
      setForm("current");
      setDevStage(s);
    }
  };
  void devStage;
  return (
    <section aria-label="About this ghost" className="space-y-2 text-base">
      <p className="font-label text-sm text-gold" aria-live="polite">{STAGE_LABELS[stage].label}</p>
      {note ? <p className="text-violet">{note}</p> : null}
      <p>Two states of the same ghost: how it looked before the forgetting, and how it looks now.</p>
      <p className="text-bone/95">Fictional ghost. Its look is imagined from repository metadata, not from any real person.</p>
      {view.status === "persisted" ? (
        <p className="text-fog">Identity saved: this ghost keeps the same look on every visit.</p>
      ) : (
        <p role="status" className="text-crimson">Provisional appearance: {PROVISIONAL_TEXT[view.reason ?? "store_unavailable"]}</p>
      )}
      {standIn ? <p role="status" className="text-violet">Art for this ghost&apos;s origin is not drawn yet, so a stand-in figure is shown.</p> : null}
      <details>
        <summary className="font-label cursor-pointer text-xs text-gold">Describe the apparition</summary>
        <p className="mt-1">{summary}</p>
        {traits.length ? <p className="mt-1">Details: {traits.join("; ")}.</p> : null}
      </details>
      {devTools ? (
        <DevTools uid={uid} assignment={a} stage={stage} setStage={setStage} pose={devPose === "blink" ? "blink" : devPose} setPose={(p) => setDevPose(p)} unsupported={unsupported} />
      ) : null}
    </section>
  );
}
