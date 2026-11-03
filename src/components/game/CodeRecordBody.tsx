"use client";

import { modelLabel, type CodeRecord } from "./specialist";

/**
 * The Code Record: the Specialist's findings exactly as the server checked them. Every observation carries a link to
 * the precise lines (or, for the codebase as a whole, the file or folder) at the exact commit it read. Uncertainties are shown as uncertain; follow-ups can be asked.
 */
export function CodeRecordBody({ record, onFollowUp, busy }: { record: CodeRecord; onFollowUp: (q: string) => void; busy: boolean }) {
  const f = record.findings;
  return (
    <div className="gg-record" data-testid="code-record">
      <p className="gg-record-meta">
        <span className="gg-ai-tag">AI</span>
        Written by {modelLabel(record.model)}, checked against the code. <span className="gg-sha">{record.path ?? "The whole codebase"}{record.from ? `:${record.from}${record.to && record.to > record.from ? `–${record.to}` : ""}` : ""}</span> at <span className="gg-sha">{record.commit.shortSha}</span>
      </p>
      <h3 className="gg-h">{record.path ? "What it does" : "What it is"}</h3>
      <p className="gg-record-summary">{f.summary}</p>
      <h3 className="gg-h">Observations</h3>
      <ol className="gg-record-obs">
        {f.observations.map((o) => (
          <li key={`${o.path}:${o.from ?? ""}-${o.text}`}>
            <p>{o.text}</p>
            <a href={o.url} target="_blank" rel="noopener noreferrer" className="gg-link">
              {o.from ? <>Lines {o.from}{o.to && o.to > o.from ? `–${o.to}` : ""}</> : <span className="gg-sha">{o.path}</span>} at {record.commit.shortSha}<span className="sr-only"> (opens in a new tab)</span> ↗
            </a>
          </li>
        ))}
      </ol>
      {record.dropped ? <p className="gg-quiet">{record.dropped} more {record.dropped === 1 ? "observation was" : "observations were"} left out: {record.dropped === 1 ? "it" : "they"} did not check out against the code.</p> : null}
      {f.uncertainties.length ? (
        <>
          <h3 className="gg-h">Not certain</h3>
          <ul className="gg-record-unsure">{f.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul>
        </>
      ) : null}
      {f.followUps.length ? (
        <>
          <h3 className="gg-h">Ask next</h3>
          <ul className="gg-record-next">
            {f.followUps.map((q) => (
              <li key={q}><button type="button" className="gg-menu-item" onClick={() => onFollowUp(q)} disabled={busy}>{q}</button></li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
