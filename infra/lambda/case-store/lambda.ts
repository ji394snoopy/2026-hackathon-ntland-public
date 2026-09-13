// case-store — 案件狀態儲存 CRUD (流程 B/D/F 的「存定稿 / 讀回」).
//
// The first consumer of the shared DB access layer (../shared/db, Drizzle over the RDS
// Data API). It only stores and retrieves user-finalized forms; it does NOT compute
// anything (that's produce/*, a later task). Routing on a Function URL:
//
//   POST                       -> create a case ({ sectionId, meta? }) -> { caseId, ... }
//   PATCH ?caseId=             -> patch a case's sectionId / meta -> CaseSummary
//   PUT|POST ?form=survey            -> upsert 表3 定稿 ({ caseId, survey, benchmark })
//   PUT|POST ?form=regional-factors  -> upsert 表5 定稿 ({ caseId, regionalFactors, regionalTotal, remarks })
//   PUT|POST ?form=comparison        -> upsert 表4 定稿 ({ caseId, comparison, comparisonForm, computed })
//   PUT|POST ?form=comparison-survey -> upsert 一份比較標的表3 ({ caseId, targetIndex, survey, benchmark })
//   GET                        -> list every case (lightweight metadata, newest first)
//   GET  ?caseId=              -> get one case bundle (each form present only if stored)
//   GET  ?sectionId=           -> list a section's cases (lightweight metadata)
//   GET  ?form=<t>&caseId=     -> read one 定稿 on its own (404 if never stored)
//
// 兩個刻意的缺口(demo 範圍):沒有任何 delete 路由;PATCH 也不碰 `status` —— 案件狀態
// 仍然只由下面的 定稿 寫入連動(draft -> survey_done -> regional_done -> comparison_done)。
//
// 表1(survey)不分宗地與比較標的:同一份格式、同一張 case_survey、同一套驗證,由
// (role, targetIndex) 決定它在本案裡扮演什麼 —— ?form=survey 寫 role='benchmark'、
// ?form=comparison-survey 寫 role='comparison'。
//
// 兩者都可帶選填的**宗地身分**(district / section / sectno / parcelNo / lat+lng / areaM2),
// 對齊前端的定位流程:輸入 行政區+段+地號 → land-easymap 查出經緯度與面積 → 存表1 時一起
// 帶上。定位要三個一起(地號在同一行政區內不唯一),lat/lng 則要嘛成對給、要嘛都不給。
// 合表 migration 見 infra/README.md「case_survey 合表 + 宗地身分欄」。
//
// All DB access goes through the shared layer's type-safe Drizzle handle. Writes are
// single-statement upserts (INSERT ... ON CONFLICT) — no transactions, per the Data API
// limitation noted in db-access-layer-plan.md §2.2.

import { and, asc, eq, sql } from "drizzle-orm";
import {
  appraisalCase,
  caseComparison,
  caseRegionalFactors,
  caseSurvey,
  getDb,
  newCaseId,
  toCaseBundle,
  toCaseSummary,
  toComparisonFinal,
  toComparisonSurveyFinal,
  toRegionalFactorsFinal,
  toSurveyFinal,
  type AppraisalCaseInsert,
  type CaseSurveyRow,
  type CaseMeta,
  type ComparisonCondition,
  type ComparisonForm,
  type ComputedSummary,
  type FactorRow,
  type RegionalFactorRemarks,
  type RegionalFactorRow,
  type SurveyField,
} from "../shared/db";

// Lambda Function URL event/response (subset), same shape as the other infra handlers.
interface FunctionUrlEvent {
  requestContext?: { http?: { method?: string } };
  queryStringParameters?: Record<string, string | undefined> | null;
  body?: string | null;
  isBase64Encoded?: boolean;
}

interface JsonResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

// CORS 交給 Function URL 原生設定(CDK 的 FunctionUrl cors 屬性,allowedOrigins ["*"]),
// 這裡不要再手動加 access-control-allow-origin,否則帶 Origin 的請求會出現兩個
// Access-Control-Allow-Origin header,瀏覽器判定 CORS 失敗。
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

function json(statusCode: number, payload: unknown): JsonResponse {
  return {
    statusCode,
    headers: { ...JSON_HEADERS },
    body: JSON.stringify(payload),
  };
}

class BadRequestError extends Error {}
class NotFoundError extends Error {}

// Parses the request body as a JSON object (base64-decoding first if flagged). Used by the
// POST/PUT write paths; GET carries no body.
function readBody(event: FunctionUrlEvent): Record<string, unknown> {
  if (!event.body) throw new BadRequestError("A JSON body is required.");
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestError("Request body is not valid JSON.");
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  throw new BadRequestError("Request body must be a JSON object.");
}

function query(event: FunctionUrlEvent): Record<string, string | undefined> {
  return event.queryStringParameters ?? {};
}

function requireCaseId(body: Record<string, unknown>): string {
  const caseId = body.caseId;
  if (typeof caseId !== "string" || caseId.length === 0) {
    throw new BadRequestError("caseId (non-empty string) is required.");
  }
  return caseId;
}

// Same check against ?caseId= (the read/patch routes key off the query string, not the body).
function requireQueryCaseId(event: FunctionUrlEvent, route: string): string {
  const caseId = query(event).caseId;
  if (caseId == null || caseId === "") {
    throw new BadRequestError(`${route} requires ?caseId=.`);
  }
  return caseId;
}

// ?targetIndex= arrives as a string on a Function URL; reject anything that isn't a
// non-negative integer instead of silently querying for NaN. Absent -> undefined (list all).
function parseTargetIndex(raw: string | undefined): number | undefined {
  if (raw == null || raw === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestError("targetIndex must be a non-negative integer.");
  }
  return parsed;
}

// Asserts a case exists; upserting a 定稿 for an unknown caseId would otherwise fail with a
// raw FK error. Cheap existence check keeps the error surface clean (404 vs 502).
async function assertCaseExists(caseId: string): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ caseId: appraisalCase.caseId })
    .from(appraisalCase)
    .where(eq(appraisalCase.caseId, caseId));
  if (rows.length === 0)
    throw new NotFoundError(`No case with caseId=${caseId}.`);
}

// Bumps the parent case's status + updated_at after a 定稿 write. Single statement.
async function touchCaseStatus(caseId: string, status: string): Promise<void> {
  const db = getDb();
  await db
    .update(appraisalCase)
    .set({ status, updatedAt: new Date() })
    .where(eq(appraisalCase.caseId, caseId));
}

// --- POST / (no ?form) : create a case ----------------------------------------------
async function handleCreateCase(
  event: FunctionUrlEvent,
): Promise<JsonResponse> {
  const body = readBody(event);
  const sectionId = body.sectionId;
  if (typeof sectionId !== "string" || sectionId.length === 0) {
    return json(400, { error: "sectionId (non-empty string) is required." });
  }
  const meta = (body.meta ?? null) as CaseMeta | null;

  const db = getDb();
  const caseId = newCaseId();
  const [row] = await db
    .insert(appraisalCase)
    .values({ caseId, sectionId, meta, status: "draft" })
    .returning();
  return json(201, toCaseSummary(row));
}

// --- PATCH ?caseId= : patch a case's sectionId / meta --------------------------------
// Only keys actually present in the body are written, so `{ "meta": null }` clears meta
// while an absent `meta` leaves it untouched — an estimator editing 段號 must not wipe the
// meta that Bp filled in. `status` is deliberately not patchable (see header).
async function handlePatchCase(event: FunctionUrlEvent): Promise<JsonResponse> {
  const caseId = requireQueryCaseId(event, "PATCH");
  const body = readBody(event);

  const patch: Partial<AppraisalCaseInsert> = {};
  if ("sectionId" in body) {
    if (typeof body.sectionId !== "string" || body.sectionId.length === 0) {
      throw new BadRequestError("sectionId must be a non-empty string.");
    }
    patch.sectionId = body.sectionId;
  }
  if ("meta" in body) {
    const meta = body.meta;
    if (meta != null && (typeof meta !== "object" || Array.isArray(meta))) {
      throw new BadRequestError("meta must be an object or null.");
    }
    patch.meta = (meta ?? null) as CaseMeta | null;
  }
  if (Object.keys(patch).length === 0) {
    throw new BadRequestError(
      "Nothing to patch. Send sectionId and/or meta (status is not patchable).",
    );
  }

  const db = getDb();
  const [row] = await db
    .update(appraisalCase)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(appraisalCase.caseId, caseId))
    .returning();
  // No row back means the caseId doesn't exist — 404 rather than a silent 200 no-op.
  if (!row) throw new NotFoundError(`No case with caseId=${caseId}.`);
  return json(200, toCaseSummary(row));
}

// 表1 的兩個角色。表1 本身格式一致,是**案件**決定這份勘查扮演什麼(見 schema.ts)。
const ROLE_BENCHMARK = "benchmark";
const ROLE_COMPARISON = "comparison";
// 比準地一案一份,不需要序號;固定 0 以滿足複合主鍵。
const BENCHMARK_TARGET_INDEX = 0;

// 一份表1 的共同必填內容(宗地/比較標的都走這裡 —— 格式一致就只該有一套驗證)。
function readSurveyPayload(body: Record<string, unknown>): {
  survey: SurveyField[];
  benchmark: ComparisonCondition;
} {
  const survey = body.survey as SurveyField[] | undefined;
  const benchmark = body.benchmark as ComparisonCondition | undefined;
  if (!Array.isArray(survey))
    throw new BadRequestError("survey (array) is required.");
  if (!benchmark || typeof benchmark !== "object") {
    throw new BadRequestError("benchmark (object) is required.");
  }
  return { survey, benchmark };
}

// 宗地身分 —— 前端定位流程(輸入 district+section+地號 → land-easymap 查 center/areaM2)
// 的產物,存表1 時一起帶上。
//
// 全選填:定位失敗的標的仍要能存表1,所以缺了就寫 null,不是 400。給了就驗 —— 寧可擋下
// 也不要存進一組會讓空間查詢/面積比較無聲算錯的垃圾值。
function readParcelIdentity(body: Record<string, unknown>): {
  district: string | null;
  section: string | null;
  sectno: string | null;
  parcelNo: string | null;
  lat: number | null;
  lng: number | null;
  areaM2: number | null;
} {
  const str = (key: string): string | null => {
    const v = body[key];
    if (v == null || v === "") return null;
    if (typeof v !== "string") {
      throw new BadRequestError(`${key}, if present, must be a string.`);
    }
    return v;
  };
  const num = (
    key: string,
    check: (n: number) => boolean,
    expectation: string,
  ): number | null => {
    const v = body[key];
    if (v == null || v === "") return null;
    if (typeof v !== "number" || !Number.isFinite(v) || !check(v)) {
      throw new BadRequestError(`${key}, if present, must be ${expectation}.`);
    }
    return v;
  };
  const lat = num("lat", (n) => Math.abs(n) <= 90, "a number within ±90");
  const lng = num("lng", (n) => Math.abs(n) <= 180, "a number within ±180");
  // 半組座標定不出點,generated 的 centroid 也會是 null —— 與其默默存成廢資料,不如擋下。
  if ((lat == null) !== (lng == null)) {
    throw new BadRequestError("lat and lng must be given together.");
  }
  return {
    district: str("district"),
    section: str("section"),
    sectno: str("sectno"),
    parcelNo: str("parcelNo"),
    lat,
    lng,
    areaM2: num("areaM2", (n) => n > 0, "a positive number (m²)"),
  };
}

// 表1 upsert 的共同寫入路徑。role/targetIndex 由呼叫端決定,其餘完全一致。
async function upsertSurveyRow(
  caseId: string,
  role: string,
  targetIndex: number,
  body: Record<string, unknown>,
): Promise<void> {
  const { survey, benchmark } = readSurveyPayload(body);
  const parcel = readParcelIdentity(body);
  await assertCaseExists(caseId);

  const db = getDb();
  const now = new Date();
  await db
    .insert(caseSurvey)
    .values({ caseId, role, targetIndex, survey, benchmark, ...parcel, updatedAt: now })
    .onConflictDoUpdate({
      target: [caseSurvey.caseId, caseSurvey.role, caseSurvey.targetIndex],
      set: { survey, benchmark, ...parcel, updatedAt: now },
    });
}

// 取本案比準地那一份表1。合表後 case_survey 一案有多列,拿比準地一定要帶 role —— 少了
// 這個條件會隨機拿到某個比較標的的表1,而且不會報錯。
async function findBenchmarkSurvey(
  caseId: string,
): Promise<CaseSurveyRow | undefined> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(caseSurvey)
    .where(
      and(eq(caseSurvey.caseId, caseId), eq(caseSurvey.role, ROLE_BENCHMARK)),
    );
  return row;
}

// --- PUT|POST ?form=survey : upsert 比準地(宗地)的表1 定稿 ---------------------------
async function handleSaveSurvey(
  event: FunctionUrlEvent,
): Promise<JsonResponse> {
  const body = readBody(event);
  const caseId = requireCaseId(body);
  await upsertSurveyRow(caseId, ROLE_BENCHMARK, BENCHMARK_TARGET_INDEX, body);
  await touchCaseStatus(caseId, "survey_done");
  return json(200, { caseId, form: "survey", status: "survey_done" });
}

// --- PUT|POST ?form=comparison-survey : upsert 一份比較標的的表1 定稿 -----------------
// body: { caseId, targetIndex, survey, benchmark, parcelNo?, district?, lat?, lng? }.
// 與 ?form=survey 同一份格式,只差 role 與 targetIndex。
async function handleSaveComparisonSurvey(
  event: FunctionUrlEvent,
): Promise<JsonResponse> {
  const body = readBody(event);
  const caseId = requireCaseId(body);
  const targetIndex = body.targetIndex;
  if (
    typeof targetIndex !== "number" ||
    !Number.isInteger(targetIndex) ||
    targetIndex < 0
  ) {
    throw new BadRequestError(
      "targetIndex (non-negative integer) is required.",
    );
  }
  await upsertSurveyRow(caseId, ROLE_COMPARISON, targetIndex, body);
  return json(200, { caseId, form: "comparison-survey", targetIndex });
}

// --- GET ?form=comparison-survey&caseId=[&targetIndex=] -------------------------------
// Without ?targetIndex= this lists the case's comparison-target surveys; with it, the one
// target's 定稿 is returned on its own (the 比較標的 editor loads one target at a time).
async function handleGetComparisonSurveys(
  caseId: string,
  targetIndex?: number,
): Promise<JsonResponse> {
  const db = getDb();
  const base = and(
    eq(caseSurvey.caseId, caseId),
    eq(caseSurvey.role, ROLE_COMPARISON),
  );
  const rows = await db
    .select()
    .from(caseSurvey)
    .where(
      targetIndex == null
        ? base
        : and(base, eq(caseSurvey.targetIndex, targetIndex)),
    )
    .orderBy(asc(caseSurvey.targetIndex));

  if (targetIndex == null) {
    return json(200, {
      caseId,
      comparisonSurveys: rows.map(toComparisonSurveyFinal),
    });
  }
  const [row] = rows;
  if (!row) {
    throw new NotFoundError(
      `No comparison-survey 定稿 for caseId=${caseId}, targetIndex=${targetIndex}.`,
    );
  }
  return json(200, { caseId, ...toComparisonSurveyFinal(row) });
}

// --- GET ?form=survey|regional-factors|comparison&caseId= : one 定稿 on its own --------
// GET ?caseId= already returns all three inside the bundle; these point-lookups exist for
// the per-表 editor screens, which would otherwise pull the other two 定稿 over the wire on
// every load. Absent 定稿 is a 404 here (in the bundle it's just a missing key).
async function handleGetSurveyFinal(caseId: string): Promise<JsonResponse> {
  const row = await findBenchmarkSurvey(caseId);
  if (!row) throw new NotFoundError(`No survey 定稿 for caseId=${caseId}.`);
  return json(200, toSurveyFinal(row));
}

async function handleGetRegionalFactorsFinal(
  caseId: string,
): Promise<JsonResponse> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(caseRegionalFactors)
    .where(eq(caseRegionalFactors.caseId, caseId));
  if (!row) {
    throw new NotFoundError(`No regional-factors 定稿 for caseId=${caseId}.`);
  }
  return json(200, toRegionalFactorsFinal(row));
}

async function handleGetComparisonFinal(caseId: string): Promise<JsonResponse> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(caseComparison)
    .where(eq(caseComparison.caseId, caseId));
  if (!row) throw new NotFoundError(`No comparison 定稿 for caseId=${caseId}.`);
  return json(200, toComparisonFinal(row));
}

// --- PUT|POST ?form=regional-factors : upsert 表5 定稿 -------------------------------
async function handleSaveRegionalFactors(
  event: FunctionUrlEvent,
): Promise<JsonResponse> {
  const body = readBody(event);
  const caseId = requireCaseId(body);
  const regionalFactors = body.regionalFactors as
    | RegionalFactorRow[]
    | undefined;
  if (!Array.isArray(regionalFactors)) {
    throw new BadRequestError("regionalFactors (array) is required.");
  }
  const remarks = (body.remarks ?? null) as RegionalFactorRemarks | null;
  // regional_total is a numeric column stored as text; accept a number or numeric string.
  const regionalTotal =
    body.regionalTotal == null ? null : String(body.regionalTotal);
  await assertCaseExists(caseId);

  const db = getDb();
  const now = new Date();
  await db
    .insert(caseRegionalFactors)
    .values({ caseId, regionalFactors, regionalTotal, remarks, updatedAt: now })
    .onConflictDoUpdate({
      target: caseRegionalFactors.caseId,
      set: { regionalFactors, regionalTotal, remarks, updatedAt: now },
    });
  await touchCaseStatus(caseId, "regional_done");
  return json(200, {
    caseId,
    form: "regional-factors",
    status: "regional_done",
  });
}

// --- PUT|POST ?form=comparison : upsert 表4 定稿 -------------------------------------
async function handleSaveComparison(
  event: FunctionUrlEvent,
): Promise<JsonResponse> {
  const body = readBody(event);
  const caseId = requireCaseId(body);
  const comparison = body.comparison as FactorRow[] | undefined;
  const comparisonForm = body.comparisonForm as ComparisonForm | undefined;
  if (!Array.isArray(comparison)) {
    throw new BadRequestError("comparison (array) is required.");
  }
  if (!comparisonForm || typeof comparisonForm !== "object") {
    throw new BadRequestError("comparisonForm (object) is required.");
  }
  const computed = (body.computed ?? null) as ComputedSummary | null;
  await assertCaseExists(caseId);

  const db = getDb();
  const now = new Date();
  await db
    .insert(caseComparison)
    .values({ caseId, comparison, comparisonForm, computed, updatedAt: now })
    .onConflictDoUpdate({
      target: caseComparison.caseId,
      set: { comparison, comparisonForm, computed, updatedAt: now },
    });
  await touchCaseStatus(caseId, "comparison_done");
  return json(200, { caseId, form: "comparison", status: "comparison_done" });
}

// --- GET ?caseId= : full case bundle -------------------------------------------------
async function handleGetCase(caseId: string): Promise<JsonResponse> {
  const db = getDb();
  const [base] = await db
    .select()
    .from(appraisalCase)
    .where(eq(appraisalCase.caseId, caseId));
  if (!base) throw new NotFoundError(`No case with caseId=${caseId}.`);

  // Three small point-lookups on the primary key — cheaper and simpler than a 4-way join,
  // and each 定稿 is optional. surveyFinal 是**比準地**那一份;比較標的的表1 同表不同 role,
  // 不進 bundle(數量不定),走 GET ?form=comparison-survey 拿。
  const survey = await findBenchmarkSurvey(caseId);
  const [regional] = await db
    .select()
    .from(caseRegionalFactors)
    .where(eq(caseRegionalFactors.caseId, caseId));
  const [comparison] = await db
    .select()
    .from(caseComparison)
    .where(eq(caseComparison.caseId, caseId));

  return json(200, toCaseBundle(base, { survey, regional, comparison }));
}

// --- GET ?sectionId= : list a section's cases ----------------------------------------
async function handleListBySection(sectionId: string): Promise<JsonResponse> {
  const db = getDb();
  const rows = await db
    .select()
    .from(appraisalCase)
    .where(eq(appraisalCase.sectionId, sectionId))
    .orderBy(sql`${appraisalCase.createdAt} desc`);
  return json(200, rows.map(toCaseSummary));
}

// --- GET (no query) : list every case -------------------------------------------------
// Unpaged on purpose: the demo dataset is a handful of cases, and a cursor/offset contract
// the frontend doesn't need yet would just be dead surface. Revisit if 案件數 grows.
async function handleListAll(): Promise<JsonResponse> {
  const db = getDb();
  const rows = await db
    .select()
    .from(appraisalCase)
    .orderBy(sql`${appraisalCase.createdAt} desc`);
  return json(200, rows.map(toCaseSummary));
}

// Read routing: ?form= reads a single 定稿, else ?caseId= / ?sectionId= / nothing at all.
async function handleGet(event: FunctionUrlEvent): Promise<JsonResponse> {
  const q = query(event);
  if (q.form != null && q.form !== "") {
    const caseId = requireQueryCaseId(event, `GET ?form=${q.form}`);
    switch (q.form) {
      case "survey":
        return handleGetSurveyFinal(caseId);
      case "regional-factors":
        return handleGetRegionalFactorsFinal(caseId);
      case "comparison":
        return handleGetComparisonFinal(caseId);
      case "comparison-survey":
        return handleGetComparisonSurveys(
          caseId,
          parseTargetIndex(q.targetIndex),
        );
      default:
        throw new BadRequestError(
          `Unknown ?form=${q.form}. Use survey | comparison-survey | regional-factors | comparison.`,
        );
    }
  }
  if (q.caseId != null && q.caseId !== "") return handleGetCase(q.caseId);
  if (q.sectionId != null && q.sectionId !== "")
    return handleListBySection(q.sectionId);
  return handleListAll();
}

// Write routing: ?form= picks the 定稿 table; absence means "create a case".
async function handleWrite(event: FunctionUrlEvent): Promise<JsonResponse> {
  const form = query(event).form;
  switch (form) {
    case undefined:
    case "":
      return handleCreateCase(event);
    case "survey":
      return handleSaveSurvey(event);
    case "comparison-survey":
      return handleSaveComparisonSurvey(event);
    case "regional-factors":
      return handleSaveRegionalFactors(event);
    case "comparison":
      return handleSaveComparison(event);
    default:
      throw new BadRequestError(
        `Unknown ?form=${form}. Use survey | comparison-survey | regional-factors | comparison, or omit to create a case.`,
      );
  }
}

/**
 * case-store CRUD handler.
 *
 * Stores/retrieves user-finalized 三表 (survey / regional-factors / comparison) keyed by a
 * self-minted caseId (副鍵 sectionId). Backed by the shared Drizzle-over-Data-API layer.
 * Not a produce/* endpoint — it persists finals, it doesn't compute them.
 */
export async function handler(event: FunctionUrlEvent): Promise<JsonResponse> {
  const method = event.requestContext?.http?.method ?? "GET";
  try {
    if (method === "OPTIONS") return json(204, {});
    if (method === "GET") return await handleGet(event);
    if (method === "PATCH") return await handlePatchCase(event);
    if (method === "POST" || method === "PUT") return await handleWrite(event);
    return json(405, { error: `Method ${method} not allowed.` });
  } catch (err) {
    if (err instanceof BadRequestError)
      return json(400, { error: err.message });
    if (err instanceof NotFoundError) return json(404, { error: err.message });
    const message = err instanceof Error ? err.message : String(err);
    return json(502, { error: `case-store failed: ${message}` });
  }
}
