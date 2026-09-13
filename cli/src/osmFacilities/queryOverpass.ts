import { computeBackoffDelayMs, MAX_RETRIES } from "./retryDelay.js";

const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
// overpass-api.de's Apache config 406s Node's default fetch User-Agent (curl and a
// custom UA both work fine) — Overpass's own usage policy also asks for an identifiable
// client, so this satisfies both at once.
const USER_AGENT = "cli-util-osmFacilities/1.0";
// The public instance's fair-use rate limiting (429) and its own load-shedding (503/504)
// are both transient — worth a retry with backoff. Anything else (e.g. a malformed
// query's 400) won't succeed on retry, so it's not in this set.
const RETRYABLE_STATUSES = new Set([429, 503, 504]);

function retryAfterMs(response: Response, attempt: number): number {
  const header = response.headers.get("Retry-After");
  const headerSeconds = header ? Number(header) : NaN;
  return Number.isFinite(headerSeconds) ? headerSeconds * 1000 : computeBackoffDelayMs(attempt);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function queryOverpass(query: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(OVERPASS_API_URL, {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      });
    } catch (err) {
      // A rejected fetch() is a connection-level failure (DNS, TCP timeout, reset) —
      // no Response to read a status from, but just as transient as a 503/504.
      if (attempt === MAX_RETRIES) throw err;
      const delayMs = computeBackoffDelayMs(attempt);
      console.warn(
        `queryOverpass: network error (${(err as Error).message}), retrying in ${delayMs}ms ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delayMs);
      continue;
    }
    if (response.ok) {
      return response.json();
    }
    if (!RETRYABLE_STATUSES.has(response.status) || attempt === MAX_RETRIES) {
      throw new Error(`Overpass request failed (${response.status} ${response.statusText}): ${query}`);
    }
    const delayMs = retryAfterMs(response, attempt);
    console.warn(
      `queryOverpass: got ${response.status}, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})...`,
    );
    await sleep(delayMs);
  }
}

export { OVERPASS_API_URL, queryOverpass };

