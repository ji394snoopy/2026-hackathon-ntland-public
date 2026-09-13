import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { FONT_SIZE, planDraws, renderDraws } from "./fillEngine.js";

// Bundled assets, inlined by esbuild at build time (see infra/scripts/build-lambdas.mjs
// loaders), exactly like fillDistrictSurvey/lambda.ts: the template PDF and the Chinese
// font are `binary` (-> Uint8Array), the coordinates tree is `json` (-> object). Inlining
// them sidesteps Lambda asset-path resolution entirely — everything the handler needs is
// in the single bundled index.mjs, so there is no readFileSync / cwd / __dirname
// dependency and no separate file to ship.
//
// This handler wraps fillindividualAnlysis WITHOUT changing its CLI logic: it reuses the
// same fillEngine (planDraws/renderDraws), only swapping the CLI's readFileSync(input/…)
// for these build-time inlines and its file output for a base64 response. Table 4
// (比較法調查估價表 — 個別因素).
//
// @ts-expect-error — esbuild binary loader, no .d.ts
import templatePdfBytes from "./input/individual-asnlysis.pdf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import fontBytes from "../../assets/ARPLUKaiTW-Book.ttf";
import coordinates from "./input/coordinates.json" with { type: "json" };

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries
// no aws-lambda type dependency to bundle. Same shape as fillDistrictSurvey/lambda.ts.
interface FunctionUrlEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
} as const;

function errorResponse(statusCode: number, message: string): LambdaResponse {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify({ error: message }) };
}

// Parse the request body into the fillEngine content tree. A Function URL POST body may be
// base64-encoded (isBase64Encoded); GET or empty body -> undefined, which makes planDraws
// fall back to nothing to draw (blank template). Accepts the bare content tree or
// { content: {...} }, same as fillDistrictSurvey/lambda.ts.
function parseContent(event: FunctionUrlEvent): Record<string, any> | undefined {
  const raw = event.body;
  if (!raw) return undefined;
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  return parsed && typeof parsed === "object" && parsed.content ? parsed.content : parsed;
}

/**
 * fillindividualAnlysis as a Lambda Function URL handler (表4 比較法調查估價表).
 *
 * POST (JSON body = the content tree) -> a filled 表4 個別因素 PDF, returned as base64
 * (isBase64Encoded). Pure pdf-lib, no Bedrock / AWS / DB. Template + coordinates + font are
 * inlined at build time. Invalid JSON is a 400; anything else is a 500. CLI logic
 * (main.ts/fillEngine.ts) unchanged.
 */
export async function handler(event: FunctionUrlEvent): Promise<LambdaResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  if (method === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      },
      body: "",
    };
  }

  let content: Record<string, any> | undefined;
  try {
    content = parseContent(event);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, `Invalid JSON body: ${message}`);
  }

  try {
    const pdfDoc = await PDFDocument.load(templatePdfBytes as Uint8Array);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes as Uint8Array, { subset: false });
    const page = pdfDoc.getPages()[0]!;

    const measureText = (text: string) => font.widthOfTextAtSize(text, FONT_SIZE);
    const instructions = planDraws(content ?? {}, coordinates, measureText);
    renderDraws(page, font, instructions);

    const outBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/pdf",
        "access-control-allow-origin": "*",
        "content-disposition": 'inline; filename="individual-analysis-filled.pdf"',
      },
      body: Buffer.from(outBytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, message);
  }
}
