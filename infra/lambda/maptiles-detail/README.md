# maptiles-detail (ref)

> **這是一個 ref,不是原始碼。** handler 邏輯的唯一來源在 cli,會持續更新。infra
> 只在部署前由 `npm run build:lambdas` 從下方來源打包,產出自帶依賴的 bundle。

| 項目 | 值 |
|------|-----|
| function name | `ntpc-maptiles-detail` |
| handler 原始碼 | `../cli/src/mapTiles/detailTopo/lambda.ts`(相對 infra/) |
| bundle 輸出 | `infra/build/lambda/maptiles-detail/index.mjs` |
| CDK construct | `MapTilesDetailFn`(`lib/lambda-stack.ts`) |
| Function URL 輸出 | `DetailTopoFunctionUrl`(CfnOutput) |
| 回應型別 | PNG(base64 + isBase64Encoded) |

NLSC TOPO01K 1/1000 新北市都市計畫地形圖。先抓 GetCapabilities(413 圖層)篩出新北市
~56 個 sheet,解析結果快取在 module scope,warm 執行環境不重抓。

```bash
curl "<DetailTopoFunctionUrl>?lon=121.4627&lat=25.0111" -o detail.png
```

可選 query:`zoom`(0–19,預設 15)、`radius`(0–4,預設 0)、`pin`、`emap`。

清單來源見 `infra/lambda/lambdas.json`;總覽見 `infra/lambda/README.md`。
