/**
 * Guard so only the most recently started request may update UI state.
 * Starting a new request aborts the previous one and marks it stale.
 */
export type RequestTicket = {
  signal: AbortSignal;
  /** True only while this is still the newest ticket and not cancelled. */
  isCurrent(): boolean;
};

export function createLatestGuard() {
  let controller: AbortController | null = null;
  let counter = 0;
  return {
    begin(): RequestTicket {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      const id = ++counter;
      return {
        signal: mine.signal,
        isCurrent: () => id === counter && !mine.signal.aborted,
      };
    },
    cancel() {
      counter++;
      controller?.abort();
      controller = null;
    },
  };
}
