// Local dev runner for produce-survey (= POST /api/produce/survey, 表3 產製 orchestrator).
//
// 這支不自己算:它 HTTP 打兩個上游 Function URL —— facilities(env FACILITIES_URL)+
// district-survey-draft(env DISTRICT_SURVEY_DRAFT_URL,8 類 Bedrock 草稿)。上游缺時 graceful
// 降級(仍回 200,對應欄位標「需人工」),所以本地即使不設 env 也能跑、看降級行為。
//
// 兩種跑法:
//   1) 不設 env(看降級,免任何雲端/憑證):
//        cd infra
//        node --import ./scripts/register-ts.mjs lambda/produce-survey/invoke-local.ts
//
//   2) 打真上游(env 指向已部署的 Function URL,見 local-deploy-steps.txt;draft 走 Bedrock
//      的話上游 lambda 自己需要憑證,本支只是 HTTP 呼叫):
//        FACILITIES_URL="https://<...>.lambda-url.<region>.on.aws/" \
//        DISTRICT_SURVEY_DRAFT_URL="https://<...>.lambda-url.<region>.on.aws/" \
//          node --import ./scripts/register-ts.mjs lambda/produce-survey/invoke-local.ts
//
// Endpoint: POST { sectionId, benchmarkLocation?, sectionPolygon?, facilities? }
// (或 ?sectionId=&lat=&lng=)。回:{ meta, survey: SurveyField[], benchmark }。
// 改座標/區段就改下面 EXAMPLE。
//
// sectionPolygon(區段經緯度陣列)帶了之後,設施查詢的圓心改成這個多邊形的幾何重心,
// 每筆設施同時有 metersToCenter(到區段中心,表5 用)與 metersToPoint(到比準地,表4 用);
// 拿掉它就退回「圓心 = 比準地」的舊行為,items 只有一個距離。兩種都值得跑一次看差異。
//
// facilities 是周邊設施的查詢範圍,半徑標準由呼叫端帶(這支 Lambda 不內建);下面用的是
// 區域因素那一套,與前端 frontend/src/lib/facilityRadiusStandards.ts 同源。

import { postEvent, runLocal } from "../shared/invokeLocal.js";
import { handler } from "./lambda.js";

const EXAMPLE = {
  sectionId: "P002-00",
  benchmarkLocation: { lat: 25.2219, lng: 121.63575 }, // 金山區範例點(= 地點／比準地)
  // 金山老街一帶的示意區段框(順時針);實際由前端地圖圈選。
  sectionPolygon: [
    { lat: 25.2232, lng: 121.6342 },
    { lat: 25.2232, lng: 121.6372 },
    { lat: 25.2206, lng: 121.6372 },
    { lat: 25.2206, lng: 121.6342 },
  ],
  facilities: {
    radius: 600,
    categories: [
      { category: "metro", radius: 2000 }, // 大型車站
      { category: "hsr", radius: 2000 },
      { category: "bus_stop", radius: 800 }, // 站牌
      { category: "motorway_junction", radius: 4000 }, // 交流道
      { category: "education", radius: 1000 }, // 學校
      { category: "market", radius: 1000 }, // 市場
      { category: "park", radius: 1000 }, // 公園、廣場
      { category: "tourism", radius: 2000 }, // 觀光
      { category: "parking", radius: 1000 }, // 停車場
      { category: "medical", radius: 2000 }, // 服務性設施
      { category: "commerce", radius: 2000 },
      { category: "substation", radius: 2000 }, // 電器設施、燃料設施
      { category: "power_tower", radius: 2000 },
      { category: "gas_storage", radius: 2000 },
      { category: "fuel", radius: 2000 },
      { category: "cemetery", radius: 2000 }, // 殯葬
      { category: "crematorium", radius: 2000 },
      { category: "waste", radius: 2000 }, // 廢棄物處理設施
      { category: "wastewater", radius: 2000 }, // 環境污染
    ],
  },
};

await runLocal(handler, postEvent(EXAMPLE), "produce-survey");
