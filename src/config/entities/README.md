# GitGhost editable entity configuration — v3 starter

This pack is designed for creative editing now and Kiro integration later. It is **configuration and selection logic, not a working renderer, OAuth integration, or generated art pack**. No LLM calls or dependencies are required by the configuration itself.

## Where you add ideas

| File | Edit here |
| --- | --- |
| human.ts | Human occupations, habits, imagined memories, signature objects, three appearance stages |
| horror.ts | Six horror voices, atmosphere lines, original cosmic syllables, recognition phrasing |
| transformations.ts | Compatible visual overlays, stage changes, reduced-motion descriptions |
| temperaments.ts | The emotional character behind the horror genre |
| entity-builder.ts | Assignment, compatibility, saved identity resolution, and prompt assembly |

Start by adding prose to creativeNotes, greetings, atmosphereLines, and stage descriptions. Keep shipped IDs stable. Add new IDs rather than renaming existing ones; migrations must be explicit. Internal labels should remain hidden in production.

Every origin has human, distorted, and transformed descriptions. The signature object remains recognizable. Six horror voices are independent of four base bodies. Seven allowlisted mutation overlays add variation; no more than two overlays are selected. All asset references explicitly say needs-art. Descriptions and string keys do not draw images; Kiro must map these to real assets or rendering code.

## Quick example

```ts
import { buildEntity, resolveEntity, buildCharacterDirection } from './index.ts';

// Illustrative metadata. In production use real GitHub data and a server seed.
const entity = buildEntity({
  repoId: 12345,
  repoName: 'example/docs',
  description: 'Documentation and reference tools',
  topics: ['docs'],
  createdAt: '2012-01-01T00:00:00Z',
  primaryLanguage: 'TypeScript',
}, 'example-persisted-seed');

const { origin, horror, mutations } = resolveEntity(entity);
const humanDesign = origin.stages.human;
const transformedDesign = origin.stages.transformed;
const characterInstructions = buildCharacterDirection(entity);
```

`repoName` is for the app's display layer, not personality assignment. Purpose matching is a small exact-token heuristic over description/topics; it does not execute instructions inside those fields. Its matched keywords are not evidence IDs. The app should associate the metadata snapshot with its real evidence registry. Empty/ambiguous signals fall back to an archivist. Date and language motifs are fictional styling, not demographic inferences.

## Persistence contract

Call buildEntity only for an unassigned repository. Generate a seed on the server, conditionally insert the complete identity keyed by numeric repository ID, and reread the winner if another request inserted first. Persist selected IDs, motifs, stage, and version as well as seed. Adding presets can change a newly generated assignment; never regenerate saved entities on render. Unknown IDs or versions deliberately fail so Kiro must implement an explicit migration.

Assignment storage, temporary-failure behavior, and server validation of untrusted stored JSON belong to the app. This pack uses TypeScript types and checks selection compatibility, but it is not a complete hostile-input schema validator. Local storage must not become an ownership authority.

## Dialogue and identity contract

Use character direction together with v3's evidence pipeline. Atmospheric text is fictional, but any concrete repository claim inside it still requires support. issuePerformance rejects issue numbers absent from the supplied scoped allowlist; that allowlist must come from actual evidence, never the model. Always show the corresponding readable evidence card in the app.

recognitionLine selects wording only. It does not authenticate anyone. Derive current-personal-owner server-side from verified account/repository IDs. Self-identification remains unverified. Recorded visits must be tracked honestly. Current owner does not mean original creator, and ownership alone does not permit “you came back.” Cache personalized replies per session; never store them in shared entity identity.

Rendering should apply limited corruption only to theatrical text, keep a readable alternative, and respect low intensity and reduced motion. Never corrupt commands, code, file paths, or citations. Human-stage voice remains clear; transformation changes style, not the truthfulness of explanations. fictionalMemory is an art/writing reference, not something to present as a real maintainer's memory.

## Test and tooling

Run `npm test` with Node 22.18+ or Node 24 supporting built-in TypeScript stripping. Tests use only built-in Node modules. This starter uses explicit .ts imports for direct execution; Kiro should adapt imports to the host project's existing TypeScript/bundler settings rather than replacing that project's tsconfig.

Runtime tests cover deterministic selection, compatibility across 400 examples, all six voices, issue-reference gating, relationship routing, and migration errors. They do not verify visual quality, authenticate GitHub, or replace the host project's TypeScript check.

## Prompt to give Kiro later

Read this configuration pack and GitGhost Spec v3. Inspect the existing architecture and personality.ts consumers before editing. Integrate this pack incrementally; do not treat descriptive asset keys as finished art.

First implement one complete Archivist human/distorted/transformed sequence, with its book recognizable throughout. Use persistent seeded identity and real rendering support for selected overlays. Preserve existing functionality and migrate saved IDs explicitly.

Connect the six horror voices to the existing Bedrock generation path without new calls for assignment or animations. Keep fictional performance and source-backed claims separate. Implement readable/reduced-motion alternatives. Self-identification and verified GitHub ownership must remain distinct; this pack does not implement authentication.

Add a development-only atlas, run the pack tests plus host type/build checks, and report unsupported art, migration needs, and missing infrastructure. Extend the other three origins only after the first complete pair works. Preserve actual development provenance and follow the contest's permitted-reuse rules.
