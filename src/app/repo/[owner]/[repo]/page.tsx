import { headers } from "next/headers";
import { connection } from "next/server";
import { Suspense } from "react";
import { parseRepoInput } from "@/domain/repo-ref";
import { RepoError, RepoLoading, RepoView } from "@/components/repo/RepoView";
import { buildLiveData } from "@/components/v4/live-data";
import { V4Game } from "@/components/v4/V4Game";
import { preflightChat } from "@/server/chat/service";
import { specialistReadiness } from "@/server/specialist/config";
import { GitHubError } from "@/server/github/client";
import { fetchHistoryCached, type History } from "@/server/github/history";
import type { GhostView } from "@/components/entity/GhostPanel";
import { resolveEntityForRepo } from "@/server/entity/resolve";
import { summonRepository } from "@/server/github/summon";
import { clientKeyFromHeaders, getLimits } from "@/server/limits";

async function Seance({ params, searchParams }: { params: Promise<{ owner: string; repo: string }>; searchParams: Promise<{ ui?: string | string[] }> }) {
  const { owner, repo } = await params;
  const classic = (await searchParams).ui === "classic";
  const input = `${owner}/${repo}`;
  const ref = parseRepoInput(input);
  if (!ref.ok) {
    return <RepoError title="Invalid repository" error={ref} input={input} />;
  }
  // Request-time work below (clock, rate limits, network) must not run during prerendering.
  await connection();
  const clientKey = clientKeyFromHeaders(await headers());
  const limits = getLimits();
  const perClient = limits.summonPage.take(clientKey);
  const limit = perClient.allowed ? limits.summonPageGlobal.take("all") : perClient;
  if (!limit.allowed) {
    return (
      <RepoError
        title="Too many summons"
        error={{ code: "rate_limited", message: `You are summoning quickly. Try again in ${limit.retryAfterSec} seconds.` }}
      />
    );
  }
  const result = await summonRepository({ owner: ref.owner, repo: ref.repo });
  if (!result.ok) {
    const title = result.error.code === "not_found" ? "Nothing to summon" : "The summoning failed";
    return <RepoError title={title} error={result.error} input={input} />;
  }
  const entity = await resolveEntityForRepo(result.data.repo, { clientKey });
  const ghost: GhostView =
    entity.status === "error"
      ? { status: "error", message: entity.message }
      : entity.status === "provisional"
        ? { status: "provisional", assignment: entity.assignment, reason: entity.reason }
        : { status: "persisted", assignment: entity.assignment };
  if (!classic) {
    // The V4 game is the main experience. The classic screen stays reachable at ?ui=classic.
    if (ghost.status === "error") return <RepoError title="Ghost unavailable" error={{ code: "stored_invalid", message: ghost.message }} />;
    let history: History | null = null;
    let historyProblem: string | null = null;
    try {
      history = await fetchHistoryCached(result.data.repo);
    } catch (err) {
      historyProblem = `The commit history could not be loaded (${err instanceof GitHubError ? err.message : "unexpected error"}). Only the latest commit is shown, if it was read.`;
    }
    const pre = preflightChat(process.env, () => undefined);
    const replyMode = pre.ok ? (pre.config.provider === "bedrock" ? "model" : "scripted") : "unavailable";
    return <V4Game data={buildLiveData({ summoned: result.data, history, historyProblem, ghost, replyMode, specialist: specialistReadiness().ok })} />;
  }
  // Debug controls and internal IDs are shown only by `next dev`, never in production builds.
  const devTools = process.env.NODE_ENV === "development";
  return <RepoView data={result.data} ghost={ghost} devTools={devTools} />;
}

export default function RepoPage({ params, searchParams }: PageProps<"/repo/[owner]/[repo]">) {
  return (
    <main id="main">
      <Suspense fallback={<RepoLoading />}>
        <Seance params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
