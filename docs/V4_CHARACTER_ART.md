# V4 character art and animation review

Scope: visual horror quality only. Isolated under `/prototype/v4` and `/prototype/v4/art` (hidden in production unless `GITGHOST_PROTOTYPES=1` is set at request time). The production screen, the production sprites in `public/sprites/archivist/` (manifest hash unchanged), the backend, `.env.local`, AWS and Bedrock were not touched. Nothing is committed.

How to look at it:

```
npm run build
GITGHOST_PROTOTYPES=1 npx next start -p 3100
# http://localhost:3100/prototype/v4/art   character lab: before/after, 3 forms x 6 expressions, live animations
# http://localhost:3100/prototype/v4       the encounter in the real scene (Spirit Record > Prototype tools)
node scripts/v4-art-shots.mts http://127.0.0.1:3100 docs/screenshots/v4-art/final
```

Screenshots: `docs/screenshots/v4-art/final/` (`round1/` is an earlier, weaker pass kept for comparison).

## What changed in the character

Original art, drawn in code (`scripts/art/v4-archivist.mts`) on the same 64 x 80 grid, reusing the production body, coat, book, clasp and hood. Influences (Look Outside, Blasphemous, Lovecraftian body horror) are mood only; no game assets were used or traced.

One generator, one morph value `t` (0 human, 0.5 distorted, 1 horror). The three forms and every transformation frame are the same code at different `t`, so the intermediate frames are real points between the forms.

| Form | Face and body |
| --- | --- |
| Human | Same person as before, paler and more tired. Expression-capable. |
| Distorted | Long face, one huge bloodshot eye with a pinprick pupil, the other eye sewn shut with bone-coloured stitches, cheek torn open with the teeth showing through, jaw hung open on stitched lips, blood tear and mouth trickle onto the book, a boil on the shoulder, blood-soaked page edge and hem. |
| Horror | The face has opened along its spine into a wet cavity with irregular teeth and four staring eyes of different sizes, a tongue of the Archivist's own pages hangs to the book, an eye grows from the swollen shoulder, blood runs from the page edge and the hem, the hood is pushed out on the swollen side. |

Kept: hood outline, book, brass clasp, coat, long fingers, torn hem. The silhouette now has two deliberate additions (the shoulder growth, about 3 px; the swollen hood side, about 2 px).

## Six expressions

Neutral, melancholy, amused, angry, disturbed, eldritch, on all three forms (18 drawn faces, generated, not hand-edited). They move the lids, pupils, brows, mouth and, in the horror form, how wide the cavity opens and whether its eyes are open or half shut. Eldritch lights the eyes (vertical slits) and the cavity. Shown at in-game size (4 px per art pixel on a laptop, 3 px on a phone) in `02-forms-expressions-*.png`.

## Three signature animations

1. **Blood drips.** Bead forms, hangs, stretches, falls, splashes. Two or three drips per changed form, each on its own cycle, starting from clean cloth (the cuff, the paper tongue, the shoulder growth). 13-frame strips, CSS only. Reduced motion: one still hanging bead. Capture: `08-anim-blood-*.png`.
2. **Twitch and freeze.** Four fast jerks (90, 70, 60, 110 ms) with the head shifted and sheared 3 px and the body jerking with it, then the head locks at a wrong angle with the eyes on the camera for 1.5 s while every other animation in the room (ash, fog, drips, flame) pauses, then a small snap back. About 2.1 s. Fires from the tool button, on disturbing memory pages, and rarely on its own. The dialogue box tears briefly with it. Reduced motion: it does not play. Capture: `09-anim-twitch-*.png`.
3. **Human to horror.** Twelve drawn frames: the person; a flicker of dread; the first flinch; the eyes drift apart; the jaw gives; the face stretches and veins show; a held beat as the distorted form; the skin parts at the brow; the wound opens and pages come out; new eyes open; settling; the horror. The room turns red and the figure convulses by one art pixel. It also plays backwards (horror to human) and between neighbouring forms when you rewind. Reduced motion: it does not play, the form simply changes. Capture: `10-anim-transform-*.png`.

Not delivered: recorded video. This machine has no ffmpeg and Playwright's video recorder needs one; I did not download it. The strips are real captures from the running scene with millisecond stamps, and the same animations run live on both prototype pages.

## Dialogue

The ghost's own lines are broken: stutters ("A-Ask"), trailing off ("…"), stalls on punctuation. The text is deterministic (same line, same breaks) and applies only to fictional ghost lines. Records, readings and gaps are plain, steady, in their own slip with a coloured rule, and cannot stutter or tear. Screen readers get the whole sentence (while it types and after). The portrait carries the same form and expression as the figure and mouths along while it speaks. Rarely the voice and the portrait tear for a third of a second. The box has a stained, torn edge. Free-form input is unchanged; suggestions are shortcuts.

## Checks

Typecheck, lint, 711 tests (4 skipped; 30 are for this prototype, including the art: 18 faces distinct, expressions change only the head, hood and book anchors identical across forms, transform frames land exactly on the human and horror frames, speech only adds stutters and pauses). Browser: 24/24 functional checks and the art script's checks pass (whole-number pixel scale, no overflow on desktop or mobile, no console errors, facts never stutter, screen-reader text whole, reduced motion stills drips/bob/blink and skips twitch and transformation).

## Honest weaknesses

- **Human face.** The eyes and brows are still muddy at this size; it reads as a tired person but is the weakest of the three.
- **Horror expressions.** The wound dominates the face. Melancholy, amused, angry and disturbed differ mainly in the left eye, the brows and how open the maw is; they are clearer on the human and distorted forms than on the horror form.
- **Twitch.** Readable in the strip, but at 4 px per art pixel the head movement is a few screen pixels. A real video or a bigger tilt would sell it more.
- **Blood drips.** Small next to the painted blood. Visible in the zoomed capture, easy to miss at a glance.
- **Hood.** The original character has a dark hair curtain that reads as a hood, not a true cowl. I kept it and added folds and a wet edge rather than redrawing it as a hood.
- **Gore level.** Teeth, exposed muscle and blood in stylised pixel art. Say so if it is too much, or not enough, for the game you want.
- **Not audited:** screen readers on a real device, automated contrast on the new dialogue slips, performance over a long session.
- The sprites are 64 x 80 at 4 px. More facial detail would need a larger sprite or a head-only close-up portrait at a higher pixel density, which would mix pixel sizes.

## Files

- Art: `scripts/art/v4-archivist.mts` (generator), `scripts/art/v4-peek.mts` (artist helper), `public/sprites/v4/*.png` + `manifest.json`, copy in `src/components/v4/art.manifest.json`. `scripts/art/archivist.mts` only gained `export` keywords.
- UI: `src/components/v4/{V4Ghost,sequence,speech,typewriter,dialogue,ArtLab,V4Game,panels}.tsx|ts`, `v4.css`, routes `src/app/prototype/v4/{page,art/page}.tsx`.
- Checks: `scripts/v4-art-shots.mts`, `scripts/v4-shots.mts`, `src/components/v4/{art,v4}.test.tsx`.
