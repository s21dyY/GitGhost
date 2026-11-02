import { answerQuestion } from "@/server/chat/pipeline";
import { parseChatBody } from "@/server/chat/request";
import { clientKeyFromHeaders, getLimits } from "@/server/limits";

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

/**
 * POST /api/chat. Same-origin only. Limits run BEFORE any GitHub retrieval; the model-facing safety
 * pipeline (runChat) applies its own limits again. No chat history is stored server side.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      /* mismatch below */
    }
    if (originHost !== (request.headers.get("host") ?? new URL(request.url).host)) {
      return json({ ok: false, code: "bad_origin", message: "Cross-site requests are not allowed." }, 403);
    }
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return json({ ok: false, code: "bad_request", message: "Send JSON." }, 415);
  }

  const limits = getLimits();
  const perClient = limits.chatApi.take(clientKeyFromHeaders(request.headers));
  const gate = perClient.allowed ? limits.chatApiGlobal.take("all") : perClient;
  if (!gate.allowed) {
    return json(
      { ok: false, code: "rate_limited", message: `Too many questions. Try again in ${gate.retryAfterSec} seconds.`, retryAfterSec: gate.retryAfterSec },
      429,
      { "Retry-After": String(gate.retryAfterSec) },
    );
  }

  const parsed = parseChatBody(await request.text());
  if (!parsed.ok) return json({ ok: false, code: parsed.code, message: parsed.message }, parsed.status);

  try {
    const result = await answerQuestion({
      owner: parsed.owner,
      repo: parsed.repo,
      question: parsed.question,
      history: parsed.history,
      form: parsed.form,
      asOf: parsed.asOf,
      eraStage: parsed.eraStage,
      headers: request.headers,
    });
    if (!result.ok) {
      return json(
        { ok: false, code: result.code, message: result.message, ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}) },
        result.status,
        result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {},
      );
    }
    return json({ ok: true, answer: result.answer }, 200);
  } catch {
    return json({ ok: false, code: "internal", message: "Something went wrong. Try again." }, 500);
  }
}
