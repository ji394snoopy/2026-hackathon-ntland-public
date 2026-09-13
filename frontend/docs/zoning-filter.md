# 都市計畫土地使用分區 - 座標篩選服務

新北市都市計畫土地使用分區資料只有「全市一份」，不分行政區。這個 Lambda 收到
`lat`/`lng` 就從全市資料裡篩出附近範圍回傳，前端不用自己扛一份幾百 MB 的檔案。

## 架構

- **主線（有 AWS 帳號時）**：前端打這個 Lambda 的 Function URL，帶 `lat`/`lng` 查詢附近分區
- **備援（沒設定 API / 連不上時）**：前端自動退回 `public/data/zoning/ntpc-zoning.geojson`（簡化版全市檔案，**已進 git**，Amplify 這種直接 clone repo 建置的平台不用額外設定就能部署），在瀏覽器端自己篩選附近範圍
- 兩條路徑前端都會自動切換，不用手動改程式碼，參見 [`src/pages/map/ZoningMap.tsx`](../src/pages/map/ZoningMap.tsx) 的 `loadZoningGeoJson()`

> ✅ **已解決**：Function URL 一度持續 403（不是延遲、不是 IAM policy 缺項，一度懷疑是 Organizations
> SCP/RCP）。真正原因：2025-10 起 Lambda 規定 `NONE` auth type 的 Function URL 要同時有
> `lambda:InvokeFunctionUrl` **和** `lambda:InvokeFunction`（帶 `InvokedViaFunctionUrl` 條件）
> 兩條 resource policy statement，缺一條就是 403，且訊息完全看不出缺哪條。後者要用
> `--invoked-via-function-url` 這個 CLI 旗標設定，而系統預設的 `aws-cli/2.15.26` 不支援這個旗標
> （`deploy.sh` 原本又用 `|| true` 吞掉錯誤，所以完全沒有察覺）。`deploy.sh` 現在會在部署前檢查
> CLI 是否支援這個旗標，兩條 statement 也都會自動補上。CLI 太舊的話：`pip install --upgrade awscli`。

## 首次使用：準備資料

`public/data/zoning/ntpc-zoning.geojson` 已經在 git 裡，一般情況不用重新產生。
只有在要更新資料版本或重建 Lambda 部署包時才需要跑：

```bash
./aws/zoning-filter/prepare-data.sh
```

需要 `ogr2ogr`（GDAL）。macOS 沒有的話：`brew install gdal`。
會產出兩份一樣的簡化版檔案（約 88MB，故意壓在 GitHub 100MiB 硬限制以下留餘裕）：

- `public/data/zoning/ntpc-zoning.geojson` — 前端 fallback 用，**要進 git**（一般伺服器開 gzip 後實際傳輸約 7-8MB）
- `aws/zoning-filter/zoning-data.geojson` — 複製給 Lambda 部署包用，不進 git（見 `.gitignore`）

原本想給 Lambda 用未簡化全精度版（278MB），但反投影後超過 Lambda 250MB 解壓後大小上限，改成兩邊共用同一份簡化版。Lambda 的價值是「伺服器端先篩選、瀏覽器只拿附近範圍」，不是精度更高，所以不影響效果。

## 部署 Lambda（比賽現場拿到 AWS 帳號後）

```bash
aws configure   # 或設定 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
./aws/zoning-filter/deploy.sh
```

預設部署到 `ap-northeast-1`（跟目前 Amplify app 同區域），可用 `AWS_REGION` 環境變數覆蓋。
跑完會印出 Function URL，先用 curl 測過能打通再填進前端 `.env`：

```
VITE_ZONING_API_URL=https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/
```

本機開發：改完 `.env` 重開 `pnpm dev`。
Amplify 正式站：去 Amplify Console → 該 app → Hosting environments → Environment variables 加這個變數，重新觸發部署。

## 測試

```bash
curl "https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/?lat=25.2219&lng=121.63575"
```

回傳附近（預設 1.5km 半徑）的分區 GeoJSON FeatureCollection。若拿到 403 Forbidden：

1. 先用 `aws lambda invoke` 直接呼叫確認 function 本身沒問題（authenticated 呼叫繞過 Function URL，能排除是不是 function 本身壞掉）
2. `aws lambda get-policy` 檢查 resource policy 是不是兩條 statement 都在（`InvokeFunctionUrl` + `InvokeFunction`），常見就是缺第二條，見上面「已解決」那段

## 重新部署（改了 index.mjs 之後）

直接再跑一次 `./aws/zoning-filter/deploy.sh` 即可，腳本會偵測 function 已存在並更新程式碼。
