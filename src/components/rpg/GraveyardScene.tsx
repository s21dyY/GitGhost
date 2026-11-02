import { buildScene, SCENE_H, SCENE_W } from "./scene";

// Built once per server process; it never changes.
const LAYERS = buildScene();

/**
 * The shared haunted-graveyard backdrop for every page. Decorative only (aria-hidden), fixed behind
 * the content, drawn at an integer pixel scale. Twinkling and drifting fog are CSS-only and switch
 * off under prefers-reduced-motion.
 */
export function GraveyardScene() {
  return (
    <div className="scene" aria-hidden="true">
      <svg viewBox={`0 0 ${SCENE_W} ${SCENE_H}`} shapeRendering="crispEdges" preserveAspectRatio="xMidYMax meet" focusable="false">
        {LAYERS.map((layer) => (
          <g key={layer.id} className={layer.className || undefined}>
            {layer.paths.map((p) => (
              <path key={p.color} d={p.d} fill={p.color} />
            ))}
          </g>
        ))}
      </svg>
      <div className="scene-vignette" />
    </div>
  );
}
