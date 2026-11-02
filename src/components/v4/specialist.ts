import type { Stage } from "./data";

/** What /api/specialist returns (src/server/specialist/analyze.ts). Facts here have passed the server's checks. */
export type CodeRecord = {
  findings: {
    summary: string;
    observations: { text: string; from: number; to: number; url: string }[];
    uncertainties: string[];
    followUps: string[];
  };
  framing: string[];
  model: string;
  commit: { sha: string; shortSha: string; date: string };
  path: string;
  dropped: number;
};
export type SpecialistResult = { ok: true; record: CodeRecord } | { ok: false; code: string; message: string };

/** Ask the Specialist about a file (and lines) at an exact commit. Never throws. */
export async function askSpecialist(input: { owner: string; repo: string; path: string; at: string; from?: number; to?: number; question?: string; stage?: Stage }, fetchImpl: typeof fetch = fetch): Promise<SpecialistResult> {
  try {
    const res = await fetchImpl("/api/specialist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const body = (await res.json()) as { ok: true; answer: CodeRecord } | { ok: false; code: string; message: string };
    return body.ok ? { ok: true, record: body.answer } : { ok: false, code: body.code, message: body.message };
  } catch {
    return { ok: false, code: "network", message: "The Specialist cannot be reached right now." };
  }
}

/** A short, readable model name for the record's label ("us.anthropic.claude-sonnet-5-5" → "Claude Sonnet 5.5"). */
export function modelLabel(id: string): string {
  const m = /claude-(sonnet|opus|haiku)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  return `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length <= 2 ? `.${m[3]}` : ""}`;
}
