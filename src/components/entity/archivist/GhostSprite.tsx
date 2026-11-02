import { composeOverlays, HEIGHT, spriteUrl, THOUGHT_DOTS, WIDTH, type Cell, type Pose, type Stage } from "./sprites";
import { describeArchivist } from "./describe";

function Cells({ cells }: { cells: readonly Cell[] }) {
  return (
    <>
      {cells.map((d, i) => (
        <rect key={`${d.x},${d.y},${i}`} x={d.x} y={d.y} width={1} height={1} fill={d.c} />
      ))}
    </>
  );
}

/**
 * The Archivist: authored pixel art (PNG frames) with SVG overlays in the same 64x80 grid.
 * Animation is CSS only (see globals.css) and is switched off by prefers-reduced-motion,
 * leaving a static first frame. Unsupported overlays are skipped, and the caller is told which ones.
 */
export function GhostSprite({
  stage,
  pose,
  mutationIds,
  className = "sprite",
  crop,
  decorative = false,
}: {
  stage: Stage;
  pose: Pose;
  mutationIds: readonly string[];
  /** Extra classes. Sizing is set by the parent through --art-px (see globals.css). */
  className?: string;
  /** Show only part of the grid, in art pixels, for example a head-and-shoulders portrait. */
  crop?: { x: number; y: number; w: number; h: number };
  /** Portraits repeat the main sprite, so they hide from assistive tech. */
  decorative?: boolean;
}) {
  const { over, under, shadow } = composeOverlays(stage, mutationIds);
  const { summary, traits } = describeArchivist(stage, mutationIds);
  const label = `Pixel illustration of a fictional ghost. ${summary}${traits.length ? ` Details: ${traits.join("; ")}.` : ""}`;
  const box = crop ?? { x: 0, y: 0, w: WIDTH, h: HEIGHT };
  const alt = pose === "speaking" ? "idle" : null;
  // Blink is a short-lived overlay frame timed in CSS; the thinking glance is its own frame.
  const frame = (p: Pose, cls: string) => (
    <image key={`${p}-${cls}`} href={spriteUrl(stage, p)} x={0} y={0} width={WIDTH} height={HEIGHT} className={cls} imageRendering="pixelated" />
  );
  return (
    <svg
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label })}
      className={`${className} ${pose === "idle" ? "ghost-bob" : ""}`}
      data-stage={stage}
      data-pose={pose}
      data-shadow={shadow ?? undefined}
    >
      {shadow ? (
        <g className={`ghost-shadow ghost-shadow-${shadow}`} aria-hidden="true">
          <image href={spriteUrl(stage, "idle")} x={0} y={0} width={WIDTH} height={HEIGHT} imageRendering="pixelated" />
        </g>
      ) : null}
      <g shapeRendering="crispEdges">
        <Cells cells={under} />
      </g>
      <g className={alt ? "ghost-frame-a" : undefined}>{frame(pose === "blink" ? "idle" : pose, "ghost-main")}</g>
      {alt ? <g className="ghost-frame-b">{frame(alt, "ghost-main")}</g> : null}
      {pose === "idle" ? <g className="ghost-blink">{frame("blink", "ghost-main")}</g> : null}
      <g shapeRendering="crispEdges">
        <Cells cells={over} />
      </g>
      {pose === "thinking" ? (
        <g data-testid="thought-dots" shapeRendering="crispEdges">
          {THOUGHT_DOTS.map((d, i) => (
            <rect key={i} className="ghost-dot" x={d.x} y={d.y} width={2} height={2} fill={d.c} style={{ animationDelay: `${i * 0.25}s` }} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
