import type { ReactNode } from "react";

/**
 * The haunted graveyard as one illustrated location. Layers are authored PNGs (scripts/art/scene.mts)
 * in a 320 x 240 art-pixel box; the ghost is placed in the same box so both share one pixel size.
 * Decorative only: everything here is aria-hidden except the ghost child, which labels itself.
 */
export function EncounterStage({ form, children }: { form: "human" | "horror"; children: ReactNode }) {
  const flame = form === "human" ? "/scene/flame-warm.png" : "/scene/flame-ghostly.png";
  return (
    <div className="encounter" data-form={form}>
      <div className="encounter-world" aria-hidden="true">
        <div className="enc-layer enc-sky" />
        <div className="enc-layer enc-far" />
        <div className="enc-layer enc-mid" />
        <span className="enc-light enc-moonlight" />
        <span className="enc-light enc-lamplight" />
        <span className="enc-ash" />
        <span className="enc-flicker" />
      </div>
      <div className="encounter-world encounter-world-front">
        <div className="enc-ghost">{children}</div>
        <div className="enc-layer enc-fog enc-fog-back" aria-hidden="true" />
        <div className="enc-layer enc-near" aria-hidden="true" />
        <div className="enc-layer enc-fog enc-fog-front" aria-hidden="true" />
        {/* eslint-disable-next-line @next/next/no-img-element -- pixel art, must not be resampled */}
        <img className="enc-flame" src={flame} alt="" width={8} height={12} aria-hidden="true" />
      </div>
    </div>
  );
}
