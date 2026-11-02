import { RPGPanel } from "@/components/rpg/RPGPanel";
import type { LatestCommit, RepoMetadata } from "@/domain/repo";
import { LIVE_STATUS_LABELS, type RepoStatus } from "@/domain/status";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "Unknown");

/**
 * Archive record for the repository. The frame is themed; every value is a field GitHub returned
 * (labels stay literal on purpose). There are no invented stats such as health or corruption.
 */
export function RepositoryStatusPanel({
  repo,
  status,
  latestCommit,
  retrievedAt,
}: {
  repo: RepoMetadata;
  status: RepoStatus;
  latestCommit: LatestCommit | null;
  retrievedAt: string;
}) {
  const label = LIVE_STATUS_LABELS[status];
  const rows: [string, React.ReactNode][] = [
    ["Repository", repo.fullName],
    ...(repo.description ? ([["Description", repo.description]] as [string, React.ReactNode][]) : []),
    ["Language", repo.language ?? "Unknown"],
    ["Created", day(repo.createdAt)],
    [
      "Latest commit",
      latestCommit ? (
        <>
          <a href={latestCommit.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-gold underline underline-offset-4 hover:text-white">
            {latestCommit.sha.slice(0, 7)} (opens in a new tab)
          </a>{" "}
          on {repo.defaultBranch}, {day(latestCommit.committedAt)}
          <span className="block" style={{ color: "var(--bone-dim)" }}>{latestCommit.messageHeadline}</span>
        </>
      ) : (
        "Not retrieved"
      ),
    ],
    ["Last push", day(repo.pushedAt)],
    ["Archived", repo.archived ? "Yes" : "No"],
    ["Stars", repo.stars.toLocaleString("en-US")],
    ["License", repo.license ?? "Not detected"],
    ["Default branch", repo.defaultBranch],
    ["GitHub ID", String(repo.repoId)],
  ];
  return (
    <RPGPanel tone="gold" aria-labelledby="archive-h" className="p-3 sm:p-4">
      <h2 id="archive-h" className="rpg-title">
        Archive record
      </h2>
      <p className="mt-2 text-base">
        <span className="rpg-tag tag-record" title={label.definition}>{label.label}</span>
        <span style={{ color: "var(--bone-dim)" }}>{label.definition}</span>
      </p>
      <dl className="mt-3 grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-base">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-label text-xs leading-6 text-gold">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm" style={{ color: "var(--bone-dim)" }}>
        The frame is themed. Every value was read from GitHub on {retrievedAt.slice(0, 10)}; none is a score or a prediction.
      </p>
    </RPGPanel>
  );
}
