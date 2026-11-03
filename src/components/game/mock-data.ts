import type { Ask, GameData } from "./data";
import { ERAS, EVIDENCE, MOCK_REPO, OBSERVED, READINGS, SHORTCUTS, UNKNOWN, mockReply } from "./fixtures";

/**
 * The offline demo: invented data for an invented repository, used by /demo.
 * It exists so the whole interface can be shown with no network and no AWS. Every screen that shows
 * it carries a MOCK label, and nothing here is evidence about any real repository.
 */
export function mockGameData(): GameData {
  return {
    mode: "mock",
    repo: { fullName: `${MOCK_REPO.owner}/${MOCK_REPO.name}`, owner: MOCK_REPO.owner, name: MOCK_REPO.name, url: null, description: "An invented repository for the offline demo. It is not on GitHub." },
    ghostName: MOCK_REPO.name,
    archetype: "The Archivist",
    statusLine: "Archived (invented fixture)",
    identity: { state: "mock", note: "Invented fixture. No identity is saved." },
    replyMode: "scripted",
    specialist: false, // the invented repository has no real commit for the Specialist to read
    restingStage: ERAS[ERAS.length - 1].stage,
    vitality: "dead", // the invented repository is archived
    eras: ERAS.map((e) => ({
      id: e.id, sha: e.sha, fullSha: null, date: e.date, message: e.message, url: null,
      stage: e.stage, emotion: e.emotion, tone: e.tone, ghostLine: e.ghostLine, evidenceId: e.evidenceId,
    })),
    history: { complete: true, total: ERAS.length, note: null },
    evidence: EVIDENCE.map((e) => ({ id: e.id, kind: e.kind, label: e.label, revision: e.revision, excerpt: e.excerpt, since: e.since, source: "mock" as const })),
    observed: OBSERVED.map((o) => ({ ...o, evidence: [...o.evidence] })),
    readings: READINGS.map((r) => ({ ...r, basis: [...r.basis] })),
    unknown: UNKNOWN.map((u, i) => ({ id: `u${i}`, text: u.text, since: u.since })),
    shortcuts: [...SHORTCUTS],
  };
}

/** Scripted replies from the fixtures, scoped to the selected era. No model, no network. */
export const mockAsk: Ask = async ({ question, eraIdx }) => ({ ok: true, reply: { ...mockReply(question, eraIdx), provider: "mock" }, evidence: [] });
