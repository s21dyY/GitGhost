# UI horror atmosphere pass

Scope: art, CSS and two tiny markup hooks. No backend, evidence, chat, IAM, Bedrock or usage changes. No model calls.

Screenshots: `docs/screenshots/horror/before/` and `docs/screenshots/horror/after/` (desktop 1440x900, mobile 390x844, plus `ghost-sheet.png`).

## Ghost (scripts/art/archivist.mts)
- Same silhouette, book and clasp pixels in every form and pose (sprite tests still pin this).
- Palette moved to waxy greys, desaturated coat, dimmer brass.
- Face: narrower via wider hair curtains. Human form is gaunt and tired (right eye one pixel low, flat mouth).
- Distorted form: asymmetric eyes (left a hollow socket with a pinprick glow, right a wide stare with a tiny pupil), heavy low left brow, lifted right brow, thin off-kilter smile. The blink keeps the left eye as a lit slit.
- Right shoulder sags; robe hem gets wear and stains below the book; fingers tense on the book edge.
- Wrongness, not gore.

## Palette
Deeper blue-black base, desaturated teal, corpse-gray and dim bone text, crimson only as a restrained accent. Lavender and neon removed from default chrome. Scenery layers pass through a grade (about 50% desaturation, 20% darker, slight cold tint). Warm light is kept for the lantern and two abbey windows.

## Atmosphere
- Dead branches reaching in from the top corners, a faint tall figure on the far ridge.
- Thicker fog, heavier vignette (crimson-black in the distorted form), cold moonlight.
- Slow drifting ash (CSS, aria-hidden) and a rare faint cold flicker (once per 11 to 17 s, well under 3 Hz).

## UI
- Panels, buttons, tabs and tags are dimmer and flatter, with age gradients and a hairline crack; the dialogue box has chamfered corners.
- Ghost lines get a dim crimson mark and, in the distorted form, a rare colour-fringe on the text shadow. Words, labels, citations and honesty tags never move or glitch.
- Focus rings unchanged (4px bone outline).

## Accessibility
`prefers-reduced-motion` disables ash, flicker and voice fringe. Browser checks: no contrast failures, min font 12px, no horizontal overflow at 1440x900 and 390x844.

## Limits
The ridge figure is subtle and may read as a post at small sizes. The floating eye near the abbey window is an existing mutation part, not new. Judged by eye in Chrome only; no screen-reader pass.

## Final review notes
- Fixed after review: the ghost-voice styling keyed off a `data-voice` value that never matched; it now applies in the distorted form only.
- Under `prefers-reduced-motion`, ash, flicker, fog, lantern flame, ghost bob and ghost voice all report `animation: none` (checked in Chrome).
- Distorted face detail (hollow left socket) is small at normal zoom; the read comes mainly from asymmetry, hair curtain and the exposed book edge. A larger portrait crop would show more, left for a later pass.
