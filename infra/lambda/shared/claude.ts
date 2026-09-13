import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrock } from "@anthropic-ai/bedrock-sdk";
import type { ToolDefinition } from "./tool.js";
import { AWS_REGION, CLAUDE_TIMEOUT_MS } from "./constants.js";
import { withClaudeRetry } from "./retry.js";

const client = new AnthropicBedrock({ awsRegion: AWS_REGION, timeout: CLAUDE_TIMEOUT_MS });

interface InvokeParams {
  model: string;
  pdfBase64: string;
  tool: ToolDefinition;
  promptText: string;
  maxTokens: number;
  // Defaults to forcing this exact tool. Pass "any" instead when the call should be free to
  // write reasoning text before the tool_use block (e.g. genuinely comparing against a
  // reference rather than pattern-matching straight into structured output) — forcing a
  // specific tool name pushes the model toward answering immediately with no room to think
  // first, since content that doesn't have to include a text block usually doesn't.
  toolChoice?: "tool" | "any";
}

function buildMessageParams(
  params: InvokeParams,
): Anthropic.MessageStreamParams {
  const { model, pdfBase64, tool, promptText, maxTokens, toolChoice } = params;
  return {
    model,
    max_tokens: maxTokens,
    tools: [tool as Anthropic.Tool],
    tool_choice:
      toolChoice === "any" ? { type: "any" } : { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: promptText },
        ],
      },
    ],
  };
}

async function invoke(params: InvokeParams): Promise<Anthropic.Message> {
  return withClaudeRetry("invoke", async () => {
    const stream = client.messages.stream(buildMessageParams(params));
    return stream.finalMessage();
  });
}

// A prompt split into a static prefix (identical across a batch of calls — e.g.
// fillDistrictSurvey's shared instruction block across its 6 sequential calls) and the
// dynamic remainder. The static half gets a `cache_control` checkpoint so Bedrock can serve
// it from cache on later calls instead of reprocessing it — cached-read tokens don't count
// against the account's TPM quota (see https://aws.amazon.com/tw/about-aws/whats-new/2025/09/
// cache-management-anthropics-claude-models-bedrock/). Only pays off when `static` alone
// clears the model's per-checkpoint minimum token count (1,024 for Claude Sonnet).
interface PromptSections {
  static: string;
  dynamic: string;
}

interface InvokeTextOnlyParams {
  model: string;
  tool: ToolDefinition;
  promptText: string | PromptSections;
  maxTokens: number;
}

function buildTextOnlyMessageParams(
  params: InvokeTextOnlyParams,
): Anthropic.MessageStreamParams {
  const { model, tool, promptText, maxTokens } = params;
  const content: Anthropic.TextBlockParam[] =
    typeof promptText === "string"
      ? [{ type: "text", text: promptText }]
      : [
          {
            type: "text",
            text: promptText.static,
            cache_control: { type: "ephemeral" },
          },
          { type: "text", text: promptText.dynamic },
        ];
  return {
    model,
    max_tokens: maxTokens,
    tools: [tool as Anthropic.Tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content }],
  };
}

async function invokeTextOnly(
  params: InvokeTextOnlyParams,
): Promise<Anthropic.Message> {
  return withClaudeRetry("invokeTextOnly", async () => {
    const stream = client.messages.stream(buildTextOnlyMessageParams(params));
    return stream.finalMessage();
  });
}

export { invoke, invokeTextOnly };
export type { PromptSections };
