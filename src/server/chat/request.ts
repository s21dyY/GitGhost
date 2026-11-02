import { z } from "zod";
import { parseRepoInput } from "@/domain/repo-ref";

export const MAX_BODY_BYTES = 16_000;
export const MAX_QUESTION_CHARS = 500;
export const MAX_HISTORY_TURNS = 8;
export const MAX_TURN_CHARS = 1200;

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const text = (max: number) => z.string().min(1).max(max).refine((s) => !CONTROL.test(s), "Control characters are not allowed.");

/**
 * Strict body: unknown fields are rejected, so a browser cannot smuggle in a system prompt,
 * personality, evidence or citation list. Only the question, the earlier turns (as plain text)
 * and which form to speak in are accepted. Everything else comes from the server.
 */
export const ChatBodySchema = z.strictObject({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(200),
  question: text(MAX_QUESTION_CHARS),
  history: z
    .array(z.strictObject({ role: z.enum(["user", "assistant"]), content: text(MAX_TURN_CHARS) }))
    .max(MAX_HISTORY_TURNS)
    .default([]),
  form: z.enum(["current", "human"]).default("current"),
  /** Time Travel: answer only from evidence at or before this commit. Checked against the repository on the server. */
  asOf: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  /** How the ghost looks in that era (a presentation choice: it changes voice only, never the saved identity). */
  eraStage: z.enum(["human", "distorted", "transformed"]).optional(),
});
export type ChatBody = z.infer<typeof ChatBodySchema>;

export type ParsedChat =
  | { ok: true; owner: string; repo: string; question: string; history: ChatBody["history"]; form: ChatBody["form"]; asOf?: string; eraStage?: ChatBody["eraStage"] }
  | { ok: false; status: number; code: "bad_request" | "too_large"; message: string };

export function parseChatBody(raw: string): ParsedChat {
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return { ok: false, status: 413, code: "too_large", message: "That request is too large." };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400, code: "bad_request", message: "Send JSON." };
  }
  const parsed = ChatBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false, status: 400, code: "bad_request", message: "The question or conversation is not valid." };
  const ref = parseRepoInput(`${parsed.data.owner}/${parsed.data.repo}`);
  if (!ref.ok) return { ok: false, status: 400, code: "bad_request", message: ref.message };
  const history = parsed.data.history;
  if (history.length && history[history.length - 1].role !== "assistant") {
    return { ok: false, status: 400, code: "bad_request", message: "The conversation must end with the ghost's reply." };
  }
  return { ok: true, owner: ref.owner, repo: ref.repo, question: parsed.data.question.trim(), history, form: parsed.data.form, ...(parsed.data.asOf ? { asOf: parsed.data.asOf, eraStage: parsed.data.eraStage } : {}) };
}
