export type RepoStatus = "archived" | "quiet" | "active" | "unknown";

/** Quiet = no commit for more than this long before retrieval. */
export const QUIET_AFTER_DAYS = 365;

export const LIVE_STATUS_LABELS: Record<RepoStatus, { label: string; definition: string }> = {
  archived: {
    label: "Archived",
    definition: "GitHub's archived flag was set when retrieved.",
  },
  quiet: {
    label: "Quiet by last fetched commit",
    definition: `Not archived, and the latest default-branch commit is over ${QUIET_AFTER_DAYS} days old.`,
  },
  active: {
    label: "Active by last fetched commit",
    definition: `Not archived, and the latest default-branch commit is within ${QUIET_AFTER_DAYS} days.`,
  },
  unknown: {
    label: "Unknown",
    definition: "No latest commit could be retrieved, so activity is not judged.",
  },
};

export function deriveStatus(
  archived: boolean,
  latestCommitDate: string | null,
  now: Date,
): RepoStatus {
  if (archived) return "archived";
  if (!latestCommitDate) return "unknown";
  const t = Date.parse(latestCommitDate);
  if (Number.isNaN(t)) return "unknown";
  const ageDays = (now.getTime() - t) / 86_400_000;
  return ageDays > QUIET_AFTER_DAYS ? "quiet" : "active";
}
