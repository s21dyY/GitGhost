import { notFound } from "next/navigation";
import { Suspense } from "react";
import { EncounterStage } from "@/components/encounter/EncounterStage";
import { GhostSprite } from "@/components/entity/archivist/GhostSprite";
import type { Pose, Stage } from "@/components/entity/archivist/sprites";

/**
 * Milestone 2B.3 static prototype for atom/atom. Not linked from the app.
 * No repository facts are shown here: the greeting is the fixed ghost-voice opener.
 * Query: ?stage=human|distorted|transformed&pose=idle|speaking|thinking
 */
export const metadata = { title: "Encounter prototype", robots: { index: false } };

const STAGES = ["human", "distorted", "transformed"] as const;
const POSES = ["idle", "speaking", "thinking", "blink"] as const;

async function Encounter({ searchParams }: { searchParams: Promise<{ stage?: string; pose?: string }> }) {
  const q = await searchParams;
  const stage = (STAGES as readonly string[]).includes(q.stage ?? "") ? (q.stage as Stage) : "human";
  const pose = (POSES as readonly string[]).includes(q.pose ?? "") ? (q.pose as Pose) : "idle";
  const form = stage === "human" ? "human" : "horror";
  return (
    <>
      <EncounterStage form={form}>
        <GhostSprite stage={stage} pose={pose} mutationIds={[]} />
      </EncounterStage>
      <div className="dock">
        <section className="dlg" aria-label="Ask the ghost">
          <div className="dlg-tab">atom / atom</div>
          <div className="dlg-box">
            <div className="dlg-portrait">
              <GhostSprite stage={stage} pose={pose === "idle" ? "speaking" : pose} mutationIds={[]} decorative crop={{ x: 18, y: 6, w: 28, h: 28 }} />
            </div>
            <div className="dlg-text">
              <p className="text-base text-bone sm:text-lg">
                You came a long way to ask me something. Ask, and I will read what the record still holds.
              </p>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default function Page({ searchParams }: { searchParams: Promise<{ stage?: string; pose?: string }> }) {
  if (process.env.NODE_ENV === "production" && process.env.GITGHOST_PROTOTYPES !== "1") notFound();
  return (
    <main id="main">
      <Suspense>
        <Encounter searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
