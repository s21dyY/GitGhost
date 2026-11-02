"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GhostSprite } from "@/components/entity/archivist/GhostSprite";
import type { Stage } from "@/components/entity/archivist/sprites";
import { useReducedMotion } from "./anim";
import { FORM_INDEX, transformSteps, TWITCH, useSequencer } from "./sequence";
import { BloodDrips, DRIP_ART, EXPR_LABEL, EXPRS, FORM_LABEL, FORMS, STATES, TRANSFORM_FRAMES, V4Ghost, type Expr, type Form, type Frame } from "./V4Ghost";
import "./v4.css";

const BEFORE: Record<Form, Stage> = { human: "human", distorted: "distorted", horror: "transformed" };

/** Art review page for the character milestone. Invented, fictional character only; no repository data. */
export function ArtLab() {
  const reduced = useReducedMotion();
  return (
    <div className="v4lab" data-testid="art-lab">
      <header className="v4lab-top">
        <Link href="/prototype/v4" className="rpg-btn !min-h-11 !px-3 !text-xs"><span aria-hidden="true">← </span>Prototype</Link>
        <h1 className="rpg-title">Character art lab</h1>
        <p className="v4-quiet">Fictional character, no repository data. Pixel size on this page is the in-game size: 4 px per art pixel on a laptop, 3 px on a phone.</p>
      </header>
      <main id="main">
        <section aria-labelledby="ba-h" data-testid="before-after">
          <h2 id="ba-h" className="v4-h">Before and after: the same character</h2>
          <div className="v4lab-ba">
            {FORMS.map((f) => (
              <div key={f} className="v4lab-pair">
                <figure>
                  <div className="v4lab-frame"><GhostSprite stage={BEFORE[f]} pose="idle" mutationIds={[]} className="v4lab-before" /></div>
                  <figcaption>Before · {FORM_LABEL[f]}</figcaption>
                </figure>
                <figure>
                  <div className="v4lab-frame" data-after><V4Ghost form={f} expr="neutral" bob={false} /></div>
                  <figcaption>After · {FORM_LABEL[f]}</figcaption>
                </figure>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="ex-h" data-testid="expressions">
          <h2 id="ex-h" className="v4-h">Three forms, six expressions</h2>
          <p className="v4-quiet">Each row is one form. Each column is one expression, drawn at the in-game pixel size.</p>
          <div className="v4lab-grid">
            {FORMS.map((f) => (
              <div key={f} className="v4lab-row" data-form={f}>
                <h3 className="v4-sub">{FORM_LABEL[f]}</h3>
                <div className="v4lab-cells">
                  {EXPRS.map((e) => (
                    <figure key={e}>
                      <div className="v4lab-frame"><V4Ghost form={f} expr={e} bob={false} /></div>
                      <figcaption>{EXPR_LABEL[e]}</figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="an-h" data-testid="animations">
          <h2 id="an-h" className="v4-h">Three signature animations</h2>
          {reduced ? <p className="v4-quiet" role="note">Reduced motion is on: the sequences below resolve instantly and the still frames are shown instead.</p> : null}
          <BloodDemo />
          <TwitchDemo reduced={reduced} />
          <TransformDemo reduced={reduced} />
        </section>
      </main>
    </div>
  );
}

function Panel({ title, id, children, note }: { title: string; id: string; children: React.ReactNode; note: string }) {
  return (
    <div className="v4lab-demo" data-testid={id}>
      <h3 className="v4-sub">{title}</h3>
      <p className="v4-quiet">{note}</p>
      {children}
    </div>
  );
}

function BloodDemo() {
  return (
    <Panel id="demo-blood" title="1. Blood drips" note="It forms on the chin and the page edge, hangs, falls and splashes. Always running in the changed forms; one still bead when motion is reduced.">
      <div className="v4lab-stagebox">
        {(["distorted", "horror"] as const).map((f) => (
          <div key={f} className="v4lab-stage">
            <div className="v4lab-ghostpos">
              <V4Ghost form={f} expr="neutral" />
              <BloodDrips form={f} />
            </div>
            <p className="v4lab-cap">{FORM_LABEL[f]}</p>
          </div>
        ))}
      </div>
      <ol className="v4lab-dripframes" aria-label="Drip frames">
        {Array.from({ length: DRIP_ART.frames }, (_, i) => (
          <li key={i}>
            <span className="v4lab-dripf" aria-hidden="true" style={{ backgroundImage: "url(/sprites/v4/drip-a.png)", backgroundPosition: `calc(-8 * ${i} * var(--a)) 0` }} />
            {i + 1}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function usePlayLoop(play: () => void, everyMs: number, reduced: boolean) {
  useEffect(() => {
    if (reduced) return;
    const first = window.setTimeout(play, 900);
    const id = window.setInterval(play, everyMs);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, [play, everyMs, reduced]);
}

function TwitchDemo({ reduced }: { reduced: boolean }) {
  const seq = useSequencer(reduced);
  const [form, setForm] = useState<Form>("distorted");
  const [expr, setExpr] = useState<Expr>("neutral");
  const play = () => seq.play("twitch", TWITCH);
  const loop = () => seq.play("twitch", TWITCH);
  usePlayLoop(loop, 5200, reduced);
  const frame: Frame = seq.playing?.frame ?? { kind: "atlas", state: "idle" };
  return (
    <Panel id="demo-twitch" title="2. Twitch and freeze" note="A sudden flinch, a second jerk the other way, then the head locks at the wrong angle and the eyes find you. Everything else in the room stops with it. It lasts about two seconds.">
      <div className="v4lab-stagebox" data-frozen={seq.playing?.freeze || undefined}>
        <div className="v4lab-stage">
          <div className="v4lab-ghostpos">
            <V4Ghost form={form} expr={expr} frame={frame} bob={!seq.playing} />
          </div>
          <p className="v4lab-cap" data-testid="twitch-frame">{seq.playing ? `frame: ${frame.kind === "atlas" ? frame.state : ""}` : "resting"}</p>
        </div>
        <div className="v4lab-ctl">
          <button type="button" className="rpg-btn" onClick={play} data-testid="play-twitch">Play</button>
          <div role="group" aria-label="Form" className="v4-tabs">
            {(["human", "distorted", "horror"] as Form[]).map((f) => <button key={f} type="button" className="v4-tab" aria-pressed={form === f} onClick={() => setForm(f)}>{FORM_LABEL[f]}</button>)}
          </div>
          <div role="group" aria-label="Expression" className="v4-tabs">
            {EXPRS.map((e) => <button key={e} type="button" className="v4-tab" aria-pressed={expr === e} onClick={() => setExpr(e)}>{EXPR_LABEL[e]}</button>)}
          </div>
        </div>
      </div>
      <div className="v4lab-strip" aria-label="Twitch frames">
        {STATES.filter((s) => s.startsWith("twitch") || s === "freeze" || s === "idle").map((s) => (
          <figure key={s}><div className="v4lab-frame small"><V4Ghost form={form} expr={expr} frame={{ kind: "atlas", state: s }} bob={false} decorative /></div><figcaption>{s}</figcaption></figure>
        ))}
      </div>
    </Panel>
  );
}

function TransformDemo({ reduced }: { reduced: boolean }) {
  const seq = useSequencer(reduced);
  const play = () => seq.play("transform", transformSteps(FORM_INDEX.human, FORM_INDEX.horror));
  const back = () => seq.play("transform", transformSteps(FORM_INDEX.horror, FORM_INDEX.human));
  usePlayLoop(play, 9000, reduced);
  const frame: Frame = seq.playing?.frame ?? { kind: "transform", index: 0 };
  const idx = frame.kind === "transform" ? frame.index : 0;
  return (
    <Panel id="demo-transform" title="3. Human to horror" note="Twelve drawn frames, each a real point on the way: the first flinch, the eyes drifting apart, the jaw giving, a pause as the distorted form, the wound opening, new eyes, and the settled horror.">
      <div className="v4lab-stagebox" data-transforming={seq.playing ? "true" : undefined}>
        <div className="v4lab-stage">
          <div className="v4lab-ghostpos">
            <V4Ghost form="human" expr="neutral" frame={frame} bob={false} />
          </div>
          <p className="v4lab-cap" data-testid="transform-note">{seq.playing ? `${idx + 1}/${TRANSFORM_FRAMES.length}: ${TRANSFORM_FRAMES[idx].note}` : "resting"}</p>
        </div>
        <div className="v4lab-ctl">
          <button type="button" className="rpg-btn" onClick={play} data-testid="play-transform">Play: human to horror</button>
          <button type="button" className="rpg-btn" onClick={back} data-testid="play-transform-back">Play: horror to human</button>
        </div>
      </div>
      <ol className="v4lab-strip" aria-label="Transformation frames">
        {TRANSFORM_FRAMES.map((t, i) => (
          <li key={i}><figure><div className="v4lab-frame small"><V4Ghost form="human" expr="neutral" frame={{ kind: "transform", index: i }} bob={false} decorative /></div><figcaption>{i + 1}. {t.note}</figcaption></figure></li>
        ))}
      </ol>
    </Panel>
  );
}
