// Shared helper for the per-lambda `invoke-local.ts` dev scripts.
//
// Each lambda folder ships an `invoke-local.ts` that imports its own `handler` plus this
// helper, declares one or more example Function URL events (with usage notes), and calls
// `runLocal(handler, event)`. Run one with the repo's esbuild TS loader, no deploy needed:
//
//   cd infra
//   node --import ./scripts/register-ts.mjs lambda/<name>/invoke-local.ts
//
// Handlers that hit AWS (Bedrock / RDS Data API) need creds + region in the environment:
//
//   AWS_PROFILE=PROFILE AWS_REGION=us-east-1 \
//     node --import ./scripts/register-ts.mjs lambda/<name>/invoke-local.ts
//
// A binary response (isBase64Encoded, e.g. PNG/PDF) is decoded and written to a file under
// infra/tmp/ so you can open it; JSON responses are pretty-printed to stdout.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The subset of a Lambda Function URL event our handlers read. All optional so an example
// can pass only what its handler looks at (query string, or POST body, or method).
export interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface LambdaResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

type Handler = (event: FunctionUrlEvent) => Promise<LambdaResponse>;

// Map a response content-type to a sensible file extension for binary bodies.
function extForContentType(contentType: string | undefined): string {
  if (!contentType) return "bin";
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("json")) return "json";
  return "bin";
}

/**
 * Invoke one handler locally with the given event and report the result.
 *
 * @param handler   the lambda's exported `handler`
 * @param event     the Function URL event to feed it
 * @param label     optional name used for the output filename (defaults to "invoke")
 */
export async function runLocal(
  handler: Handler,
  event: FunctionUrlEvent,
  label = "invoke",
): Promise<LambdaResponse> {
  const startedAt = Date.now();
  const res = await handler(event);
  const ms = Date.now() - startedAt;

  const headers = res.headers ?? {};
  const contentType = headers["content-type"] ?? headers["Content-Type"];
  console.log(`\n[${label}] status=${res.statusCode} (${ms}ms) content-type=${contentType ?? "—"}`);

  if (res.isBase64Encoded) {
    // Binary body (PNG/PDF): decode and write to infra/tmp/ so it can be opened.
    const outDir = resolve(process.cwd(), "tmp");
    mkdirSync(outDir, { recursive: true });
    const ext = extForContentType(contentType);
    const outFile = resolve(outDir, `${label}.${ext}`);
    writeFileSync(outFile, Buffer.from(res.body, "base64"));
    console.log(`[${label}] binary body (${Buffer.byteLength(res.body, "base64")} bytes) -> ${outFile}`);
    if (process.platform === "darwin") console.log(`[${label}] open it:  open ${outFile}`);
  } else {
    // Text/JSON body: pretty-print when it parses as JSON, otherwise print raw.
    try {
      console.log(JSON.stringify(JSON.parse(res.body), null, 2));
    } catch {
      console.log(res.body);
    }
  }
  return res;
}

/**
 * Convenience for handlers that read `queryStringParameters`. Builds a GET event.
 * Values are coerced to strings (that's how a real Function URL delivers them).
 */
export function getEvent(query: Record<string, string | number | boolean>): FunctionUrlEvent {
  const queryStringParameters: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) queryStringParameters[k] = String(v);
  return { requestContext: { http: { method: "GET" } }, queryStringParameters };
}

/**
 * Convenience for handlers that read a JSON POST `body`. Serializes `payload` to the body
 * exactly as a Function URL client would send it (plain UTF-8 text, not base64).
 */
export function postEvent(payload: unknown): FunctionUrlEvent {
  return {
    requestContext: { http: { method: "POST" } },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  };
}
