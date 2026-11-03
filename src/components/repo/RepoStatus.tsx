import Link from "next/link";
import { EncounterStage } from "@/components/encounter/EncounterStage";
import type { SummonError } from "@/server/github/summon";

function BackLink() {
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
