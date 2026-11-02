"use client";

import { useEffect, useRef } from "react";
import { SoundToggle } from "@/components/SoundToggle";
import { playSfx } from "@/lib/sound";
import { PresenceShape } from "./Presence";
import { SummonForm } from "./SummonForm";
import { originOf, useSummon } from "./SummonProvider";
import { WalkField } from "./WalkField";

/**
 * The home screen as a game: the graveyard fills the screen and the visitor walks it. Around the field, a HUD: the title
 * and the sound switch on top; at the bottom, the command line (speak a repository's name to summon it) and the controls.
 * The Presences window is the same choice as walking up to one, as a plain list, for keyboard, screen reader and anyone
 * who would rather not walk. Hotkeys: L opens it, N jumps to the command line (never while the visitor is typing).
 */
export function GraveyardGame({ hrefs }: { hrefs: string[] }) {
  const list = useRef<HTMLDialogElement>(null);
  const summon = useSummon();
  const openList = () => {
    playSfx("open");
    list.current?.showModal();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        openList();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        document.getElementById("summon-input")?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="game">
      <header className="game-top">
        <h1 className="game-logo">GitGhost</h1>
        <div className="game-top-actions">
          <button type="button" className="game-btn" onClick={openList} aria-haspopup="dialog" data-testid="open-presences">
            <span aria-hidden="true">☰</span> <span className="game-btn-label">Presences</span> <kbd>L</kbd>
          </button>
          <SoundToggle className="game-sound" />
        </div>
      </header>

      <WalkField
        hrefs={hrefs}
        intro={
          // decorative: the page's heading is the logo above; this is the title card until the first step
          <div className="game-title-card" aria-hidden="true">
            <p className="landing-title game-title" data-text="GitGhost">GitGhost</p>
            <p className="landing-tagline game-tagline">
              <span className="landing-tag-a">Every repo has a ghost.</span>
              {/* for a moment, now and then, the line is not the same line */}
              <span className="landing-tag-b">Every repo has <em>your</em> ghost.</span>
            </p>
            <p className="game-start">▶ Walk to begin</p>
          </div>
        }
      />

      <footer className="game-bottom">
        <SummonForm />
        <p className="game-keys" aria-hidden="true">
          <span><kbd>←↑↓→</kbd> walk</span>
          <span><kbd>E</kbd> approach</span>
          <span><kbd>L</kbd> presences</span>
          <span><kbd>N</kbd> speak a name</span>
        </p>
        <p className="game-note">Ghosts are fictional. Repository facts come from GitHub.</p>
      </footer>

      <dialog ref={list} className="game-window" aria-labelledby="presences-h" onClick={(e) => e.target === list.current && list.current?.close()}>
        <div className="game-window-inner">
          <h2 id="presences-h" className="game-window-title">The restless</h2>
          <p className="game-window-text">They wait in the graveyard. Each haunts a real public GitHub repository; you learn which when you approach.</p>
          <ul className="game-presences">
            {hrefs.map((href, i) => (
              <li key={href}>
                <button
                  type="button"
                  className="game-presence"
                  aria-label={`Approach presence ${i + 1} of ${hrefs.length}`}
                  onMouseEnter={() => playSfx("hover")}
                  onClick={(e) => {
                    const at = originOf(e.currentTarget);
                    list.current?.close();
                    summon(href, at, "graveyard");
                  }}
                  data-testid="presence"
                >
                  <PresenceShape i={i} scale={3} />
                  <span aria-hidden="true">▶ approach</span>
                </button>
              </li>
            ))}
          </ul>
          <form method="dialog"><button className="game-btn">Close <kbd>Esc</kbd></button></form>
        </div>
      </dialog>
    </div>
  );
}
