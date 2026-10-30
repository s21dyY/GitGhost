import {
  FEATURED_REPOS,
  SNAPSHOT_DATE,
  STATUS_LABELS,
  repoUrl,
  type FeaturedRepo,
} from "@/fixtures/featured";

const STATUS_STYLE: Record<FeaturedRepo["status"], string> = {
  archived: "border-rust text-[#e0a094]",
  quiet: "border-violet text-violet",
  active: "border-fog text-fog",
};

function Tombstone({ r }: { r: FeaturedRepo }) {
  const status = STATUS_LABELS[r.status];
  const pushed = r.lastPushedAt.slice(0, 10);
  return (
    <li className="tomb-wrap">
      <article className="tombstone bg-stone border-4 border-stone-edge px-5 pt-10 pb-6 h-full flex flex-col gap-3 transition-colors">
        <h3 className="pixel text-xl break-words">
          <a
            href={repoUrl(r)}
            target="_blank"
            rel="noopener noreferrer"
            className="tomb-link hover:text-fog underline decoration-dotted underline-offset-4"
            aria-label={`${r.owner}/${r.repo} on GitHub (opens in a new tab)`}
          >
            <span className="block text-sm text-fog/80 normal-case tracking-normal">
              {r.owner}/
            </span>
            {r.repo}
          </a>
        </h3>
        <p className="text-sm">{r.summary}</p>
        <p className="text-sm text-bone/80">Language: {r.language}</p>
        <p>
          <span
            className={`inline-block border-2 px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}
            title={status.definition}
          >
            {status.label}
          </span>
        </p>
        <p className="text-xs text-bone/75">{status.definition}</p>
        <p className="text-xs text-bone/75 mt-auto">
          Last push {pushed} · recorded snapshot {r.retrievedAt}
        </p>
      </article>
    </li>
  );
}

export default function Home() {
  return (
    <main className="fog flex-1">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <header className="text-center">
          <p aria-hidden="true" className="drift text-fog text-sm tracking-[0.5em]">
            ~ ~ ~ ~ ~ ~
          </p>
          <h1 className="pixel text-4xl sm:text-6xl mt-2">GitGhost</h1>
          <p className="mt-3 text-lg text-violet">
            Every repo has a ghost.
          </p>
        </header>

        <section aria-labelledby="featured" className="mt-12">
          <h2 id="featured" className="pixel text-2xl text-fog">
            Featured graves
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-bone/85">
            Six real public GitHub repositories. Status labels describe the
            repository at the recorded snapshot, not a verdict on the project.
            These are fixture data from {SNAPSHOT_DATE}, not live.
          </p>
          <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURED_REPOS.map((r) => (
              <Tombstone key={r.repoId} r={r} />
            ))}
          </ul>
        </section>

        <footer className="mt-16 border-t border-stone-edge pt-4 text-xs text-bone/70">
          Ghosts are fictional. Repository facts come from GitHub. Summoning by
          URL is not available yet.
        </footer>
      </div>
    </main>
  );
}
