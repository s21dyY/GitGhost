import Link from "next/link";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ConversationProvider } from "@/components/chat/ConversationProvider";
import { EvidenceJournal } from "@/components/chat/EvidenceJournal";
import { EncounterStage } from "@/components/encounter/EncounterStage";
import { Hud } from "@/components/encounter/Hud";
import { GhostFormProvider } from "@/components/entity/GhostFormContext";
import { GhostBadges, GhostNotes, GhostScene, type GhostView, type Nameplate } from "@/components/entity/GhostPanel";
import { RepositoryStatusPanel } from "@/components/repo/RepositoryStatusPanel";
import type { SummonedRepo } from "@/domain/repo";
import { LIVE_STATUS_LABELS } from "@/domain/status";
import type { SummonError } from "@/server/github/summon";

export function BackLink() {
  return (
    <Link href="/" className="rpg-btn !min-h-11 !px-3 !text-xs">
      <span aria-hidden="true">← </span>Graveyard
    </Link>
  );
}

/** The empty graveyard with one dialogue window: used while summoning and when something goes wrong. */
function EmptyEncounter({ tab, children, role }: { tab: string; children: React.ReactNode; role?: "status" | "alert" }) {
  return (
    <>
      <EncounterStage form="human">{null}</EncounterStage>
      <header className="hud">
        <nav aria-label="Encounter" className="hud-row">
          <BackLink />
        </nav>
      </header>
      <div className="dock">
        <section className="dlg" aria-label={tab}>
          <div className="dlg-tabs">
            <h1 className="dlg-tab">{tab}</h1>
          </div>
          <div className="dlg-box" role={role} aria-live={role === "status" ? "polite" : undefined}>
            <div className="dlg-main">{children}</div>
          </div>
        </section>
      </div>
    </>
  );
}

export function RepoLoading() {
  return (
    <EmptyEncounter tab="Summoning…" role="status">
      <p className="dlg-line">
        <span className="dots" aria-hidden="true"><span>■</span> <span>■</span> <span>■</span></span> Fetching live details from GitHub.
      </p>
    </EmptyEncounter>
  );
}

export function RepoError({
  title,
  error,
  input,
}: {
  title: string;
  error: SummonError | { code: string; message: string };
  input?: string;
}) {
  const resetAt = "resetAt" in error ? error.resetAt : undefined;
  return (
    <EmptyEncounter tab={title} role="alert">
      <p className="dlg-line">{error.message}</p>
      {input ? (
        <p className="mt-2 text-base" style={{ color: "var(--bone-dim)" }}>
          You asked for: <code className="text-gold">{input}</code>
        </p>
      ) : null}
      {resetAt ? (
        <p className="mt-2 text-base" style={{ color: "var(--bone-dim)" }}>GitHub may allow requests again after {resetAt}.</p>
      ) : null}
      <p className="mt-2 text-base">Check the name and reload the page to retry, or return to the graveyard.</p>
      {["network", "timeout", "upstream", "rate_limited", "invalid_response"].includes(error.code) ? (
        <p className="mt-2 text-base">
          GitHub cannot be reached right now.{" "}
          <Link href="/demo" className="text-violet underline underline-offset-4 hover:text-white">Open the offline demo (invented data, clearly labelled)</Link>
        </p>
      ) : null}
    </EmptyEncounter>
  );
}

function SectionNote({ state, what }: { state: SummonedRepo["sections"]["commit"]; what: string }) {
  if (state.state === "error") {
    return (
      <p className="text-base text-crimson">
        Could not load {what}: {state.message}
      </p>
    );
  }
  if (state.state === "empty") return <p className="text-base" style={{ color: "var(--bone-dim)" }}>No {what} found.</p>;
  return null;
}

export function RepoView({ data, ghost, devTools = false }: { data: SummonedRepo; ghost: GhostView; devTools?: boolean }) {
  const { repo, latestCommit, readme, status, sections } = data;
  const label = LIVE_STATUS_LABELS[status];
  const plate: Nameplate = { owner: repo.owner, name: repo.name, statusLabel: label.label, statusDefinition: label.definition, statusTone: status };
  const partial = sections.commit.state === "error" || sections.readme.state === "error";
  const journalSources = data.evidence.map((e) => ({ kind: e.kind, url: e.sourceUrl, revisionSha: e.revisionSha }));

  return (
    <GhostFormProvider>
      <GhostScene view={ghost} devTools={devTools} />
      <ConversationProvider owner={repo.owner} repo={repo.name}>
        <Hud
          showToggle={ghost.status !== "error"}
          badges={<GhostBadges view={ghost} />}
          notice={partial ? <span role="status" className="rpg-tag tag-reading !mr-0">Partial result: some details could not be loaded.</span> : null}
          archive={
            <div className="space-y-5">
              {partial ? (
                <div role="status">
                  <SectionNote state={sections.commit} what="commit" />
                  <SectionNote state={sections.readme} what="README" />
                </div>
              ) : null}
              <RepositoryStatusPanel repo={repo} status={status} latestCommit={latestCommit} retrievedAt={data.retrievedAt} />
              <GhostNotes view={ghost} devTools={devTools} />
            </div>
          }
          journal={<EvidenceJournal sources={journalSources} retrievedAt={data.retrievedAt} readme={readme ? { excerpt: readme.excerpt, truncated: readme.truncated } : null} />}
        />
        {ghost.status === "error" ? (
          <div className="dock">
            <section className="dlg" aria-label="Ghost unavailable">
              <div className="dlg-tabs">
                <h1 className="dlg-tab">{repo.fullName}</h1>
              </div>
              <div className="dlg-box">
                <div className="dlg-main" role="status">
                  <p className="font-bold text-crimson">Ghost unavailable</p>
                  <p className="dlg-line mt-1">{ghost.message}</p>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <ChatPanel repo={repo.name} ghost={ghost} plate={plate} devTools={devTools} />
        )}
      </ConversationProvider>
    </GhostFormProvider>
  );
}
