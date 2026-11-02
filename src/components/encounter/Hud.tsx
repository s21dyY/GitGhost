"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useConversation } from "@/components/chat/ConversationProvider";
import { FormToggle } from "@/components/entity/GhostPanel";
import { Drawer } from "./Drawer";

/**
 * The thin frame around the encounter: way back, form toggle, and the two secondary surfaces.
 * The journal's open state lives in the conversation, so an answer can open it and the chat stays mounted.
 */
export function Hud({ badges, notice, archive, journal, showToggle = true }: { badges?: ReactNode; notice?: ReactNode; archive: ReactNode; journal: ReactNode; showToggle?: boolean }) {
  const { journalOpen, setJournalOpen, turns } = useConversation();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const entries = turns.filter((t) => t.status === "done" && t.answer).length;
  return (
    <>
      <header className="hud">
        <nav aria-label="Encounter" className="hud-row">
          <Link href="/" className="rpg-btn !min-h-11 !px-3 !text-xs">
            <span aria-hidden="true">← </span>Graveyard
          </Link>
          <span className="hud-spacer" />
          {showToggle ? <FormToggle /> : null}
          <button type="button" className="rpg-btn !min-h-11 !px-3 !text-xs" onClick={() => setJournalOpen(true)} aria-haspopup="dialog">
            Journal{entries ? ` (${entries})` : ""}
          </button>
          <button type="button" className="rpg-btn !min-h-11 !px-3 !text-xs" onClick={() => setArchiveOpen(true)} aria-haspopup="dialog">
            Archive
          </button>
        </nav>
        {badges || notice ? (
          <div className="hud-row hud-sub">
            {badges}
            {notice}
          </div>
        ) : null}
      </header>
      <Drawer title="Evidence journal" open={journalOpen} onOpenChange={setJournalOpen} testId="journal-drawer">
        {journal}
      </Drawer>
      <Drawer title="Archive" open={archiveOpen} onOpenChange={setArchiveOpen} testId="archive-drawer">
        {archive}
      </Drawer>
    </>
  );
}
