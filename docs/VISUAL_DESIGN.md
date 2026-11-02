# Visual design: the encounter (Milestone 2B.3)

Presentation only. No backend, API, identity, evidence, citation, rate-limit or chat-safety code changed.

## What changed from 2B.2 and why
2B.2 put pixel graphics inside a web dashboard: panels around a small 24 x 32 placeholder figure. 2B.3 composes one illustrated location instead. The ghost stands in a graveyard that fills the screen, the dialogue is a game text box at the bottom, and everything else (journal, archive, form toggle) is a thin frame around that scene.

## One pixel size
Ghost and scenery share one art pixel (`--a`, an integer number of CSS px: 4 by default, 5 on very tall desktop windows, 3 on very short ones). The scene is 320 x 240 art pixels, the ghost 64 x 80 art pixels, drawn at the same scale, so no two pixel sizes mix. The ground line (art row 192) sits just above the dialogue dock (`--dlg`); extra width and height are cropped, and the side edges fade into a vignette.

## How the art was made (honest account)
There was no illustrator, no paid image generation and no model inference. The art is drawn by code: `scripts/art/kit.mts` paints shapes with ramp shading from a blurred height field (light from the upper right, where the moon is), adds selective outlines, and dithers. `archivist.mts` draws the character, `scene.mts` draws the graveyard. The output is committed as PNGs (`public/sprites/archivist/`, `public/scene/`) and is deterministic. Re-run with `node scripts/art/export-archivist.mts` and `node scripts/art/scene.mts`. This is programmatic pixel art at a competent but not illustrator-level finish; see Limitations.

## The character (the Archivist, three related forms)
- **Before the forgetting**: tired, worried face, parted dark hair, collar, teal-slate coat, green book with a brass clasp held in pale hands.
- **Distorted**: same figure, palette shifted toward the cold horror palette, paper sheets with text climbing one jaw, ink under one eye, hem dissolving into wisps, floating paper scraps.
- **Transformed**: the head is an open book with two glowing eyes, a crimson ribbon and an ink cap for hair; paper fingers; heavier dissolve.
The book and clasp occupy the same pixels in every form and pose (asserted by `sprites.test.ts` through the exported manifest). Four poses per form: idle, thinking (eyes up), speaking (open mouth, or parted pages), blink (a timed overlay frame). Identity still comes from the stored entity assignment; nothing here rerolls it.
Overlays (ink tears, orbiting eyes, stitched halo, delayed and guarding shadow) are redrawn on the 64 x 80 grid. **missing-outline is not drawn yet** and is reported as such in the Archive in development, never faked.

## The location
Layered PNGs: sky (stars, soft cloud banks, moon), far (ruined abbey, hills, dead trees), mid (iron fence, stones), near (ground, framing tombstones, lantern post), tileable fog drifting in two layers (one behind and one in front of the ghost). Light comes from the moon and from one lantern left of the ghost, drawn as banded (hard-stop) pools. The lantern flame is warm for the human form and ghostly teal for the horror form; the moonlight and vignette shift cold and crimson. Transformation changes appearance, expression, color treatment and lighting only.

## Layout
- **Scene** fills the viewport (`.encounter`).
- **Dialogue dock** at the bottom: a nameplate tab (`owner/name` plus the real GitHub status word), a quiet "Scripted mock" tab, the portrait, the conversation log and a one-line input. The portrait is a crop of the same sprite and is hidden from assistive tech; the scene figure carries the description.
- **HUD** at the top: Graveyard link, compact Before / Now form toggle (accessible names remain "Before the forgetting" and "As it is now", `aria-pressed`), Journal and Archive buttons, and short badges when the look is not saved, the art is a stand-in, or the result is partial.
- **Journal** (evidence ledger, sources, README excerpt) and **Archive** (repository record, honesty notes, "Describe the apparition", development tools) are native modal `<dialog>` drawers. Closed, their text is still in the page markup. The chat stays mounted underneath, and "Open in journal" opens the drawer and focuses the matching entry.

## Dialogue and evidence (unchanged behavior)
Tags **Record**, **Reading**, **Not found**, **Ghost**, `[n]` source links next to claims, Skip during reveal, Retry on error, the `aria-live="off"` log plus a separate `role="status"` announcer, Shift+Enter and double-Enter handling.

## Type, palette, panels
Unchanged from 2B.2 (Press Start 2P for short names, Silkscreen for labels, Atkinson Hyperlegible for reading; self-hosted OFL fonts). Smallest text is 12 px. Meaning never relies on color alone.

## Reduced motion
`prefers-reduced-motion: reduce` stops the sprite bob, blink, speaking frames, thought dots, fog drift, flame flicker, glitch and form flash, and shows static first frames. Verified by real emulation in `check:browser` (the sprite moves with no preference and does not with reduce).

## Limitations
- Programmatic art: the scene reads as a coherent place, but forms are simpler and shading is more uniform than hand-painted work; the ghost's lower body is deliberately lost in fog and dissolve. Other characters (anything except the Archivist) still use the Archivist as a labeled stand-in.
- Very short desktop windows crop the moon; narrow phones crop the lantern and moon out of frame.
- Phones (stabilized in 2C.1): the portrait shows the whole face, two starter choices sit in one row (all four on larger screens), and the keyboard hints are kept for assistive tech but hidden visually. The ghost stays fully visible above the dialogue. Typed questions are unaffected.
- The landing page shares the scene, but the featured graves are still a grid of cards below the fold; it is the least game-like screen.
- Only Chrome (headless, desktop and a 390 px emulation) was checked. Not checked: Safari, Firefox, real phones, screen readers, forced-colors mode.
- The old procedural backdrop files (`src/components/rpg/scene.ts`, `GraveyardScene.tsx`) are no longer used by any page and were left in place.
