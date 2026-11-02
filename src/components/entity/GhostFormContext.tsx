"use client";

import type { Stage } from "./archivist/sprites";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

export type GhostForm = "current" | "human";
export type ChatPose = "idle" | "thinking" | "speaking";

type Value = {
  /** Which form the visitor chose with the "Before the forgetting" toggle. */
  form: GhostForm;
  setForm: (f: GhostForm) => void;
  /** Pose driven by the conversation: thinking while a question is out, speaking briefly after an answer. */
  chatPose: ChatPose;
  setChatPose: (p: ChatPose) => void;
  /** Show "speaking" for a moment, then return to idle. */
  speakBriefly: (ms?: number) => void;
  /** Development-only previews, set by the dev tools. Ignored unless the page was rendered by `next dev`. */
  devStage: Stage | null;
  setDevStage: (s: Stage | null) => void;
  devPose: ChatPose | "blink";
  setDevPose: (p: ChatPose | "blink") => void;
};

// A harmless default so the ghost renders on its own (for example in server-render tests).
const Ctx = createContext<Value>({ form: "current", setForm: () => undefined, chatPose: "idle", setChatPose: () => undefined, speakBriefly: () => undefined, devStage: null, setDevStage: () => undefined, devPose: "idle", setDevPose: () => undefined });

export function GhostFormProvider({ children }: { children: ReactNode }) {
  const [form, setForm] = useState<GhostForm>("current");
  const [chatPose, setChatPose] = useState<ChatPose>("idle");
  const [devStage, setDevStage] = useState<Stage | null>(null);
  const [devPose, setDevPose] = useState<ChatPose | "blink">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const set = useCallback((p: ChatPose) => {
    clearTimeout(timer.current);
    setChatPose(p);
  }, []);
  const speakBriefly = useCallback((ms = 3500) => {
    clearTimeout(timer.current);
    setChatPose("speaking");
    timer.current = setTimeout(() => setChatPose("idle"), ms);
  }, []);

  const value = useMemo(() => ({ form, setForm, chatPose, setChatPose: set, speakBriefly, devStage, setDevStage, devPose, setDevPose }), [form, chatPose, set, speakBriefly, devStage, devPose]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useGhostForm = () => useContext(Ctx);
