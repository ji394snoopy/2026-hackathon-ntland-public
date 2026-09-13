// The Anthropic SDK's MessageStream accumulates a tool_use block's streamed JSON into a hidden,
// non-enumerable `__json_buf` property and replaces `.input` with a lazily-parsed getter over
// that buffer (see @anthropic-ai/sdk's src/internal/message-stream-utils.ts). When a call is cut
// short by max_tokens, that buffer is often unparseable and `.input` falls back to `{}` — losing
// the only evidence of what the model actually generated before truncation. This reads the raw
// buffer back out for diagnostic logging only; it's an SDK implementation detail, not a
// documented API, so callers must treat a missing/undefined result as "no extra diagnostics
// available" rather than an error.
const RAW_JSON_BUFFER_PROPERTY = "__json_buf";

function rawToolInputBuffer(block: unknown): string | undefined {
  if (!block || typeof block !== "object") return undefined;
  const raw = (block as Record<string, unknown>)[RAW_JSON_BUFFER_PROPERTY];
  return typeof raw === "string" ? raw : undefined;
}

export { rawToolInputBuffer };
