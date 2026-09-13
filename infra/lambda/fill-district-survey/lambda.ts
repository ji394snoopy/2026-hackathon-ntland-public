import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { FONT_SIZE, planDraws, renderDraws } from "./fillEngine.js";
import { normalizeDistrictSurveyContent } from "./normalizeContent.js";

// Bundled assets, inlined by esbuild at build time (see infra/scripts/build-lambdas.mjs
// loaders): the template PDF and the Chinese font are `binary` (-> Uint8Array), the
// coordinates tree is `json` (-> object). Inlining them sidesteps Lambda asset-path
// resolution entirely — everything the handler needs is in the single bundled index.mjs,
// so there is no readFileSync / cwd / __dirname dependency and no separate file to ship.
import fontBytes from "../shared/assets/ARPLUKaiTW-Book.ttf";
import coordinates from "./input/coordinates.json" with { type: "json" };
import templatePdfBytes from "./input/district-survey.pdf";

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries
// no aws-lambda type dependency to bundle. This handler accepts POST with a JSON body
// (the content tree) or GET (falls back to the committed sample-data example).
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
// base64-encoded (isBase64Encoded); GET or empty body -> undefined, which makes
// fillDistrictSurvey fall back to nothing to draw (blank template). Callers that want the
// worked example can POST the committed sample-data.json content.
// normalizeDistrictSurveyContent additionally reshapes the flat { meta, survey, benchmark }
// 表1 shape into the content tree, for callers that post that directly (like
// input/sample-data.json) instead of an already-built content tree.
function parseContent(event: FunctionUrlEvent): Record<string, any> | undefined {
  const raw = event.body;
  if (!raw) return undefined;
  const text = event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed);
  // Allow either the bare content tree or { content: {...} }.
  const unwrapped = parsed && typeof parsed === "object" && parsed.content ? parsed.content : parsed;
  return normalizeDistrictSurveyContent(unwrapped);
}

/**
 * fillDistrictSurvey as a Lambda Function URL handler.
 *
 * POST (JSON body = the content tree) -> a filled 表1 地價區段勘查表 PDF, returned as
 * base64 (isBase64Encoded). Pure pdf-lib, no Bedrock / AWS / DB. Coordinates + template +
 * font are inlined at build time. Invalid JSON is a 400; anything else is a 500.
 */
export async function handler(event: FunctionUrlEvent): Promise<LambdaResponse> {
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
    // subset:true — 只嵌入實際用到的字元。ARPLUKaiTW 完整字型十幾 MB,若整份嵌入,PDF + base64
    // 膨脹會超過 Lambda Function URL 6MB response 上限(RequestEntityTooLarge → 對外 502)。
    // subset 後字型降到數十 KB,PDF 遠低於上限。
    const font = await pdfDoc.embedFont(fontBytes as Uint8Array, { subset: true });
    const page = pdfDoc.getPages()[0]!;

    const measureText = (text: string, size: number = FONT_SIZE) => font.widthOfTextAtSize(text, size);
    const instructions = planDraws(content ?? {}, coordinates, measureText);
    renderDraws(page, font, instructions);

    const outBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/pdf",
        "access-control-allow-origin": "*",
        "content-disposition": 'inline; filename="district-survey-filled.pdf"',
      },
      body: Buffer.from(outBytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, message);
  }
}
