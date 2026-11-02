import type { ElementType, ReactNode } from "react";

export type PanelTone = "purple" | "gold" | "teal" | "crimson" | "bone" | "dim";

const TONE: Record<PanelTone, string> = {
  purple: "",
  gold: "rpg-gold",
  teal: "rpg-teal",
  crimson: "rpg-crimson",
  bone: "rpg-bone",
  dim: "rpg-dim",
};

/**
 * Shared pixel-bordered window. Pure presentation: border, bevel and notched corners come from CSS
 * (see .rpg-panel). `title` renders as a small pixel-font caption inside the window.
 */
export function RPGPanel({
  as: Tag = "section",
  tone = "purple",
  title,
  titleId,
  className = "",
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: PanelTone;
  title?: string;
  titleId?: string;
  className?: string;
  children: ReactNode;
} & Record<string, unknown>) {
  return (
    <Tag className={`rpg-panel ${TONE[tone]} ${className}`} aria-labelledby={title ? titleId : undefined} {...rest}>
      {title ? (
        <h2 id={titleId} className="rpg-title px-3 pt-3 sm:px-4">
          {title}
        </h2>
      ) : null}
      {children}
    </Tag>
  );
}
