export const CLAUDE_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
export const AWS_REGION = "us-west-2";
export const CLAUDE_MAX_TOKENS = 128_000;
// Well under the Bedrock SDK's 10-minute default — fails fast on a stuck connection
// instead of hanging, paired with withClaudeRetry() (src/shared/retry.ts) retrying
// the whole call on a timeout.
export const CLAUDE_TIMEOUT_MS = 300_000;
