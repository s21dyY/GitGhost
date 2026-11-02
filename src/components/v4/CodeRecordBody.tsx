"use client";

import { modelLabel, type CodeRecord } from "./specialist";

/**
 * The Code Record: the Specialist's findings exactly as the server checked them. Every observation carries a link to
 * the precise lines at the exact commit it read. Uncertainties are shown as uncertain; follow-ups can be asked.
 */
export function CodeRecordBody({ record, onFollowUp, busy }: { record: CodeRecord; onFollowUp: (q: string) => void; busy: boolean }) {
  const f = record.findings;
  return (
    <div className="v4-record" data-testid="code-record">
      <p className="v4-record-meta">
        <span className="v4-ai-tag">AI</span>
        Written by {modelLabel(record.model)}, checked against the code. <span className="v4-sha">{record.path}</span> at <span className="v4-sha">{record.commit.shortSha}</span>
      </p>
      <h3 className="v4-h">What it does</h3>
      <p className="v4-record-summary">{f.summary}</p>
      <h3 className="v4-h">Observations</h3>
      <ol className="v4-record-obs">
        {f.observations.map((o) => (
          <li key={`${o.from}-${o.to}-${o.text}`}>
            <p>{o.text}</p>
            <a href={o.url} target="_blank" rel="noopener noreferrer" className="v4-link">
              Lines {o.from}{o.to > o.from ? `–${o.to}` : ""} at {record.commit.shortSha}<span className="sr-only"> (opens in a new tab)</span> ↗
            </a>
          </li>
        ))}
      </ol>
      {record.dropped ? <p className="v4-quiet">{record.dropped} more {record.dropped === 1 ? "observation was" : "observations were"} left out: {record.dropped === 1 ? "it" : "they"} did not check out against the code.</p> : null}
      {f.uncertainties.length ? (
        <>
          <h3 className="v4-h">Not certain</h3>
          <ul className="v4-record-unsure">{f.uncertainties.map((u) => <li key={u}>{u}</li>)}</ul>
        </>
      ) : null}
      {f.followUps.length ? (
        <>
          <h3 className="v4-h">Ask next</h3>
          <ul className="v4-record-next">
            {f.followUps.map((q) => (
              <li key={q}><button type="button" className="v4-menu-item" onClick={() => onFollowUp(q)} disabled={busy}>{q}</button></li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
