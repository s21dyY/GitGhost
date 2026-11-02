import { EncounterStage } from "@/components/encounter/EncounterStage";
import { Peeker, ReturnWipe, Watchers } from "@/components/fx/transitions";
import { GraveyardGame } from "@/components/graveyard/GraveyardGame";
import { SummonProvider } from "@/components/graveyard/SummonProvider";
import { Ambient } from "@/components/SoundToggle";
import { repoPath } from "@/domain/repo-ref";
import { FEATURED_REPOS } from "@/fixtures/featured";

/**
 * The home screen is the game: a graveyard the visitor walks, with six unrevealed presences. Their names, status and
 * looks are not on the page: approaching one summons it, and the real repository and its ghost appear only inside the
 * encounter. A repository can also be summoned by name from the command line at the bottom.
 */
export default function Home() {
  const hrefs = FEATURED_REPOS.map((r) => repoPath(r));
  return (
    <SummonProvider>
      <main id="main" className="landing flex-1">
        <EncounterStage form="human">{null}</EncounterStage>
        <div className="landing-dark" aria-hidden="true" />
        <div className="landing-mist landing-mist-a" aria-hidden="true" />
        <div className="landing-mist landing-mist-b" aria-hidden="true" />
        <Ambient />
        <Watchers />
        <Peeker />
        <GraveyardGame hrefs={hrefs} />
      </main>
      <ReturnWipe />
    </SummonProvider>
  );
}
