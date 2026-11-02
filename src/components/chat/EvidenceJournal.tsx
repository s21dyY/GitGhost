"use client";

import type { SegmentKind } from "@/domain/chat";
import { useConversation } from "./ConversationProvider";

export type JournalSource = { kind: string; url: string; revisionSha?: string };
export type JournalReadme = { excerpt: string; truncated: boolean };

const TAGS: Record<Exclude<SegmentKind, "ghost">, { label: string; cls: string }> = {
  verified: { label: "Record", cls: "tag-record" },
  interpretation: { label: "Reading", cls: "tag-reading" },
  unknown: { label: "Not found", cls: "tag-missing" },
};

/**
 * Secondary archive: the claims of every answer next to their sources, plus the page's own
 * sources and the README excerpt. Shown inside the Journal drawer; the chat stays mounted underneath.
 * Fictional ghost lines are left out on purpose: only facts, readings and gaps are journaled.
 */
export function EvidenceJournal({ sources, retrievedAt, readme }: { sources: JournalSource[]; retrievedAt: string; readme: JournalReadme | null }) {
  const { turns } = useConversation();
  const entries = turns.filter((t) => t.status === "done" && t.answer).reverse();

  return (
    <div data-testid="journal">
      <div className="space-y-5">
        <p className="text-base" style={{ color: "var(--bone-dim)" }}>
          {entries.length === 0 ? "No answers yet" : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        </p>
          <section aria-label="Answers and their sources">
            <h3 className="font-label text-xs text-gold">Answer ledger</h3>
            {entries.length === 0 ? (
              <p className="mt-1 text-base" style={{ color: "var(--bone-dim)" }}>
                Ask the ghost something. Each answer will be filed here with its claims and sources.
              </p>
            ) : (
              <ol className="mt-2 space-y-4">
                {entries.map((t) => {
                  const a = t.answer!;
                  const number = new Map(a.sources.map((s, i) => [s.id, i + 1]));
                  const claims = a.segments.filter((s) => s.kind !== "ghost");
                  return (
                    <li key={t.id} id={`journal-entry-${t.id}`} tabIndex={-1} className="border-l-4 border-[var(--edge)] pl-3">
                      <h4 className="text-base font-bold text-bone">“{t.question}”</h4>
                      <ul className="mt-2 space-y-2">
                        {claims.map((s, i) => {
                          const tag = TAGS[s.kind as keyof typeof TAGS];
                          return (
                            <li key={i} className="text-base">
                              <span className={`rpg-tag ${tag.cls}`}>{tag.label}</span>
                              {s.text}
                              {s.citations.map((c) => (
                                <span key={c.id} className="ml-1 text-gold">[{number.get(c.id)}]</span>
                              ))}
                            </li>
                          );
                        })}
                      </ul>
                      {a.sources.length ? (
                        <>
                          <p className="font-label mt-3 text-xs text-gold">Sources</p>
                          <ol className="mt-1 list-decimal pl-6 text-base">
                            {a.sources.map((s) => (
                              <li key={s.id}>
                                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-violet underline underline-offset-4 hover:text-white">
                                  {s.label} (opens in a new tab)
                                </a>
                              </li>
                            ))}
                          </ol>
                        </>
                      ) : null}
                      {a.gaps.length ? <p className="mt-2 text-base text-crimson">Could not read: {a.gaps.join("; ")}</p> : null}
                      <p className="mt-2 text-sm" style={{ color: "var(--bone-dim)" }}>
                        {a.scripted ? "Scripted reply from fixed templates; no AI model was called. " : ""}
                        Ghost dialogue is fiction and is not filed here.
                      </p>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section aria-label="Repository sources">
            <h3 className="font-label text-xs text-gold">Repository sources</h3>
            <ul className="mt-1 list-disc pl-6 text-base">
              {sources.map((s) => (
                <li key={s.url}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-violet underline underline-offset-4 hover:text-white">
                    {s.kind} (opens in a new tab)
                  </a>
                  {s.revisionSha ? <span style={{ color: "var(--bone-dim)" }}> at {s.revisionSha.slice(0, 7)}</span> : null}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-sm" style={{ color: "var(--bone-dim)" }}>
              Retrieved {retrievedAt}. Live data, not a recorded snapshot.
            </p>
          </section>

          {readme ? (
            <section aria-label="README excerpt">
              <h3 className="font-label text-xs text-gold">README excerpt</h3>
              <pre
                tabIndex={0}
                aria-label="README excerpt, plain text"
                className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words bg-[#080b17] p-3 font-mono text-sm"
                style={{ boxShadow: "inset 0 0 0 4px var(--edge)" }}
              >
                {readme.excerpt || "(README is empty or too large to read.)"}
              </pre>
              <p className="mt-1 text-sm" style={{ color: "var(--bone-dim)" }}>
                {readme.truncated ? "Truncated excerpt. " : ""}Repository text is shown as plain text and treated as untrusted.
              </p>
            </section>
          ) : null}
      </div>
    </div>
  );
}
