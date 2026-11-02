# Grounded conversation (Milestone 2B.1)

Status: working end to end with a **scripted mock provider**. No model is called. Replies are labeled "Scripted reply ... No AI model was called." in the UI and `scripted: true` in the API.

## Flow
`POST /api/chat` -> same-origin and content-type checks -> in-process rate limits (per verified client, plus a global cap) **before any GitHub request** -> strict body validation -> `answerQuestion`:
1. `preflightChat`: valid config, Bedrock flag/kill switch/readiness (no GitHub or storage traffic yet).
2. Intent from the question (`status`, `recent`, `history`, `issues`, `general`); short follow-ups such as "tell me more" keep the earlier topic.
3. Bounded GitHub retrieval for that intent (cached 10 minutes; transient failures are not cached).
4. Authoritative ghost identity from the server, **read only** (chat never creates one).
5. Evidence selection inside the input budget, history trimmed oldest-first.
6. Prompt: fixed rules + the pack's character direction + evidence inside a random per-request boundary.
7. `runChat` (rate limit, budget, concurrency, timeout) with the provider.
8. Validation: JSON only; every citation must be a reference we issued (E1, E2, ...); links are rebuilt from the evidence registry; segments with unknown references, links in text, or numbers/hashes not in the cited evidence are dropped whole. Nothing unvalidated is shown.

## Evidence per question (requests, on top of 3 base calls: repository, latest commit, README)
status +4 (recent commits, issues by comments, pull requests, comments of one thread); recent +3; history +1 (commits shortly after the repository was created on GitHub, not claimed to be the first commit); issues +3; general +1. Page sizes are at most 30 and nothing is paginated.

## MCP decision
The official GitHub MCP server was **not** used at runtime. A deployed Next.js server does not inherit Kiro's MCP tools, and running an MCP server and client beside the app would add infrastructure (BUILD.md section 6 says the same). Retrieval uses the existing server-side GitHub REST adapter with the same read-only, public-data scope. It could be swapped behind `src/server/evidence/github-evidence.ts` later.

## Answer structure
Segments are typed: `verified` (stated by evidence, must cite), `interpretation` (must cite, must not state a cause), `unknown` (what was not found), `ghost` (atmosphere; no digits or links unless a cited item supports a `#number`). Human form is nostalgic and coherent; the changed form is fragmented. Facts and citations are identical in both (tested).

## Limits
- The mock composes answers from templates; it is not a language model and cannot answer arbitrary questions well. A question outside the five intents gets the general summary.
- Intent detection is keyword based.
- "Why did you die?" is answered with what GitHub shows (archive flag, README and issue text, recent commits). The ghost says when no maintainer statement was found and never invents a cause.
- Evidence is current state only (no time travel yet). Only the first 2,000 characters of the README and short issue and comment excerpts are used.
- History lives in the browser tab only; nothing is stored server side.

## Update (Milestone 2C.3)
Model replies must now be exactly one JSON object whose only key is `segments`; any other top-level key refuses the reply (reported to developers, never shown). Segments are validated one by one. Status questions use a deterministic evidence plan (repository record, README, newest commit, and only genuine maintainer notices) and the prompt carries server-extracted "key facts". Details, decisions and tests: `docs/EVIDENCE_RICH_2C3.md`.
