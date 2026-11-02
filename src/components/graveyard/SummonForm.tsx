"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseRepoInput, repoPath } from "@/domain/repo-ref";
import { createLatestGuard } from "@/lib/latest-request";
import { RPGPanel } from "@/components/rpg/RPGPanel";
import { useSummon } from "./SummonProvider";

type Status = "idle" | "checking";

export function SummonForm() {
  const summon = useSummon();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const guard = useRef(createLatestGuard());

  useEffect(() => {
    const g = guard.current;
    return () => g.cancel();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Local validation first: instant, and the input is preserved on failure.
    const parsed = parseRepoInput(value);
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }

    const ticket = guard.current.begin();
    setStatus("checking");
    try {
      const res = await fetch("/api/summon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: value }),
        signal: ticket.signal,
      });
      const body = (await res.json()) as
        | { ok: true; owner: string; repo: string }
        | { ok: false; message?: string };
      // A newer submission or unmount makes this response stale: ignore it.
      if (!ticket.isCurrent()) return;
      if (!body.ok) {
        setError(body.message ?? "Could not summon that repository.");
        setStatus("idle");
        return;
      }
      setStatus("idle");
      summon(repoPath({ owner: body.owner, repo: body.repo }));
    } catch {
      if (!ticket.isCurrent()) return;
      setError("Could not reach GitGhost. Check your connection and try again.");
      setStatus("idle");
    }
  }

  return (
    <RPGPanel as="div" tone="teal" className="mx-auto mt-8 max-w-2xl p-4 text-left sm:p-5">
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="summon-input" className="rpg-title block">
          Summon your own
        </label>
        <p id="summon-hint" className="mt-2 text-base text-bone/90">
          Enter a public repository, like <code className="text-gold">owner/repo</code> or{" "}
          <code className="text-gold">github.com/owner/repo</code>.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-stretch">
          <input
            id="summon-input"
            name="repository"
            type="text"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "summon-hint summon-error" : "summon-hint"}
            placeholder="mozilla/pdf.js"
            className="rpg-input min-h-11 flex-1"
          />
          <button type="submit" disabled={status === "checking"} className="rpg-btn rpg-btn-primary">
            {status === "checking" ? "Summoning…" : "Summon"}
          </button>
        </div>
        <p id="summon-error" role="alert" className="mt-2 min-h-6 text-base text-crimson">
          {error}
        </p>
      </form>
    </RPGPanel>
  );
}
