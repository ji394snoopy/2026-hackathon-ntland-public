# infra/lambda — Lambda 清單

站在這裡就能一次看到 **infra 部署了哪些 Lambda**。

- **清單的單一來源**是 [`lambdas.json`](./lambdas.json)。人看它一次列出全部;
  `scripts/build-lambdas.mjs` 也讀它決定要打包哪些 handler,所以「你在這裡看到的清單」
  就是「實際會部署的東西」,不會脫節。
- **邏輯來源**分兩種(見下表 `bundled` 欄):
  - `bundled: false` — 原始碼真的住在 infra(如 `zoning-filter`),infra 專屬、無對應
    CLI,直接 `Code.fromAsset` 上傳。
  - `bundled: true` — 邏輯以 **cli** 為準(會持續更新),infra 這裡只是 ref
    (每個 lambda 一個子資料夾 + `README.md`)。部署前 `npm run build:lambdas` 用
    esbuild 從 cli 打包成自帶依賴的 `build/lambda/<name>/index.mjs`。

## 一覽

| name | function name | bundled | 邏輯來源 | 回應 |
|------|---------------|---------|----------|------|
| [zoning-filter](./zoning-filter/) | `ntpc-zoning-filter` | 否 | `lambda/zoning-filter/index.mjs`(infra) | JSON |
| [wind-condition](./wind-condition/) | `ntpc-wind-condition` | 是 | `../cli/src/windCondition/lambda.ts` | JSON |
| [maptiles-base](./maptiles-base/) | `ntpc-maptiles-base` | 是 | `../cli/src/mapTiles/baseTopo/lambda.ts` | PNG |
| [maptiles-detail](./maptiles-detail/) | `ntpc-maptiles-detail` | 是 | `../cli/src/mapTiles/detailTopo/lambda.ts` | PNG |

CDK 接線(function 設定、Function URL、記憶體/timeout)在 `../lib/lambda-stack.ts`。

## 新增一個 cli handler 到 infra

1. 在 [`lambdas.json`](./lambdas.json) 加一筆(`bundled: true`,填 `source` 指向
   cli 的 `lambda.ts`,相對 infra/)。
2. 在這底下開 `<name>/README.md` 當 ref(照現有那三個的格式)。
3. 在 `../lib/lambda-stack.ts` 依 `WindConditionFn` 的形狀新增一個 construct。
4. `npm run build:lambdas` 會自動把新項目一起打包(它讀 manifest,不用改 build script)。
