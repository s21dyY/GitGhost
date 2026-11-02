"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import "@/components/v4/v4.css";
import { V4Ghost, type Form, type Kind } from "@/components/v4/V4Ghost";
import type { SceneFamily } from "@/components/v4/scene-theme";
import { playSfx } from "@/lib/sound";
import { summonClick, useSummon } from "./SummonProvider";

export type SpiritData = {
  owner: string;
  repo: string;
  summary: string;
  language: string;
  status: "archived" | "quiet" | "active";
  statusLabel: string;
  statusDefinition: string;
  pushed: string;
  href: string;
  githubUrl: string;
  /** The ghost's drawn body and look: the saved identity when it could be read, otherwise a fixed fallback. */
  sprite: Kind;
  form: Form;
  scene: SceneFamily;
};

/**
 * A ghost that haunts the graveyard. It drifts about half-hidden by fog and darkness; coming close (hover, focus or
 * touch) brings it into the light and shows who it is and what you can do. The ghost itself is the way in: clicking
 * it summons it. Keyboard and screen-reader users reach the same action through the labelled Summon link.
 */
export function Spirit({ s, index }: { s: SpiritData; index: number }) {
  const summon = useSummon();
  const style = {
    "--dx": `${[46, -52, 38, -44, 56, -34][index % 6]}px`,
    "--dur": `${[17, 21, 19, 24, 18, 22][index % 6]}s`,
    "--delay": `${-index * 3.1}s`,
    "--lift": `${[0, 46, 14, 62, 8, 38][index % 6]}px`,
  } as CSSProperties;
  const enter = () => playSfx("hover");
  return (
    <li className="spirit" data-status={s.status} data-sprite={s.sprite} data-form={s.form} data-scene={s.scene} style={style} onMouseEnter={enter} onFocusCapture={enter}>
      <div className="spirit-drift">
        <div className="spirit-face">
          <Link href={s.href} tabIndex={-1} aria-hidden="true" className="spirit-figure" onClick={summonClick(summon, s.href)} data-testid="spirit-figure">
            <V4Ghost sprite={s.sprite} form={s.form} expr="neutral" decorative bob />
            <span className="spirit-veil" />
          </Link>
        </div>
        <h3 className="spirit-name">
          <span className="font-label spirit-owner">{s.owner}/</span>
          <span className="font-pixel spirit-repo">{s.repo}</span>
        </h3>
        <div className="spirit-detail">
          <p className="spirit-line">{s.summary}</p>
          <p className="spirit-meta">
            <span className="spirit-status" title={s.statusDefinition}>{s.statusLabel}</span> · {s.language} · last push {s.pushed}
          </p>
          <p className="spirit-actions">
            <Link href={s.href} className="rpg-btn rpg-btn-primary" aria-label={`Summon ${s.owner}/${s.repo}`} onClick={summonClick(summon, s.href)}>
              Summon ▶
            </Link>
            <a href={s.githubUrl} target="_blank" rel="noopener noreferrer" className="spirit-gh" aria-label={`${s.owner}/${s.repo} on GitHub (opens in a new tab)`}>
              GitHub ↗
            </a>
          </p>
        </div>
      </div>
    </li>
  );
}
