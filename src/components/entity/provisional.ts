export type ProvisionalReason =
  | "store_unavailable"
  | "store_not_configured"
  | "creation_disabled"
  | "budget_exceeded"
  | "client_budget_exceeded"
  | "not_created";

export const PROVISIONAL_TEXT: Record<ProvisionalReason, string> = {
  store_unavailable: "The identity store was unavailable, so this look is not saved and may change later.",
  store_not_configured: "The identity store is not set up here, so this look is not saved and may change later.",
  creation_disabled: "Saving new ghosts is switched off right now, so this look is not saved and may change later.",
  budget_exceeded: "Many new ghosts are being saved right now, so this look is not saved and may change later.",
  client_budget_exceeded: "You have summoned many new ghosts recently, so this look is not saved and may change later.",
  not_created: "This ghost has not been saved yet, so this look is not saved and may change later.",
};
