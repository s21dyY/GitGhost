# Tasks
Checked only where the code and tests exist in `src/` (checked 2026-11-02). Scope changes: `.kiro/steering/decisions.md`.
- [x] M1 Scaffold, unit tests and KIRO_LOG; graveyard and URL summon (`src/components/graveyard`, `src/app/api/summon`); Bedrock smoke test (`src/server/bedrock/smoke.ts`).
- M2 Living ghost
  - [x] Stable entity assignment and three art states (`src/server/entity`, `src/components/v4/V4Ghost.tsx`).
  - [x] Grounded conversation with server-validated citations (`src/server/chat`).
  - [x] Status reading from the archived flag and commit dates in the archive panel (`src/components/v4/live-data.ts`). A full Signs of Life panel as in BUILD.md 4B is not built.
  - [x] First encounter: scripted opening by arrival, one cited fact, choice menu (`src/components/v4/encounter.ts`, `encounter.test.ts`).
  - [x] Possession: code viewer and file questions (`src/components/v4/Possession.tsx`, `code.ts`, `src/app/api/code`), tree-sitter outline with approximate fallback (`src/server/code/outline.ts`), whole-file / skeleton reading (`src/server/code/window.ts`), why/when from commits and PRs (`src/server/evidence/file.ts`).
  - Quest and revival brief: removed from scope (D2).
- M3 Discovery and memory
  - [ ] Live wandering discovery with server-side cache and filters.
  - [x] Revision-scoped time travel by commit era, no future data (`src/server/evidence/era.ts`, `history-era.test.ts`). Release-tag time travel as in BUILD.md is not built.
  - [x] Character breadth: five origins including the Bellwraith echo voice (`src/config/entities`, `src/server/chat/providers/bellwraith.test.ts`).
- [ ] M4 Labelled fixtures exist (`/demo`); still open: Kiro hooks, robust-failure pass, accessibility review, pilot, real contribution attempt.
- [ ] M5 Feature freeze, public deployment, video, LICENSE, README, `DISCLOSURES.md` completed by the owner, submission checks.
Known open defects: the "compare" intent type errors (`src/server/chat/pipeline.ts`, `src/server/evidence/select.ts`) and three art tests (`src/components/v4/art.test.tsx`).
Do not mark complete without linked code/tests or demonstrable manual verification.
