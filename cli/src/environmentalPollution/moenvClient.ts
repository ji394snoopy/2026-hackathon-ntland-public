const MOENV_API_BASE_URL = "https://data.moenv.gov.tw/api/v2";

type MoenvParams = Record<string, string | number>;

function buildMoenvUrl(dataset: string, apiKey: string, params: MoenvParams = {}): string {
  const query = new URLSearchParams({ format: "json", api_key: apiKey });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }
  return `${MOENV_API_BASE_URL}/${dataset}?${query.toString()}`;
}

function readMoenvApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env.MOENV_API_KEY;
  if (!key) {
    throw new Error(
      "MOENV_API_KEY is not set. Register a free key at https://data.moenv.gov.tw/api-term " +
        "and add MOENV_API_KEY=... to your .env file (see .env.example).",
    );
  }
  return key;
}

function parseMoenvArrayResponse(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // A bad/expired key returns a Chinese message directly prefixed to a JSON blob
    // (e.g. "該 API KEY 不存在或是已經到期。{...}"), which is not valid JSON on its own —
    // surface it as-is rather than a bare SyntaxError, since it's already diagnostic.
    throw new Error(`MOENV request failed — response was not valid JSON: ${text}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`MOENV request returned an unexpected shape (expected a JSON array): ${text}`);
  }
  return parsed;
}

async function queryMoenvDataset(dataset: string, apiKey: string, params?: MoenvParams): Promise<unknown[]> {
  const url = buildMoenvUrl(dataset, apiKey, params);
  const response = await fetch(url);
  const text = await response.text();
  return parseMoenvArrayResponse(text);
}

// Confirmed live: `limit` is silently capped at 1000 server-side regardless of what's
// requested (asking for 2500 still returns exactly 1000) — a dataset with more rows
// than that (e.g. ems_s_07's 2000+ contamination sites) gets silently truncated to its
// first page by a single queryMoenvDataset call. This loops offset-based pages until a
// short page signals the end, or maxPages is hit (a safety bound, not an expected limit
// for the station/site datasets this repo uses — only relevant for a genuinely huge or
// unbounded dataset like WQX_P_01's full measurement history).
const MOENV_PAGE_SIZE = 1000;

async function queryMoenvDatasetPaginated(
  dataset: string,
  apiKey: string,
  params: MoenvParams = {},
  maxPages = 20,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (let page = 0; page < maxPages; page++) {
    const pageRecords = await queryMoenvDataset(dataset, apiKey, {
      ...params,
      limit: MOENV_PAGE_SIZE,
      offset: page * MOENV_PAGE_SIZE,
    });
    results.push(...pageRecords);
    if (pageRecords.length < MOENV_PAGE_SIZE) break;
  }
  return results;
}

export { buildMoenvUrl, readMoenvApiKey, parseMoenvArrayResponse, queryMoenvDataset, queryMoenvDatasetPaginated };
export type { MoenvParams };
