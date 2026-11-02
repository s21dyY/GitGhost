# Milestone 2C.3: evidence-rich AI conversation

Status: **implemented and tested offline. Not yet tried on a real model.** No Bedrock call, no unlock, no AWS change, no IAM change, no deployment, no commit. `KILL#bedrock` stayed ON, `.env.local` stayed in mock mode with the live flags off.

## Why

The one real Amazon Nova Lite call (Milestone 2C.2, `docs/NOVA_LITE_2C2.md` section 12) returned this, valid but thin:

```json
{"segments":[{"kind":"unknown","text":"The reason for the repository's end is not detailed in the evidence."}],
 "ghost":[{"kind":"ghost","text":"The end... is not... clear."}]}
```

Three separate problems, each now addressed:

| # | Problem observed | Cause found | Fix |
|---|---|---|---|
| 1 | The ghost line vanished with no trace | The parser read `segments` and ignored every other key | Strict contract: any other top-level key refuses the reply, and the reason is reported |
| 2 | One "not found" sentence, no citations, although `archived: true` and the README's archive notice were available | The model was shown **ten loosely ranked items**, five of them comments on a 2015 package-upgrade thread (a body mentioning "deprecations" earned the issue a +60 status boost), and nothing told it which facts mattered | A deterministic evidence planner and server-extracted key facts |
| 3 | Almost no character in what was shown | The instructions asked for voice but did not require a shape | Required answer shape (ghost line, cited facts, stated gap) plus stage-specific glitch limits |

A side benefit of removing the noise: the old prompt carried five comments from strangers, including one with a personal social-media handle. Those no longer reach the model for status questions.

## 1. Output contract (`prompt.ts`, `grounding.ts`)

- The prompt now demands **exactly one JSON object whose only key is `segments`**, an array of 2 to 6 objects holding everything the reader should see, including ghost lines. It states that any other top-level key (it names `"ghost"` and `"notes"`) voids the whole reply.
- Segment keys are `kind`, `text` and, for verified and interpretation, `cites`. `cites` are server-issued E-numbers only; the prompt forbids URLs, E-numbers inside text, and invented E-numbers. Links are still rebuilt from the server's registry and never taken from model text.
- A **worked example** (`EXAMPLE_JSON`) uses a fictional repository ("example-org/moth-lantern"), is labelled as fictional and format-only, and is told never to be repeated. Because a model could copy it, the validator rejects any segment containing the example's distinctive phrases (`copied_example`), and a test asserts that all three example segments are rejected even when their references happen to exist.
- The example has no real facts: no repository name from any real project, no digits, no links.

## 2. No silent data loss (`grounding.ts`, `pipeline.ts`)

**Decision: strict.** Any unknown top-level key refuses the whole reply (`unknown_top_level_keys`); an alternative top-level `ghost` array is **not** accepted. Reasons: the first real reply hid content in exactly such a key; accepting a place the contract does not allow would make correctness depend on guessing which unexpected keys are harmless; and partial acceptance would present an answer that quietly omitted half of what the model said. The cost is that a non-compliant billed reply is wasted (about USD 0.0002); the example and the explicit warning in the prompt are the mitigation. If a real model keeps adding keys, a tolerant mapping would be a separate decision.

Other changes, all fail-closed:

- **Per-segment validation.** One malformed or over-long segment no longer discards the rest; it is rejected on its own (`malformed_segment`). If every segment is malformed the reply is refused (`all_segments_malformed`).
- **Unknown keys inside a segment** (for example `url` or `source`) are ignored, never used, and reported, because everything that matters is rebuilt server-side.
- **Diagnostics** (`OutputDiagnostics`) on every reply: JSON status, fence, top-level key names (sanitized to `[A-Za-z0-9_.-]`, 40 characters, at most 8, so untrusted output cannot inject log lines), unknown keys, segment count, per-segment rejection reasons with index, ignored segment keys, counts accepted by kind, the provider's stop reason, whether the reply was **truncated** (`max_tokens`), and for accepted replies a **quality** summary (ghost / factual / unknown counts, key facts offered, cited references, and `thin`).
- **Developer log events**: `model_output_rejected`, `model_output_partly_rejected`, `model_answer_thin`. Codes and counts only: the model's text is untrusted and never goes to logs or to visitors. Tests assert the actual Nova words do not appear in the log.
- Diagnostics are kept apart from the user-visible answer. The visitor still sees the same generic "could not be verified" message when a reply is refused.
- The validation harness report now records `contractOk`, the diagnostics, and the answer's shape.

## 3. Evidence planner (`evidence/plan.ts`, `evidence/select.ts`)

For **status questions** the selection is a fixed priority order instead of a score:

1. the repository record (archived flag, last push),
2. the README (where archival notices live),
3. the newest commit,
4. only then issues, pull requests or comments that **read like a maintainer notice about the project's status** (title for issues and pull requests, sentence for comments, using a stricter pattern than before that no longer matches "deprecated API" chatter),
5. non-comment filler only when fewer than three of the above exist.

`keyFacts()` lifts the most relevant facts out of the selected items **word for word** (archived flag, last push date, the README's archive sentence stripped of markup and links, the newest commit headline and date, status-notice titles), each with the E-number of its source. They are given to the model inside the untrusted boundary (and neutralized like the evidence). `causeCheck()` reports whether any item states a reason next to a notice; for atom/atom it does not, and the prompt says so ("do not guess one"), noting that it is a keyword check that can miss one. The planner never writes a claim of its own. README views also drop CI badge and image markup (the raw excerpt used for validation is untouched).

Status rules in the prompt: archival is a fact, the reason is a separate question; give a reason only if an item literally states it, and quote it; inactivity, age or the last push date is never a cause; never guess what developers felt, wanted or decided.

## 4. Personality (`prompt.ts`)

Unchanged and preserved: the saved identity and the entity configuration (`buildCharacterDirection`, voice anchors, Archivist / cosmic / formal / distorted for atom/atom). Added:

- A required **answer shape**: one short ghost segment first (under 160 characters, no facts, numbers, or claims about developers), then one to three cited factual segments, then an `unknown` segment stating what is missing. A reply that is only "unknown" while relevant key facts exist is told off in the prompt and flagged `thin` in the diagnostics.
- **Readability limits on glitching**: human form none; distorted at most two ellipses or stutters per ghost segment; transformed at most four. The existing sentence "Glitching is allowed ONLY inside ghost segments..." is kept.
- Server-side ghost checks: at most 240 characters and 4 ellipses, mostly letters, no runs of one repeated character (`unreadable`); no digits; no claim of a cause or of what developers did (`invented_claim`). A bad ghost line is dropped alone; the facts survive.
- The ghost is told it may speak of its own mood, the pages and the dusk as fiction, and never invents events.

## 5. Further validator checks added (deterministic, cheap)

`invented_claim` (a person-like subject plus a motive/departure verb the cited text does not itself use), `contradicts_evidence` (a sentence about the archived flag that contradicts the cited repository record), `misattributed_source` (phrases such as "the README says" or "the newest commit" without citing an item of that kind; phrase-based so a quoted commit headline like "Merge pull request #..." cannot trigger it; the replay suite found and fixed exactly that false positive in my first version). Existing checks remain: bad references, missing citations, links, numbers/dates/versions that the cited evidence lacks, causal words.

## 6. Before and after, deterministic

All from fixtures (`src/server/chat/fixtures/atom-status.ts`: the exact Nova Lite reply and the captured atom/atom evidence; third-party @mentions replaced by placeholders). No network.

**Evidence shown to the model for "Why did you die?"**

| | References |
|---|---|
| Before (live call) | E1 repo-metadata, E2 readme, E3 issue (2015), E4 commit, E5 to E9 issue-comment (2015 thread), E10 pull-request: **10 items** |
| After | E1 repo-metadata, E2 readme, E3 commit: **3 items** |

**Key facts now handed to the model** (each copied from the item named):
```
- [E1] archived: true (GitHub's flag on the repository)
- [E1] last push: 2023-01-03
- [E2] README notice: "Atom and all repositories under Atom will be archived on December 15, 2022."
- [E3] newest commit retrieved (2022-11-22): "Merge pull request #25709 from atom/fix-snapshot-result-macos"
CAUSE CHECK: no retrieved item states a reason for the project ending (keyword check; it can miss one). ...
```

**Prompt size** (distorted form): before 7,263 bytes; after 6,388 bytes, about 3,206 estimated tokens against the 4,000 cap (the estimator is deliberately pessimistic at 1 token per 2 bytes; the real call measured about 3.4 bytes per token). The richer instructions fit because the irrelevant items are gone.

**The real reply, old versus new parser**

| | Result |
|---|---|
| Old (lenient) | Showed 1 sentence ("...not detailed in the evidence."). Dropped "The end... is not... clear." with no signal. |
| New (strict) | Refused: `unknown_top_level_keys` = `["ghost"]`, 1 segment seen, developer log event written, visitor sees the generic not-verified message. On the billable path the replay is billed 212 micro-dollars, exactly the real call's recorded cost. |

**A corrected reply (what a compliant model should produce), run through the real pipeline**
```
ghost            The pages grow quiet... but I still keep them, reader.
verified  [E1]   GitHub lists atom/atom as archived, which makes it read-only.
verified  [E2]   The README says: Atom and all repositories under Atom will be archived on December 15, 2022.
verified  [E3]   The newest commit I retrieved on the default branch reads Merge pull request #25709 from atom/fix-snapshot-result-macos, dated 2022-11-22.
unknown          The evidence does not say why the project was archived.
sources (server-built): github.com/atom/atom, .../blob/<sha>/README.md, .../commit/<sha>
```
Quality: 1 ghost, 3 factual, 1 unknown, 4 key facts offered, cited E1/E2/E3, `thin: false`, no warnings logged. This reply was written by me as a target, **not** produced by a model; it shows what the pipeline accepts, not what Nova will do.

The scripted mock (`GITGHOST_CHAT_PROVIDER=mock`, the default) also benefits from the new selection: browser checks in mock mode now show three sources (record, commit, README) for the status answer instead of dragging in an unrelated issue.

## 7. Tests (offline, fake providers, captured fixtures)

Suite: **681 passed, 4 skipped** (was 590 before this milestone), typecheck, lint and build clean. New or extended files:

| File | Covers |
|---|---|
| `grounding-strict.test.ts` (35) | strict top level, sanitized key names, every refusal reason, fence, per-segment tolerance, ignored segment keys, long explanations, example copying, ghost readability and invented claims, invented causes and motives, contradictions, misattribution, wrong dates, invented references, no model text in diagnostics |
| `evidence/plan.test.ts` (19) | status selection on the captured evidence (3 items, the 2015 thread excluded), the "deprecat" noise, notice detection, fill rule, determinism and byte budget, other intents unchanged, README view cleaning, key facts exact text, no links or merged headings, every number appears in its source, both commit shapes, cause check |
| `prompt.test.ts` (17) | contract wording, fictional example, no real facts in the example, answer shape, status block, key facts inside the boundary, neutralized fake markers, persona across the three forms, identical evidence blocks across forms, size under the cap |
| `nova-replay.test.ts` (19) | the real reply before and after, developer log content, corrected replies, thin replies, invented causes, contradictions, bad sources, links, unknown keys, truncation, prose around JSON, human versus horror consistency |
| `nova-offline.test.ts` (+1) | the real reply on the billable path costs exactly 212 micro-dollars and is refused |
| existing suites | updated where behavior intentionally changed (rejections carry an index; an unrelated issue is now left out of status answers) |

Mutation checks (each breakage must turn the right tests red, and did): strictness removed (6 tests failed), old status ranking restored (12), example-copy guard removed (1), archived-flag contradiction check removed (3), key facts removed from the prompt (4), "deprecat" re-added to the notice pattern (1). All files were restored byte-identical afterwards. Browser checks (`check:browser`, `check:chat-browser`) pass in mock mode on a fresh production build at 1440x900 and 390x844.

## 8. Safety, unchanged

Kill-switch semantics, IAM, the Nova model and the restricted role, token budgets, request limits, concurrency leases, rate limits and spending controls are untouched. The harness ceilings still cap a run at 1 call, USD 0.02, 4,000 input and 500 output tokens. The input guard and its pessimistic estimator were not loosened; the prompt was shortened to fit instead. No quests, OAuth or time travel.

## 9. Risks and unknowns

1. **Nothing here is proven on a real model.** The prompt changes are instructions; Nova Lite may still add keys, wrap the JSON, ignore the shape, or write a flat ghost line. Strictness means a non-compliant reply is refused and billed (about USD 0.0002).
2. The key facts and shape rules make a good answer easier, not certain. The validator guarantees what is shown is supported; it cannot make the model helpful.
3. `causeCheck` is a keyword check on at most a handful of retrieved items; a reason stated deeper in a long README (only the first part is retrieved) or in an issue that was not retrieved will be missed. It tells the model "none found in what was retrieved", and the prompt says it can miss one.
4. The attribution, contradiction and motive checks are heuristics tuned on one repository's text; they may have false positives on other phrasing. They drop one segment at a time and report why, so false positives are visible in diagnostics rather than silent.
5. Spelled-out numbers ("three issues") and names in factual text are still not checked (see `docs/AI_READINESS.md`).
6. The ghost-quality checks measure readability, not artistry. Whether the voice is good is a judgment a real reply has to be read for.

## 10. Proposed one-call Nova Lite retest (NOT authorized, nothing has been run)

**Scope.** Same as the first real call so the two are directly comparable: `amazon.nova-lite-v1:0`, us-east-2, restricted role `gitghost-smoke`, atom/atom, saved distorted Archivist, **"Why did you die?"**, full pipeline, one call, no retries, stop at the first failure.

**Limits** (all enforced in code, unchanged): 1 call; 4,000 input and 500 output tokens; concurrency 1; 20 s timeout; safety factor 1.5; application budget USD 0.02; 1 request per day; prices USD 0.06 / 0.24 per million tokens. Worst-case reservation 540 micro-dollars (USD 0.00054); real AWS charge bounded by USD 0.00036. Expected: the prompt is about 6,400 bytes (about 1,900 real tokens) and a five-segment reply is about 150 to 250 output tokens, so **about 150 to 300 micro-dollars recorded (roughly USD 0.00017 to 0.0002 raw)**. An estimate until measured.

**Timing constraint.** It is currently 2026-11-01 03:29 UTC and the first call already used today's single request (`REQ#bedrock#2026-11-01 = 1`, cap 1 per day). A retest is refused (`daily_limit`) until **2026-11-02 00:00 UTC (8 pm Eastern on 2026-11-01)**. I recommend waiting rather than raising the cap, which is a ceiling in code and a safeguard you set. If you prefer to retest tonight, the alternative is an explicit decision to raise the plan's daily request ceiling from 1 to 2 for this one run; I would not do that without your say-so.

**Preflight today.** `nova-preflight.sh` now reads 17 of 18 and says NO-GO for exactly one reason: `REQ#bedrock#2026-11-01 = 1`, i.e. today's allowance is spent (the check now asserts "room for one more request today" instead of the old "nothing spent"). Everything else passes, including IAM, the model, the identity and all the new suites. It turns GO by itself after 00:00 UTC.

**What would count as success** (read from the report in `.local/2c2/`):
1. `contractOk` true: valid JSON, only the key `segments`.
2. `diagnostics.quality`: at least one ghost segment, at least two factual segments citing real evidence (ideally E1 archived, E2 README notice, E3 commit), an `unknown` segment about the missing reason, `thin: false`.
3. Zero invented facts or causes; rejections, if any, listed with reasons (and judged true catches versus false positives).
4. A readable, in-character ghost line (distorted: at most two slips).
5. Tokens, latency, cost and accounting reconcile exactly as before; kill switch re-locked and verified.

**If it fails** (for example the model adds another key): no retry. We read the diagnostics, decide between prompt changes and (a separate decision) a tolerant mapping, and test offline first.

**What I would run, only after your explicit authorization naming this document:** the same sequence as Stage C: 18-check preflight (it now also runs the new suites), lock check with the kill switch ON (must refuse with zero model calls), unlock, the one call, automatic re-lock, verification of both lock views and the counters. The authorization wording would again need to cover: the lock check, unlocking `KILL#bedrock`, one Nova Lite call on atom/atom, the automatic re-lock, the USD 0.02 application budget (worst-case reservation USD 0.00054), no retries, and stopping at the first failure. A second question ("Do you miss your developers?") is not part of this proposal.
