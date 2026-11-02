# GitGhost requirements
Source of truth: `BUILD.md`, as amended by `.kiro/steering/decisions.md` (D1 to D5 override BUILD.md where they differ). This is a requirement list, not an implemented-feature report.
- R1: Landing graveyard shows genuine public repo links and accessible preview cards.
- R2: A user can summon the same canonical repo by card or valid URL; malformed input is rejected.
- R3: Live facts and fictional lore are visibly different; unsupported facts are not shown as truth.
- R4: Stable persisted entity assignment and three paired character forms; five origins, including the Bellwraith (warm as a human; once changed it speaks only in exact cited quotes).
- R5: Revision-scoped historical data with citations and honest missing-data states.
- R6: First encounter and legacy-code explanation ("Possession").
  - R6.1: A scripted opening that reacts to how the visitor arrived, states one cited fact, then offers an RPG choice menu. Scripted so it is instant and cannot fail.
  - R6.2: The ghost's files and code in a viewer; a server-side tree-sitter outline (33 grammars, approximate fallback for others, labelled approximate).
  - R6.3: "What does this do" reads the whole file up to about 48 KB, or the focus plus a nearby skeleton for larger files; answers are cited interpretation of the code shown, never authors' intent or unshown history.
  - R6.4: Why/when questions about a file use its commits and pull requests only.
  - No quests or revival briefs (D2). Content written by another AI is never evidence (D4).
- R7: Demonstrable Kiro workflow, accessible UI, security/reliability basics and submission compliance.
