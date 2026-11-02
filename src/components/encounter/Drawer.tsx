"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Secondary surface (evidence journal, archive). A native modal <dialog>: focus is trapped while open,
 * Escape closes it, and focus returns to the button that opened it. Closed, its text stays in the page
 * markup, so nothing here depends on JavaScript to exist.
 */
export function Drawer({
  title,
  open,
  onOpenChange,
  children,
  testId,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const uid = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={`${uid}-t`}
      data-testid={testId}
      className="drawer"
      onClose={() => onOpenChange(false)}
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false); // a click on the backdrop
      }}
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <h2 id={`${uid}-t`} className="rpg-title">
            {title}
          </h2>
          <button type="button" className="rpg-btn !min-h-11 !px-3 !text-xs" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </dialog>
  );
}
