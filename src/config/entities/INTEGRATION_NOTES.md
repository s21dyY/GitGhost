# Entity pack: Milestone 1B integration notes

Status: the pack is design input. Nothing here is wired to UI, storage, Bedrock or art yet. Character creation, persistence, prompts and animation start in Milestone 2A.

## Changes made to the delivered pack
- Directory was named `src/  config/` (two leading spaces). Renamed to `src/config/` so `@/config/entities` works.
- Import specifiers changed from `./x.ts` to `./x` (as the pack README advises: adapt to the host project). Without this, `tsc` failed with TS5097. No other pack content was edited.
- Added `index.ts`, the barrel the pack README imports from. It re-exports existing symbols only.

## Compatibility with `src/domain/entity.ts`
| Pack `EntityIdentity` | `EntityAssignment` envelope | Note |
|---|---|---|
| `configVersion` | `schemaVersion` | must equal `CONFIG_VERSION` or validation fails (explicit migration) |
| `horrorId` | `voiceId` | BUILD.md name kept for the storage shape |
| `mutationIds` | `mutationParts` | max 2, one per slot, checked against `resolveEntity` |
| `eraId`, `languageMotif`, `currentStage`, `originAssignment` | same names | added to the envelope: they cannot be re-derived later (language and dates can change) |
| none | `assignedAt` | envelope only |

`identityFromAssignment` / `assignmentFromIdentity` convert between the two. ID lists in `domain/entity.ts` are now derived from the pack, which is the single source of truth.

## Decisions and open items
1. Temperament ID: `reserved` is canonical (decided in Milestone 1C). BUILD.md section 5 was updated to match; `restrained` is rejected by the schema. Renaming it after any assignment is stored would need an explicit migration.
2. The pack's IDs are plain `string`, not literal unions. Runtime checks (`validateConfig`, `resolveEntity`, the zod refinements) catch bad IDs, but the compiler does not. Tightening to `as const` is optional.
3. `RepoMetadata` now carries `topics` and `createdAt` (Milestone 1C), and `repoSignalsFromMetadata` passes them on, so era and keyword matching use real data. `topics` are untrusted: malformed entries are dropped and the list is capped at 20.
4. `matchedKeywords` is styling provenance, not evidence. It must not be cited as an evidence ID.
5. The pack does not validate hostile stored JSON by itself. `EntityAssignmentSchema` is the validator for anything read from storage.
6. `buildEntity` must be called only for an unassigned repo, with a server-generated seed and an atomic first write (2A, DynamoDB). Not done.
7. `recognitionLine` needs a trusted `ViewerContext`. Only `unknown` and `self-identified` can occur until OAuth exists (stretch tier); `hasRecordedVisit` needs real visit tracking.
8. The pack README mentions an existing `personality.ts` and its own `npm test`. Neither exists in this repo. Pack tests now live in `entities.test.ts` and run under the project's `npm test`.
9. Observed selection behavior (tested): every origin x voice pair has at least one eligible overlay; all 7 overlays are reachable; an assignment gets 1 or 2 overlays; with no purpose keywords the origin is always `archivist`.

## Missing assets (19, all `needs-art`)
No files exist under `public/entities/`. Needed keys:
- Stages: `{archivist,radio-operator,clockmaker,watchkeeper}-{human,distorted,transformed}` (12)
- Overlays: `overlay-ink-tears`, `overlay-orbiting-eyes`, `overlay-delayed-shadow`, `overlay-missing-outline`, `overlay-stitched-halo`, `overlay-small-teeth`, `overlay-guarding-shadow` (7)

Per BUILD.md, Milestone 2 needs only the Archivist trio (3 stage sprites) plus the overlays that can apply to it: `ink-tears`, `delayed-shadow`, `stitched-halo`, `orbiting-eyes`, `missing-outline`, `guarding-shadow` (6; `small-teeth` does not apply to the Archivist). `AssetBrief.status` is typed as the literal `'needs-art'`, so the type must widen when real assets land.

## Dependencies
None added. The pack uses only TypeScript and built-in JS. The only new coupling is `domain/entity.ts` importing from `@/config/entities`.

## Milestone 2A status (Archivist)
- Assignment: `src/server/entity/resolve.ts` reads the saved identity (consistent read), or builds one with `buildEntity` and a server `randomUUID` seed and writes it with a conditional put. Unreachable store gives a labeled provisional identity (seed `provisional:<repoId>`, never written); an invalid saved record is reported and left untouched.
- Art: no image files. The Archivist is drawn in code (`src/components/entity/archivist/sprites.ts`): 3 stages, 3 poses, and static drawings for the 6 overlays that can apply to an archivist. The 3 other origins have no art; they show a labeled stand-in. `small-teeth` and any other undrawn overlay are listed as "Not drawn yet".
- The 19 `needs-art` briefs in the pack are unchanged. They remain briefs, not shipped assets.
