import type { CSSProperties } from "react";
import art from "./art.manifest.json";

/**
 * The V4 ghost. One PNG atlas per form (6 expressions across, 6 states down), shown with CSS only:
 * integer pixel scale, image-rendering: pixelated, no SVG, no filters. Sizing comes from --a (CSS px per art pixel).
 * Frame data comes from scripts/art/v4-archivist.mts, so the markup and the art cannot drift apart.
 */
export type Form = "human" | "distorted" | "horror";
export type Expr = "neutral" | "melancholy" | "amused" | "angry" | "disturbed" | "eldritch";
export type GState = "idle" | "speak" | "blink" | "twitchA" | "twitchB" | "freeze";

export const FORMS = art.forms as Form[];
export const EXPRS = art.exprs as Expr[];
export const STATES = art.states as GState[];
export const TRANSFORM_FRAMES = art.transform as { t: number; ms: number; note: string }[];
export const DRIP_ART = art.drip as { w: number; frames: number; fallA: number; fallB: number };
export const IDLE_ART = art.idle as { frames: number; ms: number };
export const W = art.width;
export const H = art.height;

export const EXPR_LABEL: Record<Expr, string> = {
  neutral: "Neutral",
  melancholy: "Melancholy",
  amused: "Amused",
  angry: "Angry",
  disturbed: "Disturbed",
  eldritch: "Eldritch",
};
export const FORM_LABEL: Record<Form, string> = { human: "Human", distorted: "Gory", horror: "Eldritch" };

/** What the picture shows, in words. Fictional; it says nothing about any repository. */
export const FORM_ALT: Record<Form, string> = {
  human: "A pale, tired person in a dark hood and coat, holding a green book with a brass clasp.",
  distorted: "A hooded figure holding a green book. One eye is huge and bloodshot, the other sewn shut. The cheek is torn open and blood runs from the mouth onto the book.",
  horror: "A hooded figure holding a green book, now violet and bloodless. The face is a dark void with stars in it and several glowing eyes, and long tendrils rise on both sides.",
};
const ALT: Record<Kind, Record<Form, string>> = {
  archivist: FORM_ALT,
  watchkeeper: {
    human: "A pale man in a peaked cap and a long coat with a red scarf, holding a lantern with a cracked blue pane.",
    distorted: "A man in a peaked cap. One eye socket is empty and bleeding, the cheek is torn open over bared teeth, and the coat hangs open on bare ribs.",
    horror: "A figure in a violet coat and a peaked cap. Its face is a dark void with stars and glowing eyes, tendrils rise behind it, and the lantern glows violet.",
  },
  hound: {
    human: "A gaunt grey hound sitting upright with pricked ears, a leather collar and a small brass tag.",
    distorted: "A hound with a torn ear, an eye hanging on a cord, a bared row of teeth and a flank opened over its ribs.",
    horror: "A violet hound. The top of its face is a dark void with glowing eyes, another eye opens on its chest, and tendrils curl around it.",
  },
};

/** Which ghost body to draw. The Archivist is the fully polished one; the others share its forms, expressions and states. */
export type Kind = "archivist" | "watchkeeper" | "hound";
export const KINDS: Kind[] = ["archivist", "watchkeeper", "hound"];
const atlasUrl = (kind: Kind, form: Form) => (kind === "archivist" ? `/sprites/v4/atlas-${form}.png` : `/sprites/v4/atlas-${kind}-${form}.png`);
const stripUrl = (kind: Kind) => (kind === "archivist" ? "/sprites/v4/transform.png" : `/sprites/v4/transform-${kind}.png`);

export type Frame = { kind: "atlas"; state: GState } | { kind: "transform"; index: number };

function cell(kind: Kind, form: Form, expr: Expr, state: GState): CSSProperties {
  return {
    backgroundImage: `url(${atlasUrl(kind, form)})`,
    backgroundSize: `calc(${art.cols * W} * var(--a)) calc(${art.rows * H} * var(--a))`,
    backgroundPosition: `calc(${-EXPRS.indexOf(expr) * W} * var(--a)) calc(${-STATES.indexOf(state) * H} * var(--a))`,
  };
}

function strip(kind: Kind, index: number): CSSProperties {
  return {
    backgroundImage: `url(${stripUrl(kind)})`,
    backgroundSize: `calc(${TRANSFORM_FRAMES.length * W} * var(--a)) calc(${H} * var(--a))`,
    backgroundPosition: `calc(${-index * W} * var(--a)) 0`,
  };
}

/** The authored idle loop: one row per expression, played left to right by the v4-idle keyframes in v4.css. */
function idleLoop(form: Form, expr: Expr): CSSProperties {
  return {
    backgroundImage: `url(/sprites/v4/idle-${form}.png)`,
    backgroundSize: `calc(${IDLE_ART.frames * W} * var(--a)) calc(${EXPRS.length * H} * var(--a))`,
    backgroundPositionY: `calc(${-EXPRS.indexOf(expr) * H} * var(--a))`,
    animationDuration: `${IDLE_ART.frames * IDLE_ART.ms}ms`,
    animationTimingFunction: `steps(${IDLE_ART.frames})`,
    ["--idle-end" as string]: `calc(${-IDLE_ART.frames * W} * var(--a))`,
  };
}

export function V4Ghost({
  form, expr, frame = { kind: "atlas", state: "idle" }, talking = false, bob = true, decorative = false, className = "", label, sprite = "archivist",
}: {
  sprite?: Kind;
  form: Form;
  expr: Expr;
  frame?: Frame;
  /** Alternate the speaking mouth over the base frame. Static (mouth open) under reduced motion. */
  talking?: boolean;
  /** Breathing and blinking. Only for the resting frame. */
  bob?: boolean;
  decorative?: boolean;
  className?: string;
  label?: string;
}) {
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": label ?? `${ALT[sprite][form]} Expression: ${EXPR_LABEL[expr]}.` };
  const atlas = frame.kind === "atlas";
  const resting = atlas && frame.state === "idle";
  // The Archivist breathes, glances and blinks in its own drawn frames; the others still use the CSS bob and blink.
  if (resting && bob && !talking && sprite === "archivist") {
    return (
      <div {...a11y} className={`v4g ${className}`} data-form={form} data-expr={expr} data-frame="idle" style={{ imageRendering: "pixelated" }}>
        <div className="v4g-layer v4g-idle" style={idleLoop(form, expr)} />
      </div>
    );
  }
  return (
    <div {...a11y} className={`v4g ${resting && bob ? "ghost-bob" : ""} ${className}`} data-form={form} data-expr={expr} data-frame={atlas ? frame.state : `t${frame.index}`} style={{ imageRendering: "pixelated" }}>
      <div className="v4g-layer" style={atlas ? cell(sprite, form, expr, frame.state) : strip(sprite, frame.index)} />
      {resting && bob ? <div className="v4g-layer ghost-blink" style={cell(sprite, form, expr, "blink")} /> : null}
      {resting && talking ? <div className="v4g-layer v4g-talk" style={cell(sprite, form, expr, "speak")} /> : null}
    </div>
  );
}

/** Blood that forms, hangs, falls and splashes. Decorative. Positions are in art pixels of the 64 x 80 sprite. */
export const DRIP_POINTS: Record<Form, { x: number; y: number; fall: number; strip: "a" | "b"; delay: string; dur: string }[]> = {
  human: [],
  // origins sit away from the painted blood trails, so a falling drop is a new thing against clean cloth
  distorted: [
    { x: 21, y: 58, fall: DRIP_ART.fallB, strip: "b", delay: "-1.4s", dur: "6.4s" },
    { x: 34, y: 40, fall: DRIP_ART.fallA, strip: "a", delay: "-3.6s", dur: "7.8s" },
  ],
  horror: [], // the last form is bloodless
};

export function BloodDrips({ form, sprite = "archivist" }: { form: Form; sprite?: Kind }) {
  return (
    <>
      {(sprite === "archivist" ? DRIP_POINTS[form] : []).map((d, i) => (
        <span
          key={i}
          className="v4-drip"
          aria-hidden="true"
          style={{
            left: `calc(${d.x - 3} * var(--a))`,
            top: `calc(${d.y} * var(--a))`,
            height: `calc(${d.fall + 7} * var(--a))`,
            backgroundImage: `url(/sprites/v4/drip-${d.strip}.png)`,
            animationDelay: d.delay,
            animationDuration: d.dur,
          }}
        />
      ))}
    </>
  );
}

/**
 * Horror-form effects, decorative only (aria-hidden): blood that wells up and runs down the figure.
 * Positions are percentages of the sprite box, so they work for every sprite. All motion stops under reduced motion.
 */
const BLEED: { x: number; y: number; len: number; delay: string; dur: string }[] = [
  { x: 38, y: 30, len: 26, delay: "-0.8s", dur: "5.2s" },
  { x: 58, y: 31, len: 34, delay: "-3.1s", dur: "6.6s" },
  { x: 47, y: 52, len: 22, delay: "-1.9s", dur: "4.8s" },
  { x: 30, y: 66, len: 18, delay: "-4.4s", dur: "7.4s" },
];
export function HorrorBleed() {
  return (
    <div className="v4-bleed" aria-hidden="true">
      {BLEED.map((b, i) => (
        <span key={i} className="v4-bleed-run" style={{ left: `${b.x}%`, top: `${b.y}%`, height: `${b.len}%`, animationDelay: b.delay, animationDuration: b.dur }}>
          <span className="v4-bleed-drop" style={{ animationDelay: b.delay, animationDuration: b.dur }} />
        </span>
      ))}
    </div>
  );
}

/** A 9 x 5 pixel eye: white, a red iris and a black pupil. */
function PixelEye() {
  const rows = ["..WWWWW..", ".WWRRRWW.", "WWRRKRRWW", ".WWRRRWW.", "..WWWWW.."];
  const fill: Record<string, string> = { W: "#d8d2c4", R: "#b3122a", K: "#000" };
  return (
    <svg viewBox="0 0 9 5" width="100%" height="100%" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rows.flatMap((r, y) => [...r].map((ch, x) => (ch === "." ? null : <rect key={`${x},${y}`} x={x} y={y} width="1" height="1" fill={fill[ch]} />)))}
    </svg>
  );
}
/** Eyes in the dark around the figure, opening, staring and blinking out of step with each other. Percent of the stage. */
const EYES: { x: number; y: number; size: number; delay: string; dur: string }[] = [
  { x: 14, y: 22, size: 3.2, delay: "-0.5s", dur: "7s" },
  { x: 80, y: 18, size: 2.6, delay: "-2.7s", dur: "9s" },
  { x: 24, y: 58, size: 2.2, delay: "-5.1s", dur: "8s" },
  { x: 72, y: 50, size: 3.6, delay: "-1.6s", dur: "6.4s" },
  { x: 88, y: 38, size: 2, delay: "-3.9s", dur: "10s" },
];
export function WatchingEyes() {
  return (
    <div className="v4-eyes" aria-hidden="true">
      {EYES.map((e, i) => (
        <span key={i} className="v4-eye" style={{ left: `${e.x}%`, top: `${e.y}%`, width: `${e.size}rem`, height: `${(e.size * 5) / 9}rem`, animationDelay: e.delay, animationDuration: e.dur }}>
          <PixelEye />
        </span>
      ))}
    </div>
  );
}
