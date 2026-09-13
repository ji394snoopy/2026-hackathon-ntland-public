import Anthropic from "@anthropic-ai/sdk";

const BASE_DELAY_MS = 2000;
const MAX_RETRIES = 3;
// Same status set the Anthropic SDK's own internal shouldRetry() uses: request/lock
// timeouts, rate limits, and server errors. Anything else (400/401/403/404/422, ...)
// is a real request problem that won't succeed on retry.
const RETRYABLE_STATUSES = new Set([408, 409, 429]);

function computeBackoffDelayMs(attempt: number): number {
  return BASE_DELAY_MS * 2 ** attempt;
}

function isRetryableClaudeError(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.APIError) {
    const status = err.status;
    return typeof status === "number" && (status >= 500 || RETRYABLE_STATUSES.has(status));
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries the whole call from scratch on a transient failure — there's no way to
// resume a partially-received SSE stream, so a failed attempt (even one that started
// streaming) is discarded and re-invoked as a fresh request.
async function withClaudeRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetryableClaudeError(err) || attempt === MAX_RETRIES) throw err;
      const delayMs = computeBackoffDelayMs(attempt);
      console.warn(
        `${label}: ${(err as Error).message}, retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delayMs);
    }
  }
}

export {
  withClaudeRetry,
  isRetryableClaudeError,
  computeBackoffDelayMs,
  BASE_DELAY_MS,
  MAX_RETRIES,
};
