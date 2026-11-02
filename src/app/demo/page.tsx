import { Suspense } from "react";
import { mockGameData } from "@/components/v4/mock-data";
import { SCENES, type SceneFamily } from "@/components/v4/scene-theme";
import { KINDS, type Kind } from "@/components/v4/V4Ghost";
import { V4Game } from "@/components/v4/V4Game";
/**
 * The offline demo: the whole game on invented data (a made-up repository), with no network and no AI.
 * It is the fallback when GitHub or AWS is unreachable. Every screen carries a Mock label, and nothing
 * here is evidence about any real repository. `?sprite=watchkeeper|hound|clockmaker|bellwraith` and `?scene=network|frontend|infra|data|comms` show the other ghosts and backdrops.
 */
export const metadata = { title: "GitGhost offline demo (invented data)", robots: { index: false } };
async function Demo({ searchParams }: { searchParams: Promise<{ sprite?: string | string[]; scene?: string | string[] }> }) {
  const { sprite, scene } = await searchParams;
  const asked = Array.isArray(sprite) ? sprite[0] : sprite;
  const kind: Kind = KINDS.find((k) => k === asked) ?? "archivist";
  const askedScene = Array.isArray(scene) ? scene[0] : scene;
  const family: SceneFamily = SCENES.find((k) => k === askedScene) ?? "graveyard";
  return <V4Game data={{ ...mockGameData(), sprite: kind, scene: family }} />;
}
export default function Page({ searchParams }: { searchParams: Promise<{ sprite?: string | string[]; scene?: string | string[] }> }) {
  return (
    <Suspense>
      <Demo searchParams={searchParams} />
    </Suspense>
  );
}
