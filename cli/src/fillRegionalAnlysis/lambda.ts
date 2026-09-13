import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { FONT_SIZE, planDraws, renderDraws } from "./fillEngine.js";
import { PURPOSES } from "./generateCoordinates.js";
import type { Purpose } from "./generateCoordinates.js";

// Bundled assets, inlined by esbuild at build time (see infra/scripts/build-lambdas.mjs
// loaders), exactly like fillDistrictSurvey/lambda.ts: the 5 per-用地 template PDFs and
// the Chinese font are `binary` (-> Uint8Array), the 5 per-用地 coordinates trees are
// `json` (-> object). Inlining them sidesteps Lambda asset-path resolution entirely —
// everything the handler needs is in the single bundled index.mjs, so there is no
// readFileSync / cwd / __dirname dependency and no separate file to ship.
//
// This handler wraps fillRegionalAnlysis WITHOUT changing its CLI logic: it reuses the
// same fillEngine (planDraws/renderDraws) and the same PURPOSES vocabulary as main.ts,
// only swapping the CLI's readFileSync(input/…) for these build-time inlines and its
// process.argv purpose for a request field. Table 5 (區域因素分析明細表).
//
// @ts-expect-error — esbuild binary loader, no .d.ts
import fontBytes from "../../assets/ARPLUKaiTW-Book.ttf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import templateAgricultural from "./input/regional-anlysis-agricultural.pdf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import templateCommercial from "./input/regional-anlysis-commercial.pdf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import templateIndustrial from "./input/regional-anlysis-industrial.pdf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import templateOther from "./input/regional-anlysis-other.pdf";
// @ts-expect-error — esbuild binary loader, no .d.ts
import templateResidential from "./input/regional-anlysis-residential.pdf";
import coordinatesAgricultural from "./input/coordinates-agricultural.json" with { type: "json" };
import coordinatesCommercial from "./input/coordinates-commercial.json" with { type: "json" };
import coordinatesIndustrial from "./input/coordinates-industrial.json" with { type: "json" };
import coordinatesOther from "./input/coordinates-other.json" with { type: "json" };
import coordinatesResidential from "./input/coordinates-residential.json" with { type: "json" };

// Purpose -> its inlined template + coordinates. Same 5-way split main.ts does by reading
// input/regional-anlysis-<purpose>.pdf / coordinates-<purpose>.json off disk.
const ASSETS: Record<Purpose, { template: Uint8Array; coordinates: unknown }> = {
  agricultural: { template: templateAgricultural as Uint8Array, coordinates: coordinatesAgricultural },
  commercial: { template: templateCommercial as Uint8Array, coordinates: coordinatesCommercial },
  industrial: { template: templateIndustrial as Uint8Array, coordinates: coordinatesIndustrial },
  other: { template: templateOther as Uint8Array, coordinates: coordinatesOther },
  residential: { template: templateResidential as Uint8Array, coordinates: coordinatesResidential },
};

// AWS Lambda Function URL event/response shapes (subset). Inline so the handler carries
// no aws-lambda type dependency to bundle. Same shape as fillDistrictSurvey/lambda.ts.
interface FunctionUrlEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  queryStringParameters?: Record<string, string | undefined> | null;
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

function isPurpose(value: unknown): value is Purpose {
  return typeof value === "string" && (PURPOSES as readonly string[]).includes(value);
}

interface ParsedRequest {
  purpose: Purpose;
  content: Record<string, any>;
}

// Parse the request into { purpose, content }. purpose comes from the body's `purpose`
// field or the ?purpose= query param (one of PURPOSES); content is the fillEngine content
// tree, accepted as the bare tree, { content }, or { content, purpose }. A Function URL
// POST body may be base64-encoded (isBase64Encoded).
function parseRequest(event: FunctionUrlEvent): ParsedRequest {
  const raw = event.body;
  const text = raw ? (event.isBase64Encoded ? Buffer.from(raw, "base64").toString("utf-8") : raw) : "";
  const trimmed = text.trim();

  let parsed: any = undefined;
  if (trimmed) parsed = JSON.parse(trimmed);

  const purposeFromQuery = event.queryStringParameters?.purpose;
  const purposeFromBody = parsed && typeof parsed === "object" ? parsed.purpose : undefined;
  const purpose = purposeFromBody ?? purposeFromQuery;
  if (!isPurpose(purpose)) {
    throw new BadRequestError(
      `purpose (one of ${PURPOSES.join(", ")}) is required (in body or ?purpose=), got ${purpose ?? "none"}.`,
    );
  }

  // Content tree: bare tree, or wrapped in { content }. If the body is only { purpose },
  // there's nothing to draw -> empty content (blank template), matching fillDistrictSurvey.
  let content: Record<string, any> = {};
  if (parsed && typeof parsed === "object") {
    if (parsed.content && typeof parsed.content === "object") {
      content = parsed.content;
    } else {
      const { purpose: _omit, ...rest } = parsed;
      content = rest;
    }
  }
  return { purpose, content };
}

class BadRequestError extends Error {}

/**
 * fillRegionalAnlysis as a Lambda Function URL handler (表5 區域因素分析明細表).
 *
 * POST (JSON body = { purpose, ...content } or { purpose, content } — purpose one of
 * agricultural/commercial/industrial/other/residential) -> a filled 表5 PDF for that
 * 用地類別, returned as base64 (isBase64Encoded). Pure pdf-lib, no Bedrock / AWS / DB. The
 * 5 templates + 5 coordinates + font are inlined at build time. Invalid JSON or a bad
 * purpose is a 400; anything else is a 500. CLI logic (main.ts/fillEngine.ts) unchanged.
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

  let request: ParsedRequest;
  try {
    request = parseRequest(event);
  } catch (err) {
    if (err instanceof BadRequestError) return errorResponse(400, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(400, `Invalid JSON body: ${message}`);
  }

  try {
    const { template, coordinates } = ASSETS[request.purpose];
    const pdfDoc = await PDFDocument.load(template);
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fontBytes as Uint8Array, { subset: false });
    const page = pdfDoc.getPages()[0]!;

    const measureText = (text: string) => font.widthOfTextAtSize(text, FONT_SIZE);
    const instructions = planDraws(request.content, coordinates, measureText);
    renderDraws(page, font, instructions);

    const outBytes = await pdfDoc.save();
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/pdf",
        "access-control-allow-origin": "*",
        "content-disposition": `inline; filename="regional-analysis-${request.purpose}-filled.pdf"`,
      },
      body: Buffer.from(outBytes).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(500, message);
  }
}
