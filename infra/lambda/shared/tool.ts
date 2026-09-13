import { readFileSync } from "node:fs";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: unknown;
  strict?: boolean;
}

export interface CategoryMapping {
  regional: Record<string, string>;
  individual: Record<string, string>;
}

interface ContentBlock {
  type: string;
  name?: string;
  input?: unknown;
}

function extractResult(responseBody: unknown, toolName: string): unknown {
  const content = (responseBody as { content?: ContentBlock[] } | null)
    ?.content;
  if (!Array.isArray(content)) {
    throw new Error(
      `Response body has no content array (expected tool_use for "${toolName}")`,
    );
  }

  const toolUse = content.find(
    (block) => block.type === "tool_use" && block.name === toolName,
  );
  if (!toolUse) {
    throw new Error(
      `No tool_use block found for tool "${toolName}" in response content`,
    );
  }

  return toolUse.input;
}

function readPdfAsBase64(pdfPath: string): string {
  return readFileSync(pdfPath).toString("base64");
}

export { extractResult, readPdfAsBase64 };
