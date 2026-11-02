import { HUMANS } from "@/config/entities";
import type { EntityAssignment } from "@/domain/entity";
import type { SummonedRepo } from "@/domain/repo";
import { LIVE_STATUS_LABELS } from "@/domain/status";
import type { History } from "@/server/github/history";
import { PROVISIONAL_TEXT, type ProvisionalReason } from "@/components/entity/provisional";
import type { EraData, EvidenceData, GameData, Observation, Reading } from "./data";
import { presentationFor, type SavedStage } from "./presentation";
import { sceneFor, spriteFor } from "./scene-theme";

/**
 * Build the V4 game's data from what GitHub returned and the saved identity. Pure and server-safe.
 *
 * Honesty rules:
 *  - Eras are real commits (id, date, message, link). If history could not be read, the only era is the
 *    latest commit when we have one; with none, there are no eras. Nothing is filled in.
 *  - Present-day facts (archived flag, last push, README at HEAD) exist only from the latest era on.
 *  - The ghost's look per era comes from presentation.ts and is labelled as narrative, not evidence.
 */
export const LIVE_SHORTCUTS = ["What happened during this time?", "Why did you die?", "How did you begin?", "What were people complaining about?"] as const;

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "unknown date");

export type GhostInfo =
  | { status: "persisted"; assignment: EntityAssignment }
  | { status: "provisional"; assignment: EntityAssignment; reason?: ProvisionalReason };

export function buildLiveData(input: {
  summoned: SummonedRepo;
  history: History | null;
  /** Why history is missing, in plain words, when it could not be fetched. */
  historyProblem?: string | null;
  ghost: GhostInfo;
  replyMode: "scripted" | "model" | "unavailable";
}): GameData {
  const { summoned, history, ghost } = input;
  const { repo, latestCommit, readme } = summoned;
  const saved: SavedStage = ghost.assignment.currentStage;

  // ---- eras: real commits only ----
  let commits = history?.commits ?? [];
  if (commits.length === 0 && latestCommit) {
    commits = [{ sha: latestCommit.sha, shortSha: latestCommit.sha.slice(0, 7), date: latestCommit.committedAt, headline: latestCommit.messageHeadline || "(no message)", url: latestCommit.htmlUrl }];
  }
  const look = presentationFor(commits.map((c) => c.sha), saved);
  const eras: EraData[] = commits.map((c, i) => ({
    id: `era-${c.shortSha}`,
    sha: c.shortSha,
    fullSha: c.sha,
    date: day(c.date),
    message: c.headline,
    url: c.url,
    ...look[i],
    evidenceId: `commit:${c.shortSha}`,
  }));
  const last = Math.max(0, eras.length - 1);

  // ---- evidence archive ----
  const evidence: EvidenceData[] = [];
  if (repo.createdAt) {
    evidence.push({ id: "repo:created", kind: "repo-metadata", label: "Repository record", excerpt: `${repo.fullName}\ncreated on GitHub: ${repo.createdAt}`, url: repo.htmlUrl, since: 0, source: "page" });
  }
  eras.forEach((e, i) => evidence.push({ id: e.evidenceId, kind: "commit", label: `Commit ${e.sha}`, revision: e.sha, excerpt: `${e.message} (${e.date})`, url: e.url ?? undefined, since: i, source: "page" }));
  const meta = summoned.evidence.find((x) => x.kind === "repo-metadata");
  if (meta) evidence.push({ id: "repo:now", kind: "repo-metadata", label: "Repository record (now)", excerpt: meta.excerpt, url: meta.sourceUrl, since: last, source: "page" });
  if (readme) evidence.push({ id: "repo:readme", kind: "readme", label: "README (latest commit)", revision: readme.revisionSha?.slice(0, 7), excerpt: readme.excerpt.slice(0, 600) + (readme.truncated ? "…" : ""), url: readme.htmlUrl, since: last, source: "page" });

  // ---- board: facts, readings, gaps ----
  const label = LIVE_STATUS_LABELS[summoned.status];
  const observed: Observation[] = [];
  if (repo.createdAt) observed.push({ id: "o-created", text: `${repo.fullName} was created on GitHub on ${day(repo.createdAt)}.`, evidence: ["repo:created"], since: 0 });
  if (meta) observed.push({ id: "o-archived", text: `GitHub's archived flag is ${repo.archived ? "set" : "not set"} (retrieved ${day(summoned.retrievedAt)}).`, evidence: ["repo:now"], since: last });
  if (repo.pushedAt) observed.push({ id: "o-push", text: `GitHub records the last push on ${day(repo.pushedAt)}.`, evidence: ["repo:now"], since: last });
  if (eras.length) observed.push({ id: "o-latest", text: `The newest commit on the default branch is ${eras[last].sha}, dated ${eras[last].date}.`, evidence: [eras[last].evidenceId], since: last });
  if (readme) observed.push({ id: "o-readme", text: "A README is present at the latest commit.", evidence: ["repo:readme"], since: last });

  const readings: Reading[] = [
    { id: "r-status", text: `GitGhost labels this repository "${label.label}". ${label.definition} That is a reading of GitHub's flag and the commit date, not a statement by the owners.`, basis: [...(meta ? ["repo:now"] : []), ...(eras.length ? [eras[last].evidenceId] : [])], since: last },
  ];

  const unknown: GameData["unknown"] = [
    { id: "u-why", text: "GitHub does not record why a project goes quiet. Nothing GitGhost reads states a reason, and any reason it gave would be a guess.", since: 0 },
  ];
  if (input.historyProblem) unknown.push({ id: "u-history-error", text: input.historyProblem, since: 0 });
  if (summoned.sections.readme.state === "empty") unknown.push({ id: "u-readme", text: "No README was found at the latest commit.", since: last });
  if (summoned.sections.readme.state === "error") unknown.push({ id: "u-readme", text: `The README could not be read: ${summoned.sections.readme.message}`, since: last });
  if (summoned.sections.commit.state === "error") unknown.push({ id: "u-commit", text: `The latest commit could not be read: ${summoned.sections.commit.message}`, since: 0 });

  const origin = HUMANS.find((h) => h.id === ghost.assignment.originId);
  const scene = sceneFor({ name: repo.name, description: repo.description, language: repo.language, topics: repo.topics });
  return {
    mode: "live",
    repo: { fullName: repo.fullName, owner: repo.owner, name: repo.name, url: repo.htmlUrl, description: repo.description },
    ghostName: repo.name,
    archetype: origin?.internalName ?? "The Archivist",
    scene,
    sprite: spriteFor(ghost.assignment.originId, scene),
    statusLine: `${label.label}. Retrieved ${day(summoned.retrievedAt)}.`,
    identity: ghost.status === "persisted" ? { state: "saved", note: null } : { state: "provisional", note: ghost.reason ? PROVISIONAL_TEXT[ghost.reason] : "This look is not saved and may change later." },
    replyMode: input.replyMode,
    restingStage: saved,
    eras,
    history: { complete: history?.complete ?? false, total: history?.total ?? null, note: history?.note ?? input.historyProblem ?? null },
    evidence,
    observed,
    readings,
    unknown,
    shortcuts: [...LIVE_SHORTCUTS],
  };
}
