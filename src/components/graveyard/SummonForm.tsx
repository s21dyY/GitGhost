"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseRepoInput, repoPath } from "@/domain/repo-ref";
import { createLatestGuard } from "@/lib/latest-request";
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
      summon(repoPath({ owner: body.owner, repo: body.repo }), undefined, "named");
    } catch {
      if (!ticket.isCurrent()) return;
      setError("Could not reach GitGhost. Check your connection and try again.");
      setStatus("idle");
    }
  }

  // The game's command line: speak a repository's name to summon its ghost. Hotkey N (see GraveyardGame).
  return (
    <form onSubmit={onSubmit} noValidate className="game-summon" aria-label="Summon by name">
      <label htmlFor="summon-input" className="game-summon-label">Speak a name</label>
      <div className="game-summon-row">
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
          placeholder="owner/repo"
          className="game-summon-input"
        />
        <button type="submit" disabled={status === "checking"} className="game-summon-btn">
          {status === "checking" ? "Summoning…" : "Summon"}
        </button>
      </div>
      <p id="summon-hint" className="sr-only">A public GitHub repository, like owner/repo or github.com/owner/repo.</p>
      <p id="summon-error" role="alert" className="game-summon-error">{error}</p>
    </form>
  );
}
