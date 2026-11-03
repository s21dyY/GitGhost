# V6.3 Conversational freedom with evidence-grounded facts

Rule: fictional and emotional dialogue may be creative. Factual claims about real repositories stay evidence-grounded.

## Phase 1 audit (written before any behavior change)

Files read: `server/chat/grounding.ts` (parser + validators), `prompt.ts` (contract), `pipeline.ts` (validation, error mapping),
`providers/bedrock.ts`, `types.ts`, `voice.ts`, `domain/chat.ts`, `components/v4/{ask.ts,dialogue.tsx,panels.tsx}`.

The visitor message "The ghost's answer could not be verified, so it was not shown" is the HTTP 502 `unverifiable_answer`.
It is produced only when `validateModelOutput` refuses the WHOLE reply (`!validated.ok`). A single bad segment never causes it.
Whole-reply refusal happens for: `invalid_json`, `not_an_object`, `unknown_top_level_keys`, `segments_missing/not_array/empty`,
`too_many_segments` (>12), `all_segments_malformed`.

Likely causes for harmless fictional replies, against the six questions in the brief:

1. Strict output structure: YES. The prompt demands exactly one JSON object, 2-6 segments, a fixed ghost / fact / unknown shape.
   A model that answers "Are you lonely?" in prose, or adds any extra top-level key, is refused outright.
2. Missing evidence references: NOT the 502 cause. Missing cites only drops that one factual segment (`no_citation`).
3. Overly broad factual-claim detection: YES, for ghost lines. `ghost` segments are rejected for ANY digit, more than 4 ellipses,
   any 5-character repeat ("Aaaaah"), text over 240 characters, under 60% letters, or any CAUSAL/MOTIVE word
   ("abandoned", "felt", "left"). Stutters, repeated phrases and emotion are exactly what a horror ghost does.
4. Creative and factual text combined: YES. Validation is per segment, so a creative sentence that contains one number or
   one motive word kills the whole segment, including its harmless sentences.
5. Model formatting errors: YES. `maxOutputTokens` is a hard cap and the reply is JSON; a long, expressive reply that hits the cap
   is truncated, fails `JSON.parse`, and the entire reply (including already-complete segments) is refused (`invalid_json`).
   Bedrock temperature is fixed at 0.2, which also pushes toward the rigid template and the example's wording.
6. Whole reply rejected instead of individual claims: PARTLY. Segments are independent, but sentences inside a segment are not,
   and a truncated or prose reply has no partial path.

Other findings:
- The prompt tells the model every answer needs cited facts ("Never reply with only unknown..."), so character questions are forced into
  fact-shaped answers.
- When every ghost segment is rejected, the pipeline appends "I could not support an answer", which reads as a failure for a
  question that never needed support.
- Normal mode still shows `ReplyNote` ("AI-written, checked against sources"), a per-line Records seal on every segment and a
  "Record:" greeting line. Tag text is `sr-only` outside `?dev=1`, so "Record:" and "Not found:" are not visibly drawn, but the
  reply note and per-line seals are.
- Error mapping (`route.ts` / `pipeline.ts`) is fine; only the wording of the 502 is unhelpful.

## Design

Schema stays `{"segments":[...]}` for compatibility. The existing kinds already separate the concerns:

| kind | meaning | rule |
| --- | --- | --- |
| `ghost` | fiction, emotion, atmosphere | no citation needed; checked per SENTENCE for concrete repository claims |
| `verified` / `interpretation` | factual claim units | need valid `cites`; checked per SENTENCE against the cited evidence |
| `unknown` | uncertainty / unsupported information | no cites |

Intent (deterministic, `server/chat/conversation.ts`): `character`, `factual`, `mixed`. It shapes the prompt and decides whether the
server adds an uncertainty line. It never decides what is true.

## What changed (verified offline only)

- `server/chat/conversation.ts`: `classifyTurn` (character / factual / mixed) and per-kind temperature (0.8 / 0.6 / provider default 0.2).
- `prompt.ts`: contract allows 1-6 segments and free-form ghost fiction; separate answer shapes for character and mixed turns.
- `grounding.ts`:
  - ghost text is checked per sentence; a sentence stating a date, year, version, #number, hash, count of commits/issues/stars,
    "first/last commit", archived/merged/released, maintainers/contributors, a motive/cause, or (in a historical era) hindsight is removed alone;
  - ghost readability only refuses extreme cases (over 400 characters, mostly symbols, 12+ repeats of one character);
  - factual sentences are each checked against their cited evidence and removed alone;
  - ghost numbers/#refs/source phrases stay allowed when the segment cites evidence that contains them (scripted issue performance);
  - truncated replies keep their complete segments; plain prose becomes ghost text only for character/mixed turns, never with links or braces;
  - a recovered reply with nothing usable left is still refused.
- `pipeline.ts`: removed factual claims add "Some of what I meant to say could not be confirmed..." (or the old "could not support" line if nothing is left); character turns get no forced uncertainty line; 502 wording changed.
- UI (`dialogue.tsx`): outside `?dev=1` no reply note, no greeting "Record" line, no per-line seals; one seal per reply opens Records.
- Not changed: strict top-level key rule, citation registry, link rejection, era evidence scope, no second AI call.

## Known limits

- Soft fiction that implies history without hard cues ("the project was popular") is not detectable and is allowed in ghost text.
- Spelled-out numbers other than the listed repo-noun patterns are not checked.
- The era hindsight list is a keyword list, not a proof.
- Not verified: a live Bedrock call, a browser run, screen-reader behavior.
