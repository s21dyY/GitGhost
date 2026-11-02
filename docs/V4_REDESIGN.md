# GitGhost V4: haunted RPG redesign

Status: isolated prototype only. Nothing in the production screen was changed. All prototype data is invented (see `src/components/v4/fixtures.ts`).

Prototype route: `/prototype/v4` (hidden in production unless `GITGHOST_PROTOTYPES=1` is set at request time).
Screenshots: `docs/screenshots/v4/final/` (kept: `round1/` before the critique fixes, `round2/` after the first fixes).
Check script: `GITGHOST_PROTOTYPES=1 npx next start -p 3100` then `node scripts/v4-shots.mts http://127.0.0.1:3100 <outDir>` (24 checks, all passing on the final run).

## Phase A: audit

### What exists
| Area | Today | Verdict |
| --- | --- | --- |
| Page shell | `RepoView` composes `GhostScene` (full-screen fixed `EncounterStage`), a `Hud` of buttons, a bottom `ChatPanel` dock, and two native-`<dialog>` `Drawer`s (Archive, Journal) | Redesign layout, keep the data flow |
| Scene | 7 authored PNG layers (320x240 art px) stacked by `EncounterStage`, ash/flicker/fog in CSS | Keep as is. V4 reuses the same PNGs and `.enc-*` classes |
| Ghost | `GhostSprite`: 64x80 PNG frames, 3 stages x 4 poses (idle, thinking, speaking, blink), SVG overlays in the same grid, CSS-only animation | Keep. Extend, do not replace |
| Identity | Saved per numeric repo ID. `currentStage` is only `distorted` or `transformed`, picked from a seed hash. The human form is a per-request toggle (`form`) | Keep. Note: stage is **not** derived from repository history today |
| Conversation | `ConversationProvider` + `ChatPanel`: one question at a time, grounded segments (verified / interpretation / unknown / ghost), citations from the server registry, typewriter reveal, `Drawer` journal | Keep logic. Re-skin presentation |
| Evidence | `EvidenceItem` (zod, namespaced IDs, optional `revisionSha`), `EvidenceJournal` lists answers and sources | Keep. Becomes the Evidence Archive |
| History | The summon API fetches **only the latest commit**. There is no commit list and no per-SHA evidence endpoint | **Gap.** Memory Journal and Time Travel need new server reads (see Phase E) |
| Expressions | Only the 4 poses. No happy / sad / angry / confused / disturbed frames | **Gap.** Prototype fakes emotion with pose + tint; real frames are art work (Phase D) |
| Animation | CSS keyframes (`ghost-bob`, `ghost-blink`, `ghost-morph`, `ghost-glitch`), React state for pose in `GhostFormContext` | Replace the ad-hoc pose state with one small state machine |

### Retained / redesigned / replaced
- **Retain:** scene PNGs, sprite PNGs and manifest, overlay system, identity rules, `ConversationProvider`, grounded answer types, `EvidenceJournal` data, `Drawer`, fonts, palette, `rpg-*` base classes, all backend routes and cost controls.
- **Redesign:** page layout (three regions plus action bar), dialogue window (integrated into the scene, taller, anchored to the newest message), HUD (replaced by action bar and side panels), journal (becomes a section of the archive).
- **Replace (after approval):** `Hud`, the bottom `dock` placement, and the pose handling in `GhostFormContext`.

## Phase B: what the prototype does

- Chamber: ghost at 4px per art pixel (256x320 on screen at 1440x900, 5px at 1700x1000+), roughly 58% of the width is the stage.
- Left, Haunted Archive: Identity, Memories (commit pages), Time (timeline), Board (observed / reading / not found), Evidence.
- Right, Spirit Record: identity and archetype, emotion (pixel face + word), manifestation, discovered memories, relevant evidence, Spirit Mirror button.
- Bottom: TALK, MEMORIES, REWIND, INSPECT (keys 1 to 4). Free-form input is always in TALK; suggestions are shortcuts.
- Rewind: a scanline sweep, era chip update, ghost form change with the existing morph flash, era-scoped evidence and replies. Past replies stay in the log, labelled "as of <sha>".
- Spirit Mirror: original beside distorted or transformed.
- Typewriter replies with Skip, a rare "human face flashes through" glitch (never on text, off under reduced motion), a "Trigger rare glitch" button for review.
- Mobile: stage on top, dialogue below it, Archive and Spirit as drawers, action bar at the bottom.

Honesty rules held in the prototype: every screen carries a MOCK badge; fixtures contain no URLs, no 40-character SHAs, no real repository; facts and readings are separate; evidence outside the selected era is hidden; a test asserts replies never cite later evidence; no HP, XP or other stats.

## Phase C: browser critique

Reviewed in Chrome at 1440x900 and 390x844.

| Question | Round 1 finding | Fix | Final |
| --- | --- | --- | --- |
| Feels like an RPG? | Yes: framed panels, action bar, icons, a scene with a character | none needed | Yes |
| Character dominant? | Yes, but 5px zoom cropped the moon and ruin and the scene went muddy | 4px by default, 5px only on large displays | Yes; scene context visible |
| Menus consistent? | Yes (one frame language) | none | Yes |
| Too crowded? | Desktop slightly; mobile top bar overflowed, action labels touched edges | Icon-only back button, narrower label font on phones | Acceptable; "MEMORIES" is still tight at 390px |
| Interactions obvious? | Actions and tabs clear; shortcuts hidden | Key hints on the buttons | Yes |
| Dialogue readable? | **No:** replies scrolled out of view while typing; choices wrapped | Log anchors to the start of the newest message, taller window, tighter choices | Better, see open issues |
| Ghost alive? | Idle bob + blink, listening lean, speaking mouth, shudder, morph, rare flash | none | Yes within the 4-pose limit |
| Mobile usable? | Choices stacked and crowded the screen | Portrait + text share a row, choices below | Yes |

Other bugs found and fixed during review: the mobile backdrop blocked clicks on desktop; "Relevant evidence" showed sources from a reply given in another era (broke era scoping); the board's first observation cited the wrong commit; the page was prerendered so the production gate returned 404.

### Open issues (not fixed)
1. A reply of 4 segments does not fit in the desktop dialogue window; the player scrolls. Proposal: a "reading mode" that grows the window to about half the stage while a reply is on screen, then collapses.
2. Expressions are approximated: emotion changes the glyph, tint and pose only. The face does not smile or frown. Needs art (Phase D).
3. Scene is fixed to one location. A different room per origin (Radio Operator, Clockmaker, Watchkeeper) needs new layers.
4. The Spirit Mirror uses the shared right-hand `Drawer`. A centred modal would fit better.
5. Not audited: screen readers (VoiceOver/NVDA), contrast of the new panels with an automated tool (only a 12px minimum font check, focus rings and overflow were checked), long-session performance.
6. Typing is capped at 200 characters in the prototype (production allows 500).

## Phase D: character and animation proposal

### Art system
| Item | Value |
| --- | --- |
| Logical scene pixel | 320 x 240 art px; displayed at 3px (phone), 4px (laptop), 5px (large). Whole numbers only |
| Ghost sprite | 64 x 80 art px, same pixel size as the scene. Never scaled by a fraction. Mirror view may use 2x or 3x (whole numbers) |
| Portrait | 28 x 28 crop (x 18, y 6) shown at 3px (84) or 4px (112) |
| UI pixel | 4px: borders 4px, inner bevel 2px, notches 4px, no blur, hard shadows only |
| Icons | 8 x 8 bitmaps (actions), 7 x 7 (emotion), drawn as crisp SVG rects, shown at 3x |
| Typography | Press Start 2P 12px for titles and action labels; Silkscreen 12 to 14px for tabs, tags and SHAs; Atkinson Hyperlegible 15 to 18px for everything read |
| Rendering | `image-rendering: pixelated` on every raster, `shapeRendering="crispEdges"` on SVG pixels, no CSS filter on sprites except one-shot effects |
| Palette | Keep the approved palette and the horror-pass greys; era tone overlays (warm / dim / cold / blood) are the only new colour |

### Forms and consistency
- Forms: human, distorted, horror (the existing `transformed`). Human is the original; distorted and transformed are corruptions of it.
- Rules (from the ghost-character skill): same silhouette, book, clasp and hair curtain in every form; only the face area changes; sprite tests keep asserting identical book pixels. Facts, paths and code never glitch.
- Commit-era appearance: the prototype uses a fixed era-to-form table. Production needs a **deterministic presentation rule** that makes no historical claim, for example: era position p = index / (count - 1); human if p < 0.4, distorted if p < 0.8, otherwise the saved `currentStage` (so the final era always matches the saved identity). This is a visual convention, not evidence about the repository. It needs your approval.
- Expressions: neutral, happy, sad, angry, confused, disturbed. Proposed as head-only overlays on the 28 x 28 crop (6 x 3 stages = 18 small frames), keeping eyes, mouth and brow inside the existing head box (x 18 to 46, y 6 to 38) so the body tests keep passing.

### State machine
States: idle, listening, speaking, disturbed, transforming, stabilizing (`src/components/v4/anim.ts`, tested).

| From | Event | To |
| --- | --- | --- |
| any | LISTEN | listening |
| any | SPEAK | speaking |
| not transforming/stabilizing | DONE | idle |
| not transforming | DISTURB | disturbed (700 ms) |
| any | TRANSFORM | transforming (600 ms) |
| disturbed / transforming | timeout | stabilizing (500 ms) |
| stabilizing | timeout | idle |

Rules: a timeout only applies if its token matches (stale timers are ignored); a disturbance never cuts a transformation short; conversation events can always interrupt, so input is never blocked; under reduced motion timed states resolve immediately.

| State | Frame today | Extra motion |
| --- | --- | --- |
| idle | idle + CSS blink + bob | none |
| listening | thinking frame | lifts 1 art px |
| speaking | speaking frame | dialogue box glow |
| disturbed | thinking frame | 0.7 s shudder |
| transforming | blink frame | existing `ghost-morph` flash |
| stabilizing | idle | none |

### Animation prototypes delivered
Idle breathing and blink (existing), portrait change by pose, typewriter with Skip, panel and rewind transitions, commit-era rewind sweep, human-to-horror transformation, rare glitch (human face flashes at 50% for 180 ms, once every 45 to 80 s, never with reduced motion).

### Asset requirements
1. 18 expression head overlays (28 x 28) with a test that they stay inside the head box.
2. 3 to 4 transformation strip frames for human to distorted to transformed (replaces the one-frame flash).
3. Optional: one scene variant per origin (4 backgrounds) and a "rewind" sky variant.
4. 8 x 8 icons for the remaining menu items if more are added.

### Priorities
1. State machine and layout (done in prototype).
2. Era data from the server (needs backend work).
3. Expression overlays.
4. Transformation strip.
5. Scene variants.

## Phase E: implementation plan (production integration, after approval)

State ownership: `GhostFormProvider` keeps form and pose; add `EraProvider` (selected era, loaded commit list, rewind state); `ConversationProvider` unchanged except that it sends the selected era SHA with each question once the backend supports it.

| File | Action | Notes |
| --- | --- | --- |
| `src/components/v4/anim.ts` | Move to `src/components/entity/anim.ts`, wire into `GhostFormContext` | Replace ad-hoc `chatPose`, keep the pose names |
| `src/components/v4/{panels,dialogue,icons,typewriter}.tsx` | Promote to `src/components/game/` | Replace fixtures with props from real data |
| `src/components/v4/V4Game.tsx` | Becomes `src/components/game/GameShell.tsx` | Takes `SummonedRepo`, `GhostView`, eras |
| `src/components/repo/RepoView.tsx` | Edit | Render `GameShell` in place of `Hud` + `ChatPanel` + drawers |
| `src/components/encounter/Hud.tsx`, dock CSS | Retire | After parity |
| `src/components/chat/ChatPanel.tsx` | Reuse grounding and reveal logic inside the new dialogue | Keep free-form input and citation behaviour |
| `src/components/chat/EvidenceJournal.tsx` | Reuse as the Evidence Archive and answer ledger | |
| `src/server/github/` | **New:** list commits (paged, capped), get one commit by SHA | Read-only, rate-limited, behind the existing cost controls; new contract |
| `src/domain/evidence.ts` | Reuse as is | `revisionSha` already supports era scoping |
| `src/server/evidence/` | Add era filter | Historical answers use selected-SHA evidence only |
| `src/app/api/chat/route.ts` | Optional `era` (SHA) field | Backward compatible; default is latest |
| `src/app/globals.css` | Move `.v4-*` rules into a game stylesheet | Remove duplicated dock rules last |
| `public/sprites/archivist/` | Add expression overlays and transform strip | Update `art.manifest.json` and `sprites.test.ts` |

Data dependencies: real commit history (new), issue and README evidence at a SHA (new, README at a revision is already supported by `revisionSha`), identity stage (existing).

Accessibility requirements: every action is a real button with a keyboard shortcut; panels are landmarks; mobile panels become native `<dialog>` drawers with focus return; status announcements via a polite live region; reduced motion removes sweep, shudder, glitch, ash and typewriter; text never glitches; 12px minimum; 4px focus rings; 44px touch targets on phones.

Tests to add or update: state machine (done); fixture and era-scoping tests move to real-data tests (reply never cites evidence newer than the selected SHA); render tests per panel; browser script for rewind, reduced motion and mobile drawers; sprite tests for expression overlays; update `chat.render.test.tsx` for the new dialogue; keep `ghost.render.test.tsx` animation CSS pins.

Risks and tradeoffs:
- Time travel needs new GitHub reads and more rate-limit budget. Without them the feature stays a mock.
- The four-pose limit makes emotion look flat until expression art exists.
- Big stage plus integrated dialogue leaves little room for long answers (open issue 1).
- A native `<dialog>` drawer on phones adds code but gives focus trapping for free.
- Doing the layout swap in one step risks regressions; suggested order is shell and panels first behind a flag, then eras, then art.

## Stop point
No production screen, backend contract, credential, environment file or cost control was changed. Integration waits for your review.
