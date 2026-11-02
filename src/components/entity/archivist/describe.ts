import { HUMANS, MUTATIONS } from "@/config/entities";
import type { Stage } from "./sprites";

/** Plain-text description built from the entity config. Never contains repository facts. */
export function describeArchivist(stage: Stage, mutationIds: readonly string[]): { summary: string; traits: string[] } {
  const origin = HUMANS.find((h) => h.id === "archivist");
  if (!origin) throw new Error("Archivist config missing");
  const d = origin.stages[stage];
  const traits = mutationIds.flatMap((id) => {
    const m = MUTATIONS.find((x) => x.id === id);
    const text = m?.stages[stage];
    return m && text && text !== "None" ? [text] : [];
  });
  return {
    summary: `${d.silhouette}. Face: ${d.face}. Holding ${origin.signatureObject.replace(/^A /, "a ")}.`,
    traits,
  };
}

export const STAGE_LABELS: Record<Stage, { label: string; note?: string }> = {
  human: {
    label: "Before the forgetting",
    note: "Imagined origin inspired by repository metadata. It does not depict a real person or author, and it says nothing about the repository's history.",
  },
  distorted: { label: "Distorted" },
  transformed: { label: "Transformed" },
};
