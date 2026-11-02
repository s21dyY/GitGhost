"use client";

import { useEffect } from "react";
import { setSound, useSound, wantAmbient } from "@/lib/sound";

/** The mute switch. Sound is off until the player turns it on; the choice is remembered. */
export function SoundToggle({ className = "" }: { className?: string }) {
  const on = useSound();
  return (
    <button
      type="button"
      className={`rpg-btn !min-h-11 !min-w-11 !px-3 !text-xs ${className}`}
      aria-pressed={on}
      onClick={() => setSound(!on)}
      data-testid="sound-toggle"
    >
      <span aria-hidden="true">{on ? "♪" : "×"}</span>
      <span className="sr-only sm:not-sr-only"> Sound: {on ? "on" : "off"}</span>
    </button>
  );
}

/** Mount this on a page that has an ambient bed. It plays only while sound is on and stops when the page is left. */
export function Ambient() {
  useEffect(() => {
    wantAmbient(true);
    return () => wantAmbient(false);
  }, []);
  return null;
}
