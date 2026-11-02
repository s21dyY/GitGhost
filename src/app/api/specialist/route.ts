import { z } from "zod";
import { analyzeCode } from "@/server/specialist/analyze";
import { clientKeyFromHeaders, getLimits } from "@/server/limits";

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...extra } });

const Body = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
  path: z.string().min(1).max(300),
  at: z.string().regex(/^[0-9a-f]{40}$/),
  from: z.number().int().min(1).max(200_000).optional(),
  to: z.number().int().min(1).max(200_000).optional(),
  question: z.string().max(200).optional(),
  stage: z.enum(["human", "distorted", "transformed"]).optional(),
}).strict();

/**
 * POST /api/specialist: a deep reading of one file (or a few lines of it) at an exact commit, by the Specialist model,
 * introduced by the ghost. Asked for explicitly by the player; never part of ordinary conversation. Same-origin only.
 * The in-process limiter runs before anything is read; runChat then applies the Specialist's own guards (its kill
 * switch and the shared one, its request cap, its budget, the shared concurrency lease).
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
    return json({ ok: false, code: "rate_limited", message: `Too many requests. Try again in ${gate.retryAfterSec} seconds.`, retryAfterSec: gate.retryAfterSec }, 429, { "Retry-After": String(gate.retryAfterSec) });
  }

  const raw = await request.text();
  if (raw.length > 2000) return json({ ok: false, code: "too_long", message: "Request body is too large." }, 413);
  let body: z.infer<typeof Body>;
  try {
    const parsed = Body.safeParse(JSON.parse(raw));
    if (!parsed.success) return json({ ok: false, code: "bad_request", message: "That request is not one the Specialist understands." }, 400);
    body = parsed.data;
  } catch {
    return json({ ok: false, code: "bad_request", message: "Send JSON." }, 400);
  }

  try {
    const result = await analyzeCode({ ...body, headers: request.headers });
    if (!result.ok) {
      return json({ ok: false, code: result.code, message: result.message, ...(result.retryAfterSec ? { retryAfterSec: result.retryAfterSec } : {}) }, result.status, result.retryAfterSec ? { "Retry-After": String(result.retryAfterSec) } : {});
    }
    return json({ ok: true, answer: result.answer }, 200);
  } catch {
    return json({ ok: false, code: "internal", message: "Something went wrong. Try again." }, 500);
  }
}
