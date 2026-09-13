# wind-condition (ref)

> **這是一個 ref,不是原始碼。** handler 邏輯的唯一來源在 cli,會持續更新。infra
> 只在部署前由 `npm run build:lambdas` 從下方來源打包,產出自帶依賴的 bundle。

| 項目 | 值 |
|------|-----|
| function name | `ntpc-wind-condition` |
| handler 原始碼 | `../cli/src/windCondition/lambda.ts`(相對 infra/) |
| bundle 輸出 | `infra/build/lambda/wind-condition/index.mjs` |
| CDK construct | `WindConditionFn`(`lib/lambda-stack.ts`) |
| Function URL 輸出 | `WindFunctionUrl`(CfnOutput) |
| 回應型別 | JSON |

呼叫 Open-Meteo Archive API,回近一年平均日最大風速 + 主風向。

```bash
curl "<WindFunctionUrl>?lon=121.4627&lat=25.0111"
```

清單來源見 `infra/lambda/lambdas.json`;總覽見 `infra/lambda/README.md`。
