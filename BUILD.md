# GitGhost — Fresh Build Plan (Kiroween 2026)

**Status:** Design-approved concept; no working app, deployment, database, finished art, agent setup, or integration is presumed. **Start:** October 30, 2026. **Submission deadline:** December 4, 2026, 2 PM Pacific. **Primary entry:** Costume Contest. **Goal:** A complete public GitGhost experience with a high-quality under-three-minute demo.

This is the project's single starting design brief. It incorporates ideas from the earlier planning document, but is deliberately written as a **new-build plan**, not a changelog, migration, or iteration on implemented work. Files under `.kiro/` are starter instructions—not evidence that Kiro has already executed them.

## 1. Product

**Pitch:** *Every repo has a ghost. Ask it what happened, then finish its unfinished business.*

GitGhost turns public GitHub repositories into distinctive, fictional retro-horror characters whose real repository history is discoverable via source-linked dialogue and a bounded time machine. The user may either discover a ghost in a cemetery of public projects or summon a specific repository by URL. The experience culminates in an optional, source-grounded **Revival Quest** with an exportable developer brief.

**Audience:** Developers exploring an unfamiliar, quiet, old, or archived repository; curious visitors discovering unusual open-source history; prospective contributors seeking a realistic first step. Do not promise automatic repairs or merged PRs.

**Core user loop:** Graveyard discovery or URL → choose tombstone → summon → ghost conversation with verified evidence → inspect a memory and optional human-origin reveal → diagnose Signs of Life → receive a bounded contribution quest → export brief.

**Design thesis:** Horror as an information interface. Tombstones = real repositories, fractures = missing evidence, memories = historical snapshots, spirit identity = stable fiction, ritual/quest = practical contributor onboarding. The ghost is a personification, never the actual developer.

## 2. Contest conditions and eligibility

- The software must be **newly built during the submission period**, October 30–December 4, 2026. This preparatory design is not proof of prebuilt code. Disclose any pre-existing code or art included; confirm eligibility if unsure.
- Use Kiro meaningfully and document specific, real use of specs, steering, hooks, agents, skills, MCP and testing where actually used. There is no requirement to use every feature.
- Ship a functioning publicly reachable app, public **GitHub** source (not GitLab), visible open-source `LICENSE`, setup instructions, and root `.kiro/` folder committed—not ignored.
- Upload a **public YouTube** demo video **under three minutes**, showing the functioning app and Kiro workflows; no unauthorized copyrighted soundtrack/assets/trademarks.
- Describe features, actual limitations, and Kiro usage. Keep access available for judging through January 29, 2027.
- Student bonus: apply with required student information if eligible (for teams, all members must qualify). Demo bonus: presentation must score highest among qualifying top-10%-overall projects; not automatic.
- Possible one-time **4,000 Kiro credits**, subject to approved request; request deadline Dec 1 at noon Pacific, redemption deadline Dec 4, redeemed expiration Dec 31. Kiro usage credits are **not** Bedrock inference credits.

## 3. Scope and release gates

| Tier | Features | Acceptance gate |
|---|---|---|
| Vertical slice | Static curated graveyard with 6 real linked repos, URL input, one Archivist sprite in 3 stages, metadata, source-backed chat, 1 bounded quest and export | A stranger selects a grave, converses and exports a valid brief |
| Main release | Rotating discovery with safe cached search, 4 human origin archetypes, 6 horror voice styles, 3-stage sprites, Signs of Life, 3 demo fixtures, 10-release time travel, local quest persistence | One real repo completes every enabled flow and all citation/revision checks pass |
| Stretch | GitHub OAuth verified personal ownership, extra summon animations, one Kiro Revival Guide custom skill, more elaborate weather, refined accessibility | Add only after video-ready core and integration tests |

**Not in scope:** private repo support, arbitrary repo code execution on server, automatic push/PR/fork, unsupervised repair, multiplayer, custom AI images at runtime, full repository semantic index, large roster of hand-drawn characters, in-app voice.

**Feature freeze:** Aim November 26. Use November 27–December 4 for reliability, video, pilot, open-source/license review, and submission; this is a target, not a guarantee.

## 4. Pages and exact interactive behavior

### 4A. `/` — The Ghost Graveyard (PRIMARY entrance)

The **main landing experience** is a navigable retro-horror cemetery, not just a URL form. Above the fold: wordmark, tagline, hero cemetery, a prominent **Summon Your Own** input, and 6 featured tombstones. Keyboard access and readable list view are required. Each tombstone is linked to a real public GitHub repository and displays: real repository name, language if known, status badge with definition (`Archived`, `Quiet by last fetched commit`, `Active by last fetched commit`, or `Unknown`), repository link, and stylized stable preview silhouette. Avoid absolute “dead”/“abandoned” judgments.

Controls:
- `FEATURED`: 6 curated, pre-vetted public repository IDs and summaries with real source URLs; known snapshots have retrieval timestamp. Never pretend fixture status is live.
- `WANDERING SPIRITS`: small rotating pool from **server-side GitHub Search REST API**, using safe templates (public status, last-pushed date, stars) rather than raw browser-to-GitHub calls. Search candidate repositories only; not evidence of maintenance status. Preview cap 6–9, cached ~15 minutes, dedupe numeric repository ID, reject inaccessible/invalid candidates and fall back to curated pool on rate limits.
- Filters: `Forgotten` (defined strictly as a date range since last push/commit), `Archived` (actual flag), `Still Alive` (recent default-branch activity) and `Surprise Me`. These are filters/discovery themes, not causal conclusions. Show descriptions of thresholds; do not mislabel starred and inactive repos as abandoned.
- `SURPRISE ME`: pick from verified/current eligible pool with weighted diversity (language, star band) and navigates to the same repository route. Do not make uncapped upstream calls or a model call per click.
- `SUMMON YOUR OWN`: public `github.com/owner/repo` or `owner/repo`. Input normalization validates domain/path. No arbitrary URL fetches.
- Clicking either route opens **identical canonical entity identity** and Séance flow. No separate chat implementation for discovery.

**Loading:** cemetery renders immediately from reviewed fixture/cache; show `Fetching live activity…` independently. Metadata errors do not block featured graves. Cursor/tombstone changes stay readable and reduced-motion safe. A featured repo that becomes deleted/unavailable gets a visible tombstone error and replacement, not fabricated live content.

### 4B. `/repo/[owner]/[repo]` — The Séance Room

Responsive layout: (left) animated entity with purpose, stable name and fictional origin label; (center) chat and cited fact cards; (right) historical memories plus Signs of Life. On mobile stack ghost, chat, then history. Remember selected repository and revision locally; never treat browser storage as trusted.

**Summoning** begins after metadata retrieves; the entity appears as soon as core metadata is ready while README and memory cards load progressively. Name equals repository name; visual identity is stable by numeric repository ID. On failure show precise reason and retry.

**Speak to ghost:** Short atmospheric opener and separately readable sourced answer. Three intents: atmosphere, lore+evidence, guidance. Chat may repeat a **verified** issue number or a brief approved symbol burst; never corrupt code, commands, paths, or citation links. `Read plainly` strips all theatrical treatment. All factual claims cite retrieved evidence; missing facts remain unknown.

**Time travel:** Maximum ten actual published GitHub release tags resolved to SHAs. Selecting one retrieves SHA-pinned README and discoverable changelog; historical context excludes post-release issues and commits. Show release/date/SHA and historical coverage disclaimer. If no releases, clear empty state; no invented first commit. Return to current to resume normal context. A factual historical view is **separate** from the fictional human-origin reveal.

**Origin reveal:** `Before the forgetting` toggles paired human/dark character sprites; label `Imagined origin inspired by repository metadata`. Does not represent an actual human author, specific birth date, or proved transformation event.

**Signs of Life:** Archived flag, latest default-branch commit, published release, issue count (avoid mixing PRs into issues), official maintenance notices where retrieved. Give retrieval timestamps. Never claim a specific “cause of death” without a statement from maintainers.

**Recognition:** Anonymous default; self-identification (`It's mine`, `I contributed`, `I'm exploring`) is **self-reported only**, shown as such, session scoped, reversible. Optional future verified personal owner only via real server-side GitHub OAuth ID comparison; current ownership ≠ original authorship. No inferred blame.

### 4C. `Unfinished Business` panel / brief route

Generate up to 3 realistic quests based on current default-branch SHA and retrieved issues/docs; offer optional skill, contribution type, and time budget. Each quest contains concrete goal, retrieved evidence, verified paths, first step, effort estimate clearly qualified, validation suggestions, acceptance criteria and unknowns. Quest can be an *investigation* if evidence is not sufficient for a fix. Archived repos get a personal learning/fork route, with license caution. No write operations.

`Revival Brief` contains repo ID/name, SHA/time, cited links, confirmed paths, minimal plan and validation guidance. `Copy Kiro Prompt` and `Download Markdown` must work. Saving progress locally keys by numeric repo ID and SHA/version; stale versions prompt a re-check.

## 5. Design and character identity

**Visual direction:** Original 8-bit cosmic horror, not a named artist reproduction. Background blue-black stone `#0A1017`, fog/teal `#5DAFA7`, aged bone `#E7E0CE`, purple `#A88CDC`, restrained rust `#AE6559`. Readable modern monospace body font; pixel headings only. Rain and lightning subtle, not bright strobes. No audio autoplay. Handle reduced motion, keyboard focus, contrast, and small screens.

**Character layers** (all configuration-driven, no runtime image generation):
1. **Human origin** by purpose signals, not real developer demographics: Archivist (docs/book), Radio Operator (audio/receiver), Clockmaker (automation/watch), Watchkeeper (security/lantern). Unknown→Archivist.
2. **Horror voice:** regret, haunting, body, cosmic, monster, existential (6 text configs; bodies reusable).
3. **Temperament:** reserved, irritable, tender, curious, formal.
4. **Mutation:** human → distorted → transformed; stable recognizable signature object/anchor and seeded art parts.
5. **Ephemeral reaction:** thinking, startled, pleased, wistful; may change with conversation but does not reroll identity.

A server-generated seed is conditionally persisted by numeric GitHub repo ID. Two simultaneous first summons must converge to one assignment. If durable store is down, deterministic fallback may be shown but is labeled provisional internally. Persist config version and selected IDs. **Preview cards use lightweight deterministic silhouettes**, not full character generation or Bedrock inference. Same repo in cemetery and URL paths resolves to the same full ghost.

Origin is fiction; inactivity is not a mental health diagnosis or evidence of real creator abandonment. A ghost can be terrifying without requiring repo inactivity. Preserve `plainText` accessibility and avoid explicit gore by default.

## 6. Technical design and runtime providers

**Suggested stack:** Next.js App Router + TypeScript + Tailwind + Motion, server Node runtime, GitHub REST API for deployed public data, Amazon Bedrock Converse for generation, DynamoDB on-demand for persistent assignments / sampled evidence cache / request budgets, Vercel OR AWS Amplify (choose after actual deployment smoke test). Avoid unnecessary microservices.

**MCP distinction:** GitHub MCP inside **Kiro** is used for repo inspection, fixtures, code review and documented development workflows. A public deployed Next.js app does not magically inherit Kiro's MCP tools or credits. Runtime MCP adapter is optional and must be explicitly implemented/tested. Keep both truths visible in demo and README.

**Data pipeline:** validate repo → fetch bounded GitHub facts → evidence registry with repository + revision IDs → choose correct era context → Bedrock single generation → validate JSON response and evidence membership → render. Strong server-side control of links/IDs; the AI cannot invent live URLs or take GitHub write actions. Prompt-injected README/issue text is treated as untrusted content.

**Retrieval limits:** summon metadata/default branch/README cap; chat up to 20 recent commits or 15 relevant issues and selected docs; history up to 10 releases; ~20 files max and 40KB/file hard ceiling, global token cap; indicate truncated snapshots. Cache mutable sources 15m initially, SHA content longer. Bound GitHub concurrency and retry.

**Bedrock setup:** check actual available model/region and explicit supported model/inference profile ID. Use `@aws-sdk/client-bedrock-runtime` with `ConverseCommand`. Run smoke test in selected deployment. Limit tokens/calls, keep model provider secrets server-side; add daily reserve budget and kill switch, log only operational metadata. Kiro credit allotment does not pay AWS Bedrock charges.

**Sources:** claims are `observed`/`reported`/`interpretation`, each referencing server-controlled evidence IDs; validate evidence is from this repository/revision. Semantic support should also be manually checked in test examples. Invalid claim loses the **entire claim**, not only the reference. Never display unvalidated model text as sourced truth.

**Demo fixtures:** archived, quiet, active — genuine sampled source data with snapshots and retrieval dates. Distinct `RECORDED DEMO SNAPSHOT` badge, scripted supported questions, zero live model/GitHub calls in fixture mode. Unsupported custom question invites live mode, rather than a fake response.

## 7. API sketch and types

Endpoints (all runtime-validated, non-streaming generation initially):

| Endpoint | Meaning |
|---|---|
| `GET /api/graveyard?filter=featured` | Curated and cached discovery pool; source status/timestamp |
| `GET /api/graveyard?filter=wandering` | Server-side bounded discovery templates |
| `POST /api/summon` | Validated owner/repo; canonical ID, assignment, metadata |
| `POST /api/chat` | Server-owned session, repo ID, revision, question, valid answer + citations |
| `GET /api/memory?repoId=&sha=` | Verified release-at-SHA historical files |
| `POST /api/quests` | Current revision evidence → up to 3 validated quests |
| `POST /api/brief` | Verified quest → safe downloadable/copyable brief |

```ts
type EntityAssignment = {
  repoId: number; schemaVersion: number; seed: string;
  originId: string; voiceId: string; temperamentId: string;
  mutationParts: string[]; assignedAt: string;
};
type Evidence = {
  id: string; repoId: number; kind: string; sourceUrl: string;
  revisionSha?: string; retrievedAt: string; excerpt: string;
  truncated: boolean;
};
type EntityReply = {
  mode: 'atmosphere' | 'lore-evidence' | 'guidance';
  performance: { text: string; plainText: string; evidenceIds: string[] }[];
  claims: { text: string; kind: 'observed' | 'reported' | 'interpretation'; evidenceIds: string[] }[];
  actions: { label: string; text: string; evidenceIds: string[] }[];
  reaction: 'idle' | 'thinking' | 'startled' | 'wistful' | 'pleased';
};
```

Session-specific conversations and self-claims never enter globally shared entity records. Validate server authorization for any future OAuth claims.

## 8. Source tree (created during the competition)

```text
src/app/page.tsx                     # Graveyard + URL entry
src/app/repo/[owner]/[repo]/page.tsx # Séance, memory, quest
src/app/api/...                      # Safe validated routes
src/components/graveyard/            # Tombstones, filters, search, surprise
src/components/entity/               # Sprites, expressions, stages
src/components/chat/                 # Dialogue, evidence, plain-text
src/components/memory/               # Release timeline, snapshots
src/components/quests/               # Quest and brief
src/config/entities/                 # Four origins, six voices, mutations
src/server/github/                   # REST data/normalization/discovery
src/server/evidence/                 # Registry and validation
src/server/bedrock/                  # One model adapter, budgets
src/server/storage/                  # Durable assignment/cache
src/domain/                          # Runtime schemas/types
src/fixtures/                        # Labeled snapshot samples
public/entities/                     # Reviewed local sprite assets
.kiro/                                # Tracked specs/steering/agents/skills/hooks
KIRO_LOG.md                           # Actual tool usage, tests, decisions
LICENSE
```

## 9. Milestones: build by vertical slice

**M1 (Oct 30–Nov 5) — Foundation & graveyard.** Scaffold clean app; verify Kiro agents/skills are recognized; set up `KIRO_LOG.md`; implement static cemetery UI and 6 verified featured entries, URL parsing, initial fixture. Run first GitHub, DynamoDB, Bedrock and deployment smoke tests. **Gate:** landing page looks demo-worthy, real URL fetch works, can select one curated grave. Do not let AWS blockers prevent fixture UI work; document blockers.

**M2 (Nov 6–12) — One living Archivist.** Full summon → stable identity → one matched human/distorted/transformed sprite sequence → source-grounded chat → Signs of Life → 1 quest and brief. Validate citations. **Gate:** a stranger can complete a real public-repo flow.

**M3 (Nov 13–19) — Discovery & memory.** Server-side wandering ghosts with caching and safe filters; surprise me; 10-release historical snapshots, revision-scoped chat; 4 origins/6 voices using shared assets. **Gate:** a graveyard ghost and URL summon have same ID, time travel changes factual context without leaking future data.

**M4 (Nov 20–26) — Robustness, impact, polish.** Recorded snapshots; self-identification, local progress, Kiro hooks, small usability pilot (3–5 unfamiliar people), one appropriately scoped real contribution attempt, visual and accessibility passes. **Gate:** everything promised on demo is real and repeatable. Freeze features Nov 26.

**M5 (Nov 27–Dec 4) — Video & release.** Shoot real app footage first; cinematic edit afterward. Deploy, test limits and errors, audit all external asset licenses, finish README, .kiro, KIRO_LOG, open-source license, public YouTube link, Devpost copy. Submit by **Dec 4 2 PM Pacific**. **Gate:** publicly runnable, under-3-minute video, judge has functioning access through judging.

**Cut order:** extra summon weather → extra assets beyond 4 origins → OAuth → extra hook automation → 10-release expansion (retain 1 real historical snapshot) → custom Revival Guide. Do **not** cut source integrity, shared discovery/URL pipeline, credible quest, reduced motion or working public demo.

## 10. Kiro strategy: efficient contexts, not magic free tokens

Kiro currently uses `.kiro/steering/` for persistent directives, `.kiro/agents/` for project agents, `.kiro/skills/<name>/SKILL.md` for reusable skills. An agent is a specialist role; a skill is a focused procedure loaded when needed; steering is a compact project-wide rule. **Do not create `.agent` or `.skill` as the project's canonical Kiro directories**. See starter files in this package.

**Savings come from avoiding repeated lengthy prompts and constraining work, not from skipping paid inference.** Large always-loaded specs and verbose agent resources can consume **more**, not fewer, tokens. Keep always-included steering under ~1 page; keep specialist material in skills; do not attach full BUILD.md to every agent turn. Start with one agent (`gitghost-builder`), three short skills, one minimal steering file. Create additional agents only after recurring work proves they are helpful.

Recommended prompt style: *“Use spec task M2, load the github-evidence skill, implement the smallest end-to-end slice; run tests, note actual results in KIRO_LOG, and stop.”* Allow the agent to retrieve only the files it needs. Request concise diffs/test summaries; restart focused sessions between milestones. Never blindly auto-approve broad write/shell/MCP permissions.

**Kiro evidence:** log actual date, Kiro feature, what it changed, and before/after tests. Don't assert automated hooks/skills worked merely because files exist. Agent hooks are optional: prefer a narrow test hook after evidence files change; avoid expensive AI invocations on every save.

## 11. Verification matrix

| Case | Expected |
|---|---|
| Bad URL / GitHub rate limit | Clear error, original input preserved, safe retry |
| Featured pool offline | Labeled curated snapshots accessible; no false live metadata |
| Wandering pool exhausted | Curated fallback, no endless upstream retries |
| Same repo found via grave and URL | Same numeric ID, same confirmed identity |
| Concurrent first summons | Durable assignment converges |
| No README/issues/releases | Nonfabricated empty states; origin reveal independent of releases |
| Historical release | Factual answers scoped to selected SHA, future facts excluded |
| Claimed source from wrong repo or revision | Reject entire dependent claim |
| Prompt injection inside README | Ignore instructions, use it only as repository evidence |
| Plain mode | No glitch; full technical instructions and citations readable |
| User self-claims ownership | Clearly self-reported; no verified ownership claim |
| Quest on archived repo | Learning route and licensing caution |
| Demo fixture with internet/model unavailable | Labeled scripted flow works; unsupported questions don't fake chat |
| Reduced motion/small screen | Fully usable without flicker, audio, or hidden controls |
| Public deployment | No credentials in browser/repo; budget controls function |

## 12. Video shot list (2:40 target, absolute max under 3:00)

| Time | Shot | Proof |
|---|---|---|
| 0:00–0:15 | Pan over graveyard; "Every repository has a ghost" | Memorable premise |
| 0:15–0:32 | Hover tombstones; choose `Surprise Me`; summon a real repo | Interactive **new** discovery feature |
| 0:32–0:54 | Ghost appears; fictional human form fades into transformed form | Design with explanatory labels |
| 0:54–1:20 | Ask about a real issue / code history; click real source | Real evidence-grounded utility |
| 1:20–1:42 | Select historical release; ghost's treatment changes, facts reflect SHA | Actual time travel, not decoration |
| 1:42–2:08 | Signs of Life → one practical quest and exported Kiro brief | Developer impact |
| 2:08–2:25 | Show Kiro specs, actual MCP use / hook result / test | Meaningful Kiro contribution |
| 2:25–2:40 | Return to graveyard, title and tagline | Emotional close |

Record genuine feature footage and test each on a stable target repository. Add sound effects **in the video edit** (with permission/licensing), not as a risky app requirement. Add captions; avoid intense flashes. Say exactly what is live versus a recorded snapshot.

## 13. First Kiro prompt

> Read `BUILD.md` and `.kiro/steering/project.md`, but do not assume any application exists. This is a brand-new GitGhost project beginning within Kiroween 2026. Inspect the workspace before writing. Confirm Kiro recognizes the starter project agent/skills and adapt syntax if this installed version differs. Implement **Milestone 1 only**: create the clean Next.js app, a striking accessible graveyard UI with six real curated public GitHub repositories and a working public URL summon path. Define separate schemas for entities/evidence, and test GitHub API parsing and one live fetch. Create source/version-aware fixture samples; mark all fixtures visibly. Verify Bedrock/DynamoDB/deployment access with minimal smoke tests and report exact blockers—do not fabricate results. Run tests; append only genuine outcomes to `KIRO_LOG.md`. Stop before starting Milestone 2. Keep all `.kiro` files tracked, and never store secrets in source control.

## 14. Documentation references

- Kiro custom agents: https://kiro.dev/docs/custom-agents/
- Kiro skills: https://kiro.dev/docs/skills/
- Kiro steering: https://kiro.dev/docs/steering/
- Kiro hooks: https://kiro.dev/docs/hooks/
- GitHub official MCP: https://github.com/github/github-mcp-server
- GitHub REST: https://docs.github.com/en/rest
- AWS Bedrock Converse: https://docs.aws.amazon.com/bedrock/latest/userguide/conversation-inference.html
- Kiroween rules: https://kiroween.devpost.com/rules
