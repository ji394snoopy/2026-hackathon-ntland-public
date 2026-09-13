> ⚠️ **存底目錄（原 `cli/`，非部署路徑）**
>
> 這裡是原始的 CLI / pipeline 程式碼與其單元測試（`test/`）、參照資產（`references/`、
> `assets/`、各 pipeline 的 `input/`）的**保存版本**。上雲的 Lambda 已於深度融合時搬進
> `infra/lambda/<name>/`，共用核心在 `infra/lambda/shared/`（claude/tool/retry/constants +
> `grading/` + `assets/` + `references/`）。infra **不再引用**本目錄——這裡純粹存底，
> 保留 CLI 執行能力、單元測試與參照文件（PDF/字型等 assets），**請勿當作無用而刪除**。
> 修改上雲行為請改 `infra/lambda/`；本目錄僅在需要跑 CLI 或查對原始參照時使用。

# cli-util

一組 TypeScript CLI 工具集,主要用來處理台灣地價相關的公文 PDF(繁體中文),並附帶國土測繪中心
(NLSC)地圖圖磚工具、經濟部水利署(WRA)排水設施查詢工具、Open-Meteo 風勢查詢工具,以及農業部
農業試驗所(TARI)土質查詢工具。
專案內含六個各自獨立的子專案(pipeline),彼此不互相依賴:

- **factorStandard** — 從 PDF 一次性擷取「地價區段調查估價」的評價基準表(結構化 JSON)
- **districtSurvey** — 讀取「地價區段勘查表」PDF、產生內容與座標,再蓋章填回原始 PDF
- **mapTiles** — 依經緯度抓取並拼接 NLSC WMTS 地圖圖磚,與 Claude/Bedrock 完全無關
- **drainageQuality** — 依經緯度查詢鄰近的 WRA 排水設施(抽水站、水門等),與 Claude/Bedrock
  完全無關,僅支援新北市
- **windCondition** — 依經緯度查詢過去一年的平均風速與主要風向,與 Claude/Bedrock 完全無關,
  全國(含國外)皆可查詢
- **soilQuality** — 依經緯度查詢 TARI 土壤圖分類(土系、土型、表土質地等),與 Claude/Bedrock
  完全無關,僅支援新北市

`factorStandard` 與 `districtSurvey` 都是透過 AWS Bedrock 呼叫 Claude Sonnet 5
(`ap-northeast-1`)來理解 PDF 內容,**每次執行都會呼叫真實 API 並產生費用**。

## 安裝與前置需求

- Node.js `24.19.0`(見 `package.json` 的 `engines`)
- 一組能存取 AWS Bedrock 的憑證(用於 `factorStandard`、`districtSurvey`)

```bash
npm install
```

### AWS 憑證設定

`src/shared/claude.ts` 使用 AWS SDK 的預設憑證鏈(credential provider chain)。如果你已經
設定好 `~/.aws/credentials` 或 `AWS_PROFILE`,不需要做任何事。

若要改用明確的 access key,可複製 `.env.example` 為 `.env` 並填入:

```bash
cp .env.example .env
# 編輯 .env,取消註解並填入 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
```

## 常用指令

```bash
npm run typecheck   # tsc --noEmit,修改 src/ 後請務必執行
npm test            # node:test 測試

npm run extract:fs  # factorStandard 擷取,對 references/factor-standard.pdf 執行(會呼叫真實 API)
npm run fill:all    # districtSurvey,將八大類別一次填入同一份 PDF(需先產生每個類別的資料)
npm run fetch:topo  # mapTiles/detailTopo,抓取並拼接 1/1000 地圖圖磚(不需要 AWS 憑證)
npm run fetch:base  # mapTiles/baseTopo,抓取並拼接 1/5000 地圖圖磚(不需要 AWS 憑證)
npm run fetch:drainage  # drainageQuality,查詢鄰近 WRA 排水設施(不需要 AWS 憑證,僅支援新北市)
npm run fetch:wind      # windCondition,查詢過去一年平均風速與主要風向(不需要 AWS 憑證,全國皆可)
npm run fetch:soil      # soilQuality,查詢 TARI 土壤圖分類(不需要 AWS 憑證,僅支援新北市)
```

---

## 1. factorStandard — 評價基準表擷取

從 PDF 一次呼叫 Claude,擷取「地價區段調查估價」的評價基準表:主要項目 → 細項 → 等級
(優/稍優/普通/稍劣/劣)→ 修正率 + 認定基準。來源文件實際包含兩張表,會一起擷取:

- 區域因素評價基準明細表(土地使用管制、交通運輸、自然條件、公共建設、特殊設施、環境汙染、工商活動)
- 個別因素評價基準明細表(宗地條件、道路條件、接近條件、周邊環境條件、行政條件)

```bash
tsx src/factorStandard/main.ts references/factor-standard.pdf

# 或直接用內建的範例 PDF:
npm run extract:fs
```

輸出寫到 `src/factorStandard/output/`(已被 `.gitignore` 排除,屬於一次性除錯輸出):

- `output/result.json` — Claude API 原始回應
- `output/extracted.json` — 擷取出的結構化表格資料

詳見 `src/factorStandard/README.md`。

## 2. districtSurvey — 地價區段勘查表填寫

針對「表1 地價區段勘查表」這份單頁 PDF(含核取方塊、單選標記、填空文字),分成八大類別區塊,
每個類別都是「內容 → 座標 → 填入」三階段流程:

| 代碼 | 類別 | 中文 |
|------|------|------|
| `li` | landImprovement | 土地改良 |
| `sf` | specialFacilities | 特殊設施 |
| `ca` | commercialActivity | 商業活動 |
| `lr` | landUseRegulation | 土地使用管制 |
| `tt` | trafficAndTransport | 交通運輸 |
| `pi` | publicInfrastructure | 公共建設 |
| `ep` | environmentalPollution | 環境污染 |
| `nc` | naturalConditions | 自然條件 |

每個類別依序執行下列三步:

```bash
# 1. 內容(文字生成,呼叫 API,不帶 PDF)
src/districtSurvey/run.sh generate <category>

# 2. 座標(對照真實 PDF 做座標校正,呼叫 API)
src/districtSurvey/run.sh generateCoordinate <category>

# 3. 填入(純本地運算,不呼叫 API;需要前兩步的輸出已存在)
src/districtSurvey/run.sh fill <category>
```

範例(土地改良 `li`):

```bash
src/districtSurvey/run.sh generate li
src/districtSurvey/run.sh generateCoordinate li
src/districtSurvey/run.sh fill li
```

八個類別的輸出都準備好之後,可以一次把全部填到同一頁 PDF 上:

```bash
npm run fill:all
```

輸出寫到各類別自己的 `output/`(已被 `.gitignore` 排除)。詳見
`src/districtSurvey/README.md`(含目前尚未串接的已知缺口說明)。

## 3. mapTiles — 地圖圖磚抓取與拼接

抓取並拼接 NLSC(國土測繪中心)WMTS 地圖圖磚,標出指定經緯度的位置,與 Claude/Bedrock
無關,純粹呼叫公開的 NLSC 圖磚伺服器,不需要 AWS 憑證。內含兩個各自獨立的子模組,對應
不同比例尺的地圖產品:

- **detailTopo** — 1/1000都市計畫地形圖。僅支援**新北市**(依經緯度自動判斷所屬行政區
  圖層;超出新北市範圍會直接報錯)。
- **baseTopo** — 1/5000基本地形圖。NLSC 的全國合併圖層(`B5000`),不需查詢行政區,
  開發/驗證範圍為新北市(技術上可涵蓋全國,但新北市以外的圖磚可用性未經確認)。

```bash
npm run fetch:topo -- <lon> <lat> [zoom] [radius] [pin] [emap]   # 1/1000,新北市限定
npm run fetch:base -- <lon> <lat> [zoom] [radius] [pin] [emap]   # 1/5000,全國合併圖層
```

範例(兩者參數形狀相同):

```bash
npm run fetch:topo -- 120.9447 24.7917 15 1          # 3x3 拼接,圖釘 + 純白背景(預設)
npm run fetch:topo -- 120.9447 24.7917 15 1 off      # 3x3 拼接,不顯示圖釘
npm run fetch:topo -- 120.9447 24.7917 15 1 on on    # 顯示圖釘,改用 EMAP2 底圖取代純白背景
```

| 參數 | 必填 | 預設 | 說明 |
|--------|------|------|------|
| `lon` | 是 | — | 經度(十進位度,如 `120.9447`) |
| `lat` | 是 | — | 緯度(十進位度,如 `24.7917`) |
| `zoom` | 否 | `15` | 縮放等級 0-19,數字越大細節越多、單張圖磚涵蓋範圍越小 |
| `radius` | 否 | `0` | 以中心點為準向外擴的圖磚圈數:`0` = 單張 256x256,`1` = 3x3/768x768,`2` = 5x5/1280x1280 |
| `pin` | 否 | 開啟 | 傳入 `0`/`off`/`false`/`no` 可關閉定位圖釘 |
| `emap` | 否 | `white` | `white`(預設,純白背景,不抓 EMAP2)/ `on`\|`emap`(疊加 EMAP2 通用電子地圖底圖)/ `0`\|`off`\|`false`\|`no`(原始圖層,透明缺口) |

輸出分別寫到 `src/mapTiles/detailTopo/output/`、`src/mapTiles/baseTopo/output/`
(皆已被 `.gitignore` 排除)。詳見 `src/mapTiles/README.md`。

## 4. drainageQuality — 排水設施查詢

依經緯度查詢鄰近的 WRA(經濟部水利署)排水設施,作為 表1 地價區段勘查表中「保（排）水
之良否」(自然條件類別,權重 2/5)的事實性參考依據。與 Claude/Bedrock 無關,純粹呼叫
WRA 水利空間資訊服務平台的公開 SHP 圖層,不需要 AWS 憑證。**僅支援新北市**,超出範圍會
直接報錯(透過 NLSC 的 `TownVillagePointQuery` API 判斷查詢點所屬縣市)。

此工具回報的是**事實**,不是等級評分:針對 4 個 WRA 排水設施圖層(抽水站、水門、中央管
區域排水設施範圍、中央管河川河堤),回報距查詢點最近的新北市內設施與距離(公尺);若圖層
為面(polygon),另外回報查詢點是否落在範圍內。要把距離換算成 優/稍優/普通/稍劣/劣 等級
需要有依據的門檻規則,目前未找到公開來源,留給人工估價師或後續任務判斷。刻意不使用
淹水潛勢模擬資料 — 本工具談的是排水設施/容量,不是淹水潛勢模擬。

```bash
npm run fetch:drainage -- <lon> <lat>
```

範例:

```bash
npm run fetch:drainage -- 121.4627 25.0111   # 板橋, New Taipei City
```

輸出寫到 `src/drainageQuality/output/`(已被 `.gitignore` 排除)。詳見
`src/drainageQuality/README.md`。

## 5. windCondition — 風勢查詢

依經緯度查詢 Open-Meteo 的歷史氣象資料(Archive API),作為 表1 地價區段勘查表中「風勢」
(自然條件類別:以該地價區段風勢方向或大小來衡量)的事實性參考依據。與 Claude/Bedrock
無關,純粹呼叫 Open-Meteo 的公開 API(免金鑰、免註冊、全球涵蓋),不需要 AWS 憑證,也不限
新北市。

此工具回報的是**事實**,不是等級評分:取查詢點過去約一年、每日最大風速的平均值,以及同期間
的主要風向(以 8 方位 + 中文名稱表示,如「東北風」)。要把風速/風向換算成 優/稍優/普通/稍劣/
劣 等級需要有依據的門檻規則,目前未找到公開來源,留給人工估價師或後續任務判斷。回報的風速是
「每日最大值的平均」,不是真正的逐時平均風速 — 詳見 `src/windCondition/README.md`。

```bash
npm run fetch:wind -- <lon> <lat>
```

範例:

```bash
npm run fetch:wind -- 121.4627 25.0111   # 板橋, New Taipei City
```

輸出寫到 `src/windCondition/output/`(已被 `.gitignore` 排除)。詳見
`src/windCondition/README.md`。

## 6. soilQuality — 土質查詢

依經緯度查詢農業部農業試驗所(TARI)的土壤圖分類,作為 表1 地價區段勘查表中「土質」
(自然條件類別:以該地價區段地質適宜作何種使用之內容來衡量,僅用於農地估價)的事實性
參考依據。與 Claude/Bedrock 無關,純粹讀取 TARI 開放資料平台的公開土壤圖 SHP(全國,
73.8MB,首次執行後快取於本機),不需要 AWS 憑證。**僅支援新北市**,超出範圍會直接報錯
(透過 NLSC 的 `TownVillagePointQuery` API 判斷查詢點所屬縣市)。

此工具回報的是**事實**,不是等級評分:查詢點所落入的土壤圖圖斑,回報其土系代號、土系
(中英文名稱)、土型、表土質地、土類、坡度相、土相、土壤變異等分類欄位。資料集本身沒有
「適合種植何種作物」的官方評等欄位(已確認,見 `src/soilQuality/README.md`),要換算成
優/稍優/普通/稍劣/劣 等級或具體的作物適宜性,需要有依據的門檻規則,目前未找到公開來源,
留給人工估價師或後續任務判斷。都市化地區(如查詢點落在「建地」圖斑,或完全沒有土壤調查
涵蓋)也會如實回報,不會勉強配對到不相關的最近土壤圖斑 — 詳見
`src/soilQuality/README.md`。

```bash
npm run fetch:soil -- <lon> <lat>
```

範例:

```bash
npm run fetch:soil -- 121.5010 25.2590   # 三芝, New Taipei City (real farmland match)
npm run fetch:soil -- 121.4627 25.0111   # 板橋, New Taipei City (urban 建地 match)
```

輸出寫到 `src/soilQuality/output/`(已被 `.gitignore` 排除)。詳見
`src/soilQuality/README.md`。

---

## 專案結構重點

- `src/shared/` — 跨 pipeline 共用的程式:`claude.ts`(Bedrock SDK 包裝)、`tool.ts`
  (`extractResult`、`readPdfAsBase64` 等輔助函式)
- `src/constants.ts` — Claude 模型 ID、AWS region、max tokens 等共用常數
- `references/` — 範例來源 PDF,以及中英文詞彙對照表(`zh_en_*_mapping.json`)
- `assets/` — 填 PDF 用的內嵌中文字型(ARPLUKaiTW、NotoSansTC)
- `output/`(以及每個 pipeline 自己的 `output/`)— 一律 gitignore,視為一次性除錯輸出,不需保留
- `temp/plans/*` — gitignore,本地的規劃文件,記錄過去架構決策的原因(例如為何從 Bedrock
  換到直接 API 又換回來)

更詳細的架構說明與慣例,請見 `CLAUDE.md`;每個 pipeline 的細節請見各自資料夾下的
`README.md`。
