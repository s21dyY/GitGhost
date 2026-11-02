import { EncounterStage } from "@/components/encounter/EncounterStage";
import { Peeker, ReturnWipe, Watchers } from "@/components/fx/transitions";
import { Presence } from "@/components/graveyard/Presence";
import { SummonForm } from "@/components/graveyard/SummonForm";
import { SummonProvider } from "@/components/graveyard/SummonProvider";
import { Ambient, SoundToggle } from "@/components/SoundToggle";
import { repoPath } from "@/domain/repo-ref";
import { FEATURED_REPOS } from "@/fixtures/featured";

/**
 * The landing page shows six unrevealed presences. Their names, status and looks are not on the page: choosing one
 * summons it, and the real repository and its ghost appear only inside the encounter.
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
        <div className="landing-sound"><SoundToggle /></div>
        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-10 pt-20 sm:px-6 sm:pt-20">
          <header className="landing-hero text-center">
            <h1 className="landing-title font-pixel text-3xl text-bone sm:text-5xl" data-text="GitGhost">GitGhost</h1>
            <p className="landing-tagline font-label mt-4 text-base text-gold sm:text-lg">
              <span className="landing-tag-a">Every repo has a ghost.</span>
              {/* for a moment, now and then, the line is not the same line */}
              <span className="landing-tag-b" aria-hidden="true">Every repo has <em>your</em> ghost.</span>
            </p>
            <p className="mx-auto mt-2 max-w-xl text-base text-bone/80">
              Something is buried under every repository. Say its name, or follow a shadow.
            </p>
            <SummonForm />
          </header>
          <section aria-labelledby="featured" className="mt-20">
            <h2 id="featured" className="landing-restless font-label text-center text-sm text-fog">
              The restless
            </h2>
            <ul className="presences mt-6">
              {hrefs.map((href, i) => (
                <Presence key={href} href={href} index={i} total={hrefs.length} />
              ))}
            </ul>
            <p className="mx-auto mt-10 max-w-xl text-center text-sm text-bone/70">
              Six presences wait here. Each one haunts a real public GitHub repository. You will learn which when you approach.
            </p>
          </section>
          <footer className="mt-12 text-center">
            <p className="font-label inline-block bg-night/80 px-3 py-2 text-xs text-bone">
              Ghosts are fictional. Repository facts come from GitHub.
            </p>
          </footer>
        </div>
      </main>
      <ReturnWipe />
    </SummonProvider>
  );
}
