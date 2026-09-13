const BASE_DELAY_MS = 2000;
const MAX_RETRIES = 3;

function computeBackoffDelayMs(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt;
}

export { computeBackoffDelayMs, BASE_DELAY_MS, MAX_RETRIES };
