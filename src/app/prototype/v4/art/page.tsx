import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArtLab } from "@/components/v4/ArtLab";

/** Character art review page. Same gate as /prototype/v4: hidden in production unless GITGHOST_PROTOTYPES=1. */
export const metadata = { title: "GitGhost V4 character art lab (fictional)", robots: { index: false } };

async function Gate() {
  await connection(); // evaluate the gate per request, not at build time
  if (process.env.NODE_ENV === "production" && process.env.GITGHOST_PROTOTYPES !== "1") notFound();
  return <ArtLab />;
}

export default function Page() {
  return (
    <Suspense>
      <Gate />
    </Suspense>
  );
}
