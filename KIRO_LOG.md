# Kiro development log

This is an **empty template**. Starter files are not proof of Kiro usage. Fill only after actual work.

| Date | Kiro feature used | What was built or decided | Test/verification and result | Link/commit |
|---|---|---|---|---|
| 2026-10-30 | Kiro agent session (chat); steering `project.md` and `AGENTS.md` rules applied. Skills and the `gitghost-builder` agent were not invoked in this step. | M1 partial: scaffolded Next.js 16.4.3 (TypeScript, Tailwind 4, ESLint, App Router, `src/`, npm) via `create-next-app` in a temp dir named `gitghost` and copied into the repo root, because the CLI rejects the capitalised folder name `GitGhost`. Added `src/fixtures/featured.ts` (6 real repos with numeric IDs, snapshot read with `gh api` on 2026-10-30), static graveyard page `src/app/page.tsx`, retro styles in `src/app/globals.css`, and a new title in `src/app/layout.tsx`. Removed the Google font import so the build needs no network for fonts. | `node -v` OK (v24.3.0). `npm run build` exit 0. `npm run lint` exit 0. `next start` served `/` with HTTP 200 and all six GitHub links were present in the HTML. Not verified: visual look in a browser, keyboard focus behaviour, contrast, reduced motion. No unit tests yet. | none (no git repo initialised) |
| 2026-10-30 | n/a | M1 not complete. Still not done: URL summon flow, entity/evidence schemas, GitHub API parsing tests and live fetch, GitHub/Bedrock/DynamoDB smoke tests, deployment check. Earlier terminal failures (garbled output, exit -1) were not reproduced this session. | n/a | n/a |
