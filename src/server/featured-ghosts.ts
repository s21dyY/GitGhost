import { getAssignmentStore } from "@/server/storage";

/**
 * The saved ghosts of the featured repositories, read once for the landing page. READ ONLY: this never creates an
 * identity, so showing the landing page cannot decide what a repository's ghost will be. Any failure (no table, no
 * credentials, slow network) yields "not known" and the page falls back to a fixed look.
 */
export type FeaturedGhost = { originId: string; stage: "human" | "distorted" | "transformed" } | null;

const TTL_MS = 5 * 60_000;
let cache: { at: number; value: Map<number, FeaturedGhost> } | undefined;

export function resetFeaturedGhostsForTests() {
  cache = undefined;
}

export async function readFeaturedGhosts(ids: readonly number[], deps: { store?: Pick<ReturnType<typeof getAssignmentStore>, "get">; now?: () => number; timeoutMs?: number } = {}): Promise<Map<number, FeaturedGhost>> {
  const now = (deps.now ?? Date.now)();
  if (!deps.store && cache && now - cache.at < TTL_MS) return cache.value;
  const out = new Map<number, FeaturedGhost>(ids.map((id) => [id, null]));
  try {
    const store = deps.store ?? getAssignmentStore();
    const limit = deps.timeoutMs ?? 1500;
    const all = Promise.all(
      ids.map(async (id) => {
        const a = await store.get(id);
        if (a) out.set(id, { originId: a.originId, stage: a.currentStage });
      }),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([all, new Promise<void>((resolve) => { timer = setTimeout(resolve, limit); })]).finally(() => clearTimeout(timer));
  } catch {
    /* unknown, not an error the visitor needs to see */
  }
  if (!deps.store && [...out.values()].some(Boolean)) cache = { at: now, value: out };
  return out;
}
