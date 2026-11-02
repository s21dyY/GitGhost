import { buildEvidence, type EvidenceItem } from "@/domain/evidence";
import type { EvidenceRef } from "@/server/evidence/select";

/**
 * CAPTURED FIXTURES for replay tests (Milestone 2C.3). No network, no AWS.
 *
 * NOVA_LITE_2026_11_01_RAW is the exact reply of the one real Amazon Nova Lite call made in Milestone 2C.2
 * (atom/atom, saved distorted Archivist, "Why did you die?").
 *
 * ATOM_LIVE_REFS reproduces the ten evidence references that call was shown, in the order it saw them
 * (the old ranking). The text was captured from the read-only GitHub adapter on 2026-11-01 with the
 * same selection code. Differences from the live run, on purpose: comment text that consisted of mentions
 * of other users is replaced by a neutral placeholder, a user handle is replaced by "[a user]", a link is
 * shortened, and E10 is the pull request found by the later capture. Third-party text is kept out of the repo.
 */
export const NOVA_LITE_2026_11_01_RAW =
  '{"segments":[{"kind":"unknown","text":"The reason for the repository\'s end is not detailed in the evidence."}],"ghost":[{"kind":"ghost","text":"The end... is not... clear."}]}';

export const ATOM_REPO_ID = 3228505;
const RETRIEVED_AT = "2026-11-01T02:47:56.000Z";

type Captured = { ref: string; kind: EvidenceItem["kind"]; url: string; excerpt: string; sha?: string; label?: string };
const CAPTURED: Captured[] = [
  { ref: "E1", kind: "repo-metadata", url: "https://github.com/atom/atom", excerpt: "atom/atom\ndefault branch: master\narchived: true\nlanguage: JavaScript\ncreated on GitHub: 2012-01-20T18:18:21.000Z\nlast push: 2023-01-03T10:49:48.000Z", label: "Repository" },
  { ref: "E2", kind: "readme", url: "https://github.com/atom/atom/blob/1c3bd35ce238dc0491def9e1780d04748d8e18af/README.md", excerpt: "# Atom\n\n[![Build status](https://dev.azure.com/github/Atom/_apis/build/status/Atom%20Production%20Branches?branchName=master)](https://dev.azure.com/github/Atom/_build/latest?definitionId=32&branchName=master)\n\n> Atom and all repositories under Atom will be archived on December 15, 2022. Learn more in our [official announcement](https://github.blog/2022-06-08-sunsetting-atom/)\n\nAtom is a hackable text editor for the 21st century, built on [Electron](https://github.com/electron/electron), and based on everything we love about our favorite editors. We designed it to be deeply customizable, but still approachable using the default configuration.\n\n![Atom](https://user-images.githubusercontent.co", sha: "1c3bd35ce238dc0491def9e1780d04748d8e18af", label: "README" },
  { ref: "E3", kind: "issue", url: "https://github.com/atom/atom/issues/6867", excerpt: "#6867 Atom packages that require an upgrade to 1.0 API [closed, opened 2015-05-20T15:32:10.000Z, closed 2015-06-04T23:30:21.000Z, 202 comments] We've been collecting data on which packages have deprecations since 0.201. This is a list of the packages using deprecated APIs, their owners and each package's impact. This data reflects a subset of the user population (those who have upgraded to 201). Affected numbers are ", label: "Issue #6867" },
  { ref: "E4", kind: "commit", url: "https://github.com/atom/atom/commit/1c3bd35ce238dc0491def9e1780d04748d8e18af", excerpt: "Merge pull request #25709 from atom/fix-snapshot-result-macos\n2022-11-22T16:11:57.000Z", sha: "1c3bd35ce238dc0491def9e1780d04748d8e18af", label: "Commit 1c3bd35" },
  { ref: "E5", kind: "issue-comment", url: "https://github.com/atom/atom/issues/6867#issuecomment-captured-5", excerpt: "Comment on #6867 (2015-05-20T17:26:48.000Z): I just updated [coffee-autocompile](https://atom.io/packages/coffee-autocompile) to be compatible with the new API :) It's 224 on the list.", label: "Comment on issue #6867" },
  { ref: "E6", kind: "issue-comment", url: "https://github.com/atom/atom/issues/6867#issuecomment-captured-6", excerpt: "Comment on #6867 (2015-05-20T18:13:19.000Z): [a user] Thanks! :heart:", label: "Comment on issue #6867" },
  { ref: "E7", kind: "issue-comment", url: "https://github.com/atom/atom/issues/6867#issuecomment-captured-7", excerpt: "Comment on #6867 (2015-05-20T18:17:23.000Z): [captured text omitted from this fixture: it consisted of mentions of other users]", label: "Comment on issue #6867" },
  { ref: "E8", kind: "issue-comment", url: "https://github.com/atom/atom/issues/6867#issuecomment-captured-8", excerpt: "Comment on #6867 (2015-05-20T18:17:56.000Z): [captured text omitted from this fixture: it consisted of mentions of other users]", label: "Comment on issue #6867" },
  { ref: "E9", kind: "issue-comment", url: "https://github.com/atom/atom/issues/6867#issuecomment-captured-9", excerpt: "Comment on #6867 (2015-05-20T18:19:12.000Z): [captured text omitted from this fixture: it consisted of mentions of other users]", label: "Comment on issue #6867" },
  { ref: "E10", kind: "pull-request", url: "https://github.com/atom/atom/pull/25667", excerpt: "#25667 fix link on CHANGELOG [closed] Fix the link on the CHANGELOG which displayed a 404 error ----- [View rendered CHANGELOG.md](a link)", label: "Pull request #25667" },
];

const toItem = (c: Captured): EvidenceItem =>
  buildEvidence({ repoId: ATOM_REPO_ID, kind: c.kind, sourceUrl: c.url, label: c.label, revisionSha: c.sha, retrievedAt: RETRIEVED_AT, excerpt: c.excerpt, truncated: false });

/** The pool of items the planner chooses from (everything captured, in retrieval order). */
export function atomPool(): EvidenceItem[] {
  const order: Captured["ref"][] = ["E1", "E2", "E4", "E3", "E5", "E6", "E7", "E8", "E9", "E10"];
  return order.map((r) => toItem(CAPTURED.find((c) => c.ref === r)!));
}

/** The ten references exactly as the live Nova Lite call saw them (old ranking, E1..E10). */
export function atomLiveRefs(): EvidenceRef[] {
  return CAPTURED.map((c) => ({ ref: c.ref, item: toItem(c), view: c.excerpt }));
}

import { buildEntity } from "@/config/entities";
import { assignmentFromIdentity, repoSignalsFromMetadata, type EntityAssignment } from "@/domain/entity";

/**
 * The saved identity of atom/atom as read from the identity table on 2026-11-01: Archivist origin, cosmic
 * voice, formal temperament, distorted stage, overlays orbiting-eyes and missing-outline. Rebuilt here from
 * the shipped entity config (the seed is irrelevant to the prompt), so tests need no AWS.
 */
export function atomAssignment(stage: EntityAssignment["currentStage"] = "distorted"): EntityAssignment {
  // (a saved identity is only ever distorted or transformed; the human form is chosen per request, not stored)
  const meta = { repoId: ATOM_REPO_ID, owner: "atom", name: "atom", fullName: "atom/atom", htmlUrl: "https://github.com/atom/atom", description: "A hackable text editor", defaultBranch: "master", archived: true, language: "JavaScript", stars: 1, license: null, pushedAt: null, createdAt: "2012-01-20T18:18:21.000Z", topics: [] };
  const base = assignmentFromIdentity(buildEntity(repoSignalsFromMetadata(meta), "fixture-seed"), "2026-11-01T00:00:00.000Z");
  return { ...base, originId: "archivist", voiceId: "cosmic", temperamentId: "formal", currentStage: stage, mutationParts: ["orbiting-eyes", "missing-outline"] } as EntityAssignment;
}
