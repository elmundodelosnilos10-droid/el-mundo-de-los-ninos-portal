export const CHAT_POLL_BASE_DELAY_MS = 10_000;
export const CHAT_POLL_MAX_DELAY_MS = 60_000;

export function chatPollDelayForFailures(consecutiveFailures: number) {
  const failures = Number.isFinite(consecutiveFailures) ? Math.max(0, Math.floor(consecutiveFailures)) : 0;
  return Math.min(CHAT_POLL_BASE_DELAY_MS * 2 ** failures, CHAT_POLL_MAX_DELAY_MS);
}
