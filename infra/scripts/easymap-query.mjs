// 本機小工具：直接在本機跑 land-easymap 的 handler 查一筆地號，把 response body 印到 stdout。
//
// 用途：部署在 us-west-2 的 ntpc-land-easymap 打台灣的 easymap.moi.gov.tw 常常在預設的
// EASYMAP_TIMEOUT_MS=8000 內回不來（實測 502 `upstream timeout after 8000ms`）。從台灣的網路
// 本機跑同一支 handler 就過得去，所以 E2E 手冊的「查地號」那步需要一個不經 Function URL 的退路。
// 這支只是把 lambda/land-easymap/lambda.ts 的 handler 包成 CLI，邏輯完全沒有第二份。
//
// 用法（在 infra/ 下，或用 npm --prefix infra run easymap）：
//   node --import ./scripts/register-ts.mjs scripts/easymap-query.mjs <行政區> <段名> <地號> [縣市]
// 範例：
//   node --import ./scripts/register-ts.mjs scripts/easymap-query.mjs 金山區 金美段 489 > ../e2e-out/L1_base_parcel.json
//
// 逾時預設放寬到 20s（上游從境外連線很慢）；要更長就自己帶 EASYMAP_TIMEOUT_MS=30000。
// 查無資料（404）/ 上游壞掉（502）會把 body 照印並以非 0 結束，方便 shell 用 && 串下一步。

// 預設值要在 import handler 之前設好 —— easymap.ts 是在 module scope 讀 EASYMAP_TIMEOUT_MS 的。
process.env.EASYMAP_TIMEOUT_MS ??= "20000";

const { handler } = await import("../lambda/land-easymap/lambda.ts");

const [district, section, lid, county] = process.argv.slice(2);
if (!district || !section || !lid) {
  console.error(
    "用法：node --import ./scripts/register-ts.mjs scripts/easymap-query.mjs <行政區> <段名> <地號> [縣市]",
  );
  process.exit(1);
}

const res = await handler({
  requestContext: { http: { method: "GET" } },
  queryStringParameters: { district, section, lid, ...(county ? { county } : {}) },
});

// body 一律是 JSON（成功與錯誤都是），原樣重排印出，讓呼叫端可以直接 > 檔案再餵 jq。
process.stdout.write(JSON.stringify(JSON.parse(res.body), null, 2) + "\n");
if (res.statusCode !== 200) {
  console.error(`[easymap-query] HTTP ${res.statusCode}`);
  process.exit(1);
}
