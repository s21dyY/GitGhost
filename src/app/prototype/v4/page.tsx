import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { mockGameData } from "@/components/v4/mock-data";
import { V4Game } from "@/components/v4/V4Game";

/**
 * GitGhost V4 haunted-RPG prototype. Isolated: it is not linked from the app, imports no server code,
 * and uses invented fixtures only (see src/components/v4/fixtures.ts). In production it is hidden
 * unless GITGHOST_PROTOTYPES=1 is set at request time.
 */
export const metadata = { title: "GitGhost V4 prototype (mock data)", robots: { index: false } };

async function Gate() {
  await connection(); // evaluate the gate per request, not at build time
  if (process.env.NODE_ENV === "production" && process.env.GITGHOST_PROTOTYPES !== "1") notFound();
  return <V4Game data={mockGameData()} tools />;
}

export default function Page() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}
