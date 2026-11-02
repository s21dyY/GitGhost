"use client";

import { createContext, useContext } from "react";
import type { EvidenceData, GameData } from "./data";

/** The data the game is showing, with every evidence item known so far (page evidence plus cited sources). */
export type Game = GameData & { allEvidence: EvidenceData[] };

const Ctx = createContext<Game | null>(null);
export const GameProvider = Ctx.Provider;
export function useGame(): Game {
  const g = useContext(Ctx);
  if (!g) throw new Error("useGame must be used inside <GameProvider>.");
  return g;
}

/** Short text for an evidence chip. Real evidence shows its own label ("Commit 3f2a1bc"); fixtures keep E-numbers. */
export function chipLabel(g: Game, id: string): string {
  const e = g.allEvidence.find((x) => x.id === id);
  if (!e) return id;
  return g.mode === "mock" ? e.id : e.label.length > 22 ? `${e.label.slice(0, 21)}…` : e.label;
}
