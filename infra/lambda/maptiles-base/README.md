# maptiles-base (ref)

> **這是一個 ref,不是原始碼。** handler 邏輯的唯一來源在 cli,會持續更新。infra
> 只在部署前由 `npm run build:lambdas` 從下方來源打包,產出自帶依賴的 bundle。

| 項目 | 值 |
|------|-----|
| function name | `ntpc-maptiles-base` |
| handler 原始碼 | `../cli/src/mapTiles/baseTopo/lambda.ts`(相對 infra/) |
| bundle 輸出 | `infra/build/lambda/maptiles-base/index.mjs` |
| CDK construct | `MapTilesBaseFn`(`lib/lambda-stack.ts`) |
| Function URL 輸出 | `BaseTopoFunctionUrl`(CfnOutput) |
| 回應型別 | PNG(base64 + isBase64Encoded) |

NLSC B5000 1/5000 全國基本地形圖,用 pngjs 在記憶體拼接圖磚回傳 PNG。

```bash
curl "<BaseTopoFunctionUrl>?lon=121.4627&lat=25.0111&radius=1" -o base.png
```

可選 query:`zoom`(0–19,預設 15)、`radius`(0–4,預設 0)、`pin`、`emap`。

清單來源見 `infra/lambda/lambdas.json`;總覽見 `infra/lambda/README.md`。
