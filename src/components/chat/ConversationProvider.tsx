"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useGhostForm } from "@/components/entity/GhostFormContext";
import type { ChatApiResponse, GroundedAnswer } from "@/domain/chat";

/**
 * Conversation state shared by the dialogue window and the evidence journal, so opening the journal
 * never unmounts the chat. History lives in this browser tab only; nothing is stored server side.
 */
export type Turn = {
  id: number;
  question: string;
  form: "current" | "human";
  status: "pending" | "done" | "failed";
  answer?: GroundedAnswer;
  error?: string;
  /** True while the newest answer is still being revealed letter by letter. */
  revealing?: boolean;
};

type Value = {
  turns: Turn[];
  busy: boolean;
  /** Text for the screen-reader status region. */
  announce: string;
  send: (question: string, retryId?: number) => Promise<void>;
  revealDone: (id: number) => void;
  journalOpen: boolean;
  setJournalOpen: (open: boolean) => void;
  openJournalFor: (turnId: number) => void;
};

const MAX_QUESTION = 500;
const MAX_HISTORY_EXCHANGES = 3;
export const MAX_QUESTION_CHARS = MAX_QUESTION;

/** Plain-text version of an answer, used as conversation context and for announcements. Links never travel. */
export function plainAnswer(answer: GroundedAnswer, max = 1200): string {
  return answer.segments.map((s) => s.text).join(" ").slice(0, max) || "(no answer)";
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const Ctx = createContext<Value | null>(null);
export function useConversation(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConversation must be used inside <ConversationProvider>.");
  return v;
}
/** Same hook, but returns null outside a provider (lets leaf components render on their own in tests). */
export const useOptionalConversation = () => useContext(Ctx);

export function ConversationProvider({ owner, repo, children }: { owner: string; repo: string; children: ReactNode }) {
  const { form, setChatPose, speakBriefly } = useGhostForm();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [journalOpen, setJournalOpen] = useState(false);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const nextId = useRef(1);

  useEffect(() => () => abort.current?.abort(), []);

  const revealDone = useCallback(
    (id: number) => {
      setTurns((prev) => prev.map((t) => (t.id === id && t.revealing ? { ...t, revealing: false } : t)));
      setChatPose("idle");
    },
    [setChatPose],
  );

  const openJournalFor = useCallback((turnId: number) => {
    setJournalOpen(true);
    // Wait for the <details> to open before moving focus into it.
    requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`journal-entry-${turnId}`)?.focus()));
  }, []);

  const send = useCallback(
    async (question: string, retryId?: number) => {
      const q = question.trim();
      if (!q || inFlight.current) return; // one question at a time: no duplicate submissions
      inFlight.current = true;
      setBusy(true);
      const id = retryId ?? nextId.current++;
      const history = turns
        .filter((t) => t.status === "done" && t.answer && t.id !== id)
        .slice(-MAX_HISTORY_EXCHANGES)
        .flatMap((t) => [
          { role: "user" as const, content: t.question },
          { role: "assistant" as const, content: plainAnswer(t.answer!) },
        ]);
      setTurns((prev) => {
        const settled = prev.map((t) => (t.revealing ? { ...t, revealing: false } : t));
        return retryId
          ? settled.map((t) => (t.id === id ? { ...t, status: "pending" as const, error: undefined, form } : t))
          : [...settled, { id, question: q, form, status: "pending" as const }];
      });
      setChatPose("thinking");
      setAnnounce("The ghost is thinking.");
      const controller = new AbortController();
      abort.current = controller;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ owner, repo, question: q, history, form }),
          signal: controller.signal,
        });
        const data = (await res.json()) as ChatApiResponse;
        if (controller.signal.aborted) return;
        if (data.ok) {
          const reveal = !prefersReducedMotion();
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "done", answer: data.answer, revealing: reveal } : t)));
          if (reveal) setChatPose("speaking");
          else speakBriefly(2500);
          const n = data.answer.sources.length;
          setAnnounce(`The ghost says: ${plainAnswer(data.answer, 500)} ${n} ${n === 1 ? "source" : "sources"} attached.`);
        } else {
          const message = data.retryAfterSec && !data.message.includes("Try again") ? `${data.message} Try again in ${data.retryAfterSec} seconds.` : data.message;
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "failed", error: message } : t)));
          setChatPose("idle");
          setAnnounce(`The ghost could not answer. ${message}`);
        }
      } catch {
        if (controller.signal.aborted) return;
        const message = "The ghost could not be reached. Check your connection and try again.";
        setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, status: "failed", error: message } : t)));
        setChatPose("idle");
        setAnnounce(message);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [turns, form, owner, repo, setChatPose, speakBriefly],
  );

  const value = useMemo(
    () => ({ turns, busy, announce, send, revealDone, journalOpen, setJournalOpen, openJournalFor }),
    [turns, busy, announce, send, revealDone, journalOpen, openJournalFor],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
