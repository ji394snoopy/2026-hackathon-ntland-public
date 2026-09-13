# infra — CDK v2 基礎架構

用 AWS CDK v2(TypeScript)描述兩個獨立 stack,一次 `cdk deploy` 就能在全新 AWS
帳號上把靜態資料 CDN 與範例 Lambda 建起來。前端 SPA 本體仍由 **Amplify** 部署,這個
專案不接管 SPA。

## 授權

本專案相依樹只含寬鬆授權(MIT / Apache-2.0 / ISC / BSD-3-Clause),**不含任何
GPL / LGPL / AGPL / MPL 等 copyleft 授權**,可安全交付客戶。新增相依時請維持這個
原則,可用下列指令自查:

```bash
find node_modules -maxdepth 2 -name package.json -not -path "*/node_modules/*/node_modules/*" \
  | while read f; do node -e "const p=require('./'+process.argv[1]); if(p.name){const l=(p.license||'').toString(); if(/GPL|AGPL|MPL|CDDL|EPL/i.test(l)) console.log('WARN',l,p.name)}" "$f"; done
```

## Stack 一覽

| Stack | 內容 | 產出(CfnOutput) |
|-------|------|------------------|
| `NtlandAssetStack` | private S3 + CloudFront(OAC)+ 上傳靜態資料 | bucket 名稱、CloudFront domain、zoning geojson 公開 URL |
| `NtlandLambdaStack` | `ntpc-zoning-filter` + cli B 類 CLI(wind / map tiles)+ `ntpc-facilities`(查 PostGIS,走 Data API)+ `ntpc-land-easymap`(即時爬地籍圖資便民系統)Lambda,各自公開 Function URL(CORS) | 6 個 Function URL |
| `NtlandDatabaseStack` | PostGIS(Aurora PostgreSQL Serverless v2 + RDS Data API) | cluster ARN、secret ARN、database name |
| `NtlandBedrockStack` *(規劃中)* | cli 的 Bedrock / PDF pipeline:factorStandard 抽級距表、districtSurvey 產草稿、fillDistrictSurvey 產 PDF,各自公開 Function URL | 3 個 Function URL |

- **AssetStack**:S3 全面封鎖公開存取,只讓 CloudFront 透過 OAC 讀取。存放大型靜態
  資料(如新北市使用分區 geojson)。
- **LambdaStack**:zoning-filter 冷啟動時從 AssetStack 的 S3 讀 geojson(不再把大檔塞
  進部署包),依 `lat`/`lng` 篩附近分區回傳。另外把 cli 的 **B 類 CLI**(純公開
  API / 讀圖層,免 AWS 憑證、免 DB)也做成 Lambda,見下方「cli B 類 CLI 端點」。
  還有 `ntpc-facilities`:給範圍查 PostGIS(走 DatabaseStack 的 Aurora Data API)回傳
  範圍內設施,見下方「設施範圍查詢」;以及 `ntpc-land-easymap`:即時打 easymap.moi.gov.tw
  查單筆地號的公告現值/地價,見下方「land-easymap 端點」—— 它跟 wind/map tiles 一樣只往外
  打公開網站(無 DB / S3 / Bedrock / IAM),所以歸在這個 stack 而不是 BedrockStack。
  所有 Function URL 都用 `NONE` auth,CDK 原生補上
  `InvokeFunctionUrl` + `InvokeFunction` 兩條 resource policy,不會遇到舊 `deploy.sh`
  那個 403 陷阱。
- **DatabaseStack**:給之後要匯入的 opendata 大資料集(土壤圖、排水圖…)做空間查詢。
  用 Aurora PostgreSQL Serverless v2 + **RDS Data API**,讓 Lambda 免進 VPC(走
  HTTPS 查 DB),就不需要收費的 NAT Gateway。詳見下方「PostGIS 資料庫」。

`NtlandLambdaStack` 依賴 `NtlandAssetStack`(需要 bucket 名稱/key)與 `NtlandDatabaseStack`
(facilities 需要 cluster/secret 走 Data API),`--all` 部署時 CDK 會自動排序(先 Asset /
Database,後 Lambda)。

## Bedrock / PDF pipeline(NtlandBedrockStack,規劃中)

把 cli 用到 AWS Bedrock(Claude)的 pipeline 接成雲端 Function URL,放在一個**獨立
隔離的 stack**:factorStandard(抽評價基準明細表 PDF → 級距 JSON)、districtSurvey(產表3
草稿 content)、fillDistrictSurvey(收定稿 content → 產填好的 PDF)。設計是「AI 產草稿 →
前端編輯 → 定稿產出」,產資料與產 PDF 是解耦的兩支端點。

> ℹ️ **Bedrock model access:** AWS 已退休「Model access」設定頁,serverless 模型首次被
> 呼叫時自動啟用,不需再手動開通。但 **Anthropic 模型首次使用可能要先填 use-case 表單**,
> 且 Lambda 仍需 IAM 權限(由本 stack 給)、帳號別有 SCP/IAM 限制。細節與驗證方式見
> [`docs/bedrock-model-access.md`](docs/bedrock-model-access.md)。

- 完整實作計畫(給接手 session):[`docs/bedrock-stack-plan.md`](docs/bedrock-stack-plan.md)
- model access 開通說明:[`docs/bedrock-model-access.md`](docs/bedrock-model-access.md)

## cli B 類 CLI 端點

cli 的 B 類 pipeline(輸入都是經緯度、對外抓公開資料、免 AWS 憑證)已包成 Lambda。
handler 原始碼在 `cli/src/**/lambda.ts`,由 `scripts/build-lambdas.mjs`(esbuild)
打包成自帶依賴的 `build/lambda/<name>/index.mjs` 後,由 LambdaStack `Code.fromAsset`
上傳。**部署前會自動先跑 `npm run build:lambdas`**(已掛在 `synth` / `deploy` 前)。

> **想一次看到 infra 有哪些 Lambda?** 看 [`lambda/README.md`](lambda/README.md) 總表。
> 清單的單一來源是 [`lambda/lambdas.json`](lambda/lambdas.json)——人看它列全部,
> `build-lambdas.mjs` 也讀它決定打包哪些 handler(`bundled: true`),所以清單不會跟實際
> 部署脫節。cli handler 邏輯仍以 cli 為準(會持續更新),`infra/lambda/<name>/`
> 底下只是指回 cli 的 ref。

| 端點(CfnOutput) | function | 說明 | 輸出 |
|------------------|----------|------|------|
| `WindFunctionUrl` | `ntpc-wind-condition` | Open-Meteo 近一年平均風速 + 主風向 | JSON |
| `BaseTopoFunctionUrl` | `ntpc-maptiles-base` | NLSC B5000 1/5000 全國基本地形圖 | PNG |
| `DetailTopoFunctionUrl` | `ntpc-maptiles-detail` | NLSC TOPO01K 1/1000 新北市都市計畫地形圖 | PNG |

共同 query string:`?lon=<lon>&lat=<lat>`。map tiles 另支援選用參數
`zoom`(0–19,預設 15)、`radius`(0–4,預設 0;每 +1 多抓一圈磚)、`pin`
(預設開,`0/off/false/no` 關閉標記)、`emap`(`white` 白底預設 / `on` 疊 EMAP2 底圖 /
`off` 保留透明)。

```bash
# 風況(JSON)
curl "<WindFunctionUrl>?lon=121.4627&lat=25.0111"

# 地形圖磚(PNG;Function URL 會依 handler 回的 isBase64Encoded 自動還原成二進位)
curl "<BaseTopoFunctionUrl>?lon=121.4627&lat=25.0111&radius=1" -o base.png
curl "<DetailTopoFunctionUrl>?lon=121.4627&lat=25.0111" -o detail.png
```

實作重點:map tiles 用 `pngjs` 在記憶體拼接圖磚(給 1024MB 記憶體),detailTopo 會先抓
NLSC GetCapabilities(413 圖層)篩出新北市 ~56 個 sheet,並把解析結果**快取在 module
scope**,warm 執行環境不會重抓。三個 handler 都是 Node 22 runtime、自帶依賴,不需要
在部署後安裝任何東西。

## land-easymap 端點(地籍圖資便民系統即時查詢)

`LandEasymapFunctionUrl` / `ntpc-land-easymap`。給 (行政區, 段名, 地號),**即時**打內政部
[地籍圖資網路便民服務系統](https://easymap.moi.gov.tw/Z10Web/Normal) 回該筆地號的公告現值/
公告地價/面積/宗地定位點/建號。跟 wind / map tiles 同類:純對外 HTTP,**無 DB、無 S3、
無 Bedrock、無 IAM**,所以住 `NtlandLambdaStack`。

它補的是另外兩支的缺口:`land-locate` 的幾何只有**公有地**(私有地退段中心點)、
`land-value` 只有**已匯入年份**的公告值;land-easymap 則是**任何地號(含私有地)**都查得到
當年度的官方數字,代價是依賴上游可用性與 HTML 版面。

```bash
# 單筆(county 預設新北市;town/segment/parcel 為別名)
curl "<LandEasymapFunctionUrl>?district=金山區&section=金美段&lid=489"

# 自由字串
curl "<LandEasymapFunctionUrl>?q=金山區金美段489地號"

# 批次(上游 token 一次性,後端逐筆序列查;一次最多 5 筆)
curl -X POST "<LandEasymapFunctionUrl>" -H 'content-type: application/json' \
  -d '{"parcels":[{"district":"金山區","section":"金美段","lid":"489"},
                  {"district":"金山區","section":"金美段","lid":"490"}]}'
```

實作重點(邏輯來自專案根目錄的探索用 CLI `crawl-easymap/easymap.ts`,搬進
`lambda/land-easymap/`):

- 上游流程:GET 首頁拿 cookie → `setToken.jsp` 取**一次性** struts token → `Land_json_locate`
  (定位點)→ 再取一次 token → `LandDesc_ajax_detail`(HTML 明細,用 `cheerio` 解析)。
  token 用過即廢,所以**批次一定要序列送**,不能 `Promise.all`。
- 段名 →(地政事務所代碼 `office`, 地段代碼 `sectNo`)走 NLSC 免申請 API,對照表
  **快取在 module scope**,warm 容器不會重抓(冷啟動約 8~10 秒,之後約 1~2 秒)。
- 地號一律先送上游原生的補零 8 碼(母號 4 + 子號 4,`31-1` → `00310001`),查無資料再退回
  短寫法試一次;正規化重用 `lambda/land-locate/` 的 `parcelId` / `freeText`(純字串,不碰 DB)。
- 上游對**不存在的地號**會回一個只剩 `meta_*` 的空殼頁(且定位有時仍回一個點),所以
  「查無資料」一律以明細有沒有實質欄位為準 → `404`;定位或明細單邊失敗則回 `200` 並在
  `note` 說明降級原因,不整支 `502`。
- 本機驗證(有網路即可,免 AWS 憑證、免 DB):
  `node --import ./scripts/register-ts.mjs lambda/land-easymap/invoke-local.ts`
  (`CASE=basic|sub|free|batch|unknown-section|unknown-parcel`,`EASYMAP_DEBUG=1` 看每次往返)。

## 前置需求

- Node.js 24(與 repo 其他專案一致)
- AWS CLI 已設定憑證(見下方「換帳號」)
- 目標帳號/區域已 `cdk bootstrap` 過一次

## 初始化(全新帳號一次到位)

從零把整套(四個 stack + DB 資料/表)建起來的**完整順序**。這裡是「照著走一次就好」的
runbook;各步的細節、選項與原理在下方對應章節有詳解,本節只給正確順序與最短指令。

假設一次全上(`cdk deploy --all` 建 Asset / Database / Lambda / Bedrock 四個 stack)。
指令都在 `infra/` 底下跑;`<ClusterArn>` / `<SecretArn>` 取自 `NtlandDatabaseStack` 的部署輸出。

```bash
cd infra
npm install
```

**1. 憑證 + bootstrap**(詳見「部署(全新帳號 runbook)」)

```bash
aws configure                              # 或 export AWS_ACCESS_KEY_ID / SECRET / SESSION_TOKEN
export CDK_DEFAULT_REGION=ap-northeast-1   # 需要別區才改
npx cdk bootstrap                          # 該帳號/區域第一次用 CDK 才要
```

**2. 準備 geojson**(詳見「準備 geojson 資料」)—— 沒有也能部署,只是 zoning 查詢會退 fallback。

```bash
# 在 frontend/ 產出簡化 geojson,複製到 infra/assets/data/zoning/
```

**3. 一次部署四個 stack**(deploy 會自動先 `build:lambdas` 打包所有 handler)

```bash
npm run deploy          # = build:lambdas && cdk deploy --all(Asset / Database / Lambda / Bedrock)
```

> Bedrock 兩支走 Claude 的 lambda 需要帳號能呼叫 `jp.anthropic.claude-sonnet-4-6`,
> 見 [`docs/bedrock-model-access.md`](docs/bedrock-model-access.md)。

**4. 啟用 PostGIS extension**(建 geometry 表前必做;詳見「PostGIS 資料庫 → 雲端」)

```bash
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE EXTENSION IF NOT EXISTS postgis;"
```

**5. 灌 opendata**(空間查詢資料;詳見「PostGIS 資料庫 → 雲端資料匯入」)

```bash
# 小表(站點/公車站/pois/交通)走 Data API batch insert
DB_CLUSTER_ARN="<ClusterArn>" DB_SECRET_ARN="<SecretArn>" npm run seed:cloud -- all
# 門牌(~2M 筆)走 aws_s3 匯入 —— 見「雲端資料匯入 → 步驟 2b」的完整 6 步。
```

**6. 建 BedrockStack 用的表**(factor_standard + 案件四表;詳見「NtlandBedrockStack → 建表 DDL」)

```bash
# 逐句執行下方「建表 DDL」那組 aws rds-data execute-statement(Data API 一次一句)。
```

**7. 驗證**(打各 Function URL,URL 取自部署輸出;詳見各端點章節)

```bash
curl "<ZoningFunctionUrl>?lat=25.2219&lng=121.63575"
curl "<FacilitiesFunctionUrl>?lon=121.4627&lat=25.0111&radius=500"
# BedrockStack 九支端點的 curl 見「NtlandBedrockStack 部署與端點驗證 → 端點驗證」。
```

> **只做部分**:demo 只需雲端 zoning + facilities 可跳過 6(BedrockStack 建表);只需
> BedrockStack 表單流程可跳過 5 的門牌。完整流程建議照 1→7 走一遍。

## 準備 geojson 資料

Lambda 與前端 fallback 共用同一份簡化版 geojson,由 frontend 的腳本產生:

```bash
# 在 frontend/ 底下(需要 ogr2ogr,macOS: brew install gdal)
./aws/zoning-filter/prepare-data.sh
```

跑完會產生 `frontend/public/data/zoning/ntpc-zoning.geojson`。把它複製到本 stack 的
上傳來源資料夾(路徑要對應 `AssetStack` 的 `zoningDataKey`):

```bash
mkdir -p infra/assets/data/zoning
cp frontend/public/data/zoning/ntpc-zoning.geojson \
   infra/assets/data/zoning/ntpc-zoning.geojson
```

> `infra/assets/data/*.geojson` 已在 `.gitignore`(檔案大,不進 git)。若這個資料夾
> 沒有 geojson,AssetStack 仍可部署,只是 Lambda 讀不到資料會回 502,前端會自動退回
> 它自己的 fallback 檔。

## 部署(全新帳號 runbook)

```bash
cd infra
npm install

# 1. 換成目標帳號憑證(比賽當天用主辦方發的正式帳號)
aws configure           # 或 export AWS_ACCESS_KEY_ID / SECRET / SESSION_TOKEN
export CDK_DEFAULT_REGION=ap-northeast-1   # 需要別區才改

# 2. 該帳號/區域第一次用 CDK 要先 bootstrap
npx cdk bootstrap

# 3. 一次部署三個 stack(deploy 會自動先跑 build:lambdas 打包 cli handler)
npm run deploy          # = build:lambdas && cdk deploy --all
# 或分開部署:
#   npm run deploy:assets   # 只部署 AssetStack
#   npm run deploy:lambda    # 只部署 LambdaStack(含 build:lambdas)
#   npx cdk deploy NtlandDatabaseStack   # 只部署 PostGIS(不需要 build:lambdas)
```

部署完 console 會印出各 Function URL。先 curl 測通:

```bash
curl "<ZoningFunctionUrl>?lat=25.2219&lng=121.63575"
curl "<WindFunctionUrl>?lon=121.4627&lat=25.0111"
```

> **注意**:map tiles handler 依賴 `pngjs`,已裝為 infra 的 devDependency 供打包用;
> `npm install` 會一起帶到。若只想手動打包不部署,單獨跑 `npm run build:lambdas`。

## PostGIS 資料庫

之後會匯入很多 opendata 大資料集(土壤圖、排水圖…),這些本質是空間查詢
(point-in-polygon / 最近鄰),用 PostGIS + GiST 索引最合適:資料只在建置階段灌一次,
查詢時完全不用像 CLI 那樣每次下載/解析大檔。

### 雲端(CDK)

`NtlandDatabaseStack` 建立 **Aurora PostgreSQL Serverless v2 + RDS Data API**:

- **Data API**:Lambda 透過 HTTPS 呼叫 Data API 查 DB,不必進 VPC,也就免掉常駐、要
  收費的 NAT Gateway。DB 能無痛加進現有純 serverless 架構。
- **Serverless v2**:容量隨負載縮放(預設 min 0.5 / max 2 ACU),平時成本低。
- cluster 住在一個「只有 isolated subnet、0 個 NAT」的最小 VPC。
- 帳密由 CDK 產生存進 Secrets Manager(secret name `ntland/postgis/credentials`)。
- **seed bucket**:建一個 private S3 bucket 並用 `s3ImportBuckets` 授權 cluster 讀它,
  供門牌 CSV 走 `aws_s3.table_import_from_s3` 匯入(見「雲端資料匯入 → 步驟 2b」)。
  bucket 名稱輸出成 `SeedBucketName`;不需要可傳 `enableS3Import: false` 關掉。

```bash
npx cdk deploy NtlandDatabaseStack
```

產出 `ClusterArn` / `SecretArn` / `DatabaseName`。**PostGIS 擴充要手動啟用一次**
(建 cluster 時不會自動裝),可直接用 Data API 執行:

```bash
aws rds-data execute-statement \
  --resource-arn "<ClusterArn>" \
  --secret-arn "<SecretArn>" \
  --database "gis" \
  --sql "CREATE EXTENSION IF NOT EXISTS postgis;"
```

Lambda 要查這個 DB 時,給該 function 的 role 加
`rds-data:ExecuteStatement`(+ 需要 batch 時的 `BatchExecuteStatement`)以及讀取
`SecretArn` 的 `secretsmanager:GetSecretValue`,並把 `ClusterArn` / `SecretArn` /
database 名稱以環境變數傳入,用 `@aws-sdk/client-rds-data` 查詢。

> **成本/資料**:`removalPolicy` 設為 `DESTROY`(hackathon 方便清乾淨),`cdk destroy`
> 會直接刪掉 DB 與資料。正式環境請改成 `RETAIN` 並開快照(見 `lib/database-stack.ts`)。

### 雲端資料匯入(部署後一次性,尚未腳本化)

`cdk deploy` 只建出**空的** Aurora,facilities function 連得上但查不到東西(DB 空會回
空結果、不報錯)。要讓雲端有資料,部署後需手動做兩步。Data API **沒有 `psql \copy`**,
所以本機那套 `docker exec psql \copy`(見下方「本機」)在雲端不適用,改用下面兩條路:
小表走 Data API batch insert,門牌大表走 S3 匯入。

下面用到的 ARN 都來自 `cdk deploy` 的輸出(`ClusterArn` / `SecretArn`),`--database`
一律 `gis`。

#### 步驟 1:啟用 PostGIS 擴充(必做,一次)

與上面「雲端(CDK)」那段同一行 —— 建表用到 `geometry` 型別前一定要先跑:

```bash
aws rds-data execute-statement \
  --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE EXTENSION IF NOT EXISTS postgis;"
```

#### 步驟 2a:小表(pois / 站點 / 交通)—— Data API batch insert

`pois`、`metro_stations`、`hsr_stations`、`bus_stops` 等都是幾百~幾千筆的小表,適合用
Data API 的 **`BatchExecuteStatement`**(一次帶多組參數、共用一條 parameterized SQL)。
**這步已寫成腳本 `scripts/seed-cloud.mjs`**,建表 / 讀來源檔 / 分批插入 / 建索引一次搞定,
schema 與本機 `import.sh` 完全一致(同 SRID 4326、同 geom 建法):

```bash
# ClusterArn / SecretArn 取自 NtlandDatabaseStack 的部署輸出;先確認憑證指對帳號
aws sts get-caller-identity

# 一次灌全部小表(transport 各站點/路線 + bus_stops + pois;不含門牌)
DB_CLUSTER_ARN="<ClusterArn>" DB_SECRET_ARN="<SecretArn>" \
  npm run seed:cloud -- all

# 或只灌最小可用集(facilities 實際查的:站點 + 公車站 + pois)
npm run seed:cloud -- busstops --cluster-arn "<ClusterArn>" --secret-arn "<SecretArn>"
npm run seed:cloud -- pois     --cluster-arn "<ClusterArn>" --secret-arn "<SecretArn>"
npm run seed:cloud -- transport --cluster-arn "<ClusterArn>" --secret-arn "<SecretArn>"

# 動手前先驗證來源檔(不呼叫 AWS,不需憑證):印出各表筆數
npm run seed:cloud -- all --profile "<profile>" --dry-run
npm run seed:cloud -- all --profile "<profile>"
```

> 選項:`--profile`(指定 AWS profile,換帳號用)、`--database`(預設 gis)、`--region`、
> `--batch-size`(預設 500)、`--assets-dir`。這些值也可用對應環境變數(`AWS_PROFILE` /
> `DB_NAME` / `AWS_REGION` / `SEED_BATCH_SIZE` / `ASSETS_DIR`)。flag 支援 `--x=y` 或 `--x y`。
> 換帳號範例:`npm run seed:cloud -- all --profile hackathon --cluster-arn ... --secret-arn ...`
> 注意 `freeway_lines`(~5.8萬)、`bus_stops`(~3.3萬)其實不算小,batch 會分很多次、較慢;
> facilities 查詢實際只用到 `metro_stations` / `hsr_stations` / `bus_stops` / `pois`,趕時間
> 可只灌 `busstops` + `pois` + `transport`(或省略 freeway)。門牌走下面 2b 的 S3 匯入。

腳本底層對每張表做的事(等同下列 DDL / SQL,供理解與手動操作參考):

1. **建表 + 索引**:DDL 沿用 `infra/local/import/sql/20-pois.sql`(pois)與 `import.sh`
   內各表的 `CREATE TABLE`,`geom` 用 `geometry(Point,4326)` / `geometry(Geometry,4326)`。
   `pois` 灌完還會重播 `sql/21-interchange-merge.sql` 做交流道去重(見下方「交流道」)。
2. **讀來源檔**:讀 `assets/osm/ntpc-pois.geojson` ＋ `assets/osm/interchanges.geojson`
   (pois)或 `assets/*.json`(交通/站點),
   每個 feature 轉成一組參數 `{ category, name, props, geom }`。
3. **分批插入**:每批(預設 500)呼叫一次 `BatchExecuteStatement`,SQL 形如:

   ```sql
   INSERT INTO pois (category, name, props, geom)
   VALUES (:category, :name, CAST(:props AS jsonb),
           ST_SetSRID(ST_GeomFromGeoJSON(:geom), 4326));
   ```

   對應 CLI(手動塞一筆示意;實務用 SDK 帶 `parameterSets` 批次):

   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "INSERT INTO pois (category,name,props,geom) VALUES (:category,:name,CAST(:props AS jsonb),ST_SetSRID(ST_GeomFromGeoJSON(:geom),4326));" \
     --parameters '[{"name":"category","value":{"stringValue":"park"}},{"name":"name","value":{"stringValue":"介壽公園"}},{"name":"props","value":{"stringValue":"{}"}},{"name":"geom","value":{"stringValue":"{\"type\":\"Point\",\"coordinates\":[121.46,25.01]}"}}]'
   ```

4. **建空間索引**(插完再建比較快):
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE INDEX IF NOT EXISTS pois_geom_gix ON pois USING GIST (geom);"
   # Data API 一次只能一條 statement(不能用 ; 串多條),ANALYZE 分開再呼叫一次:
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "ANALYZE pois;"
   ```

> Data API 限制:單次 statement 有大小/筆數上限,所以一定要**分批**;`BatchExecuteStatement`
> 的 `parameterSets` 也有每次筆數上限(數百量級),超過就切多批。門牌 ~2M 筆用這條路會
> 打上萬次 API、又慢又貴,所以門牌改走下面的 S3 匯入。

#### 步驟 2b:門牌(~2M 筆)—— 走 S3 匯入(`aws_s3` extension)

Aurora PostgreSQL 有 **`aws_s3` extension**,能直接從 S3 物件把 CSV 灌進表,一次搞定百萬
列,不必逐列打 Data API。流程:

1. **啟用 extension(一次)**:
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE;"
   ```

2. **把門牌 CSV 上傳到 S3**(上傳到 DatabaseStack 建的 seed bucket,名稱見部署輸出
   `SeedBucketName`):
   ```bash
   aws s3 cp assets/新北市門牌位置數值資料.csv \
     s3://<SeedBucketName>/seed/doorplate.csv
   ```

3. **建表**(欄位對齊本機 `infra/local/import/sql/10-doorplate.sql`,先只建原始欄位,
   `geom` 之後再算):
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE TABLE IF NOT EXISTS doorplate (countycode text, areacode text, village text, neighbor text, street_road_section text, area text, lane text, alley text, number text, x_3826 double precision, y_3826 double precision, geom geometry(Point,4326));"
   ```

4. **授權 cluster 讀該 S3**:**已由 CDK 建好** —— `DatabaseStack` 建了一個 seed bucket
   並用 `s3ImportBuckets` 授權 cluster 讀它(CDK 自動建 s3Import role 並關聯到 cluster)。
   bucket 名稱在部署輸出的 `SeedBucketName`,把 CSV 上傳到**這個 bucket** 即可(上面步驟 2
   的 `<YourBucket>` 就用它)。不需要 S3 匯入(只 demo pois/站點)可在 `bin/app.ts` 給
   `DatabaseStack` 傳 `enableS3Import: false` 省掉這個 bucket。

5. **從 S3 匯入 CSV**(用 `aws_s3.table_import_from_s3`,只灌非 geometry 欄位,對齊本機
   `\copy` 的欄位順序):
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "SELECT aws_s3.table_import_from_s3(
              'doorplate',
              'countycode,areacode,village,neighbor,street_road_section,area,lane,alley,number,x_3826,y_3826',
              '(FORMAT csv, HEADER true)',
              aws_commons.create_s3_uri('<SeedBucketName>','seed/doorplate.csv','<region>'));"
   ```

6. **由 3826 座標算 4326 geom + 建 GiST 索引**(對齊本機
   `infra/local/import/sql/11-doorplate-finalize.sql`):
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "UPDATE doorplate SET geom = ST_Transform(ST_SetSRID(ST_MakePoint(x_3826,y_3826),3826),4326) WHERE geom IS NULL AND x_3826 IS NOT NULL;"

   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE INDEX IF NOT EXISTS doorplate_geom_gix ON doorplate USING GIST (geom);"
   # Data API 一次只能一條 statement(不能用 ; 串多條),ANALYZE 分開再呼叫一次:
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "ANALYZE doorplate;"
   ```

> 為什麼門牌走 S3 而不走 Data API:2M 筆逐批 insert 會打上萬次 HTTPS、極慢又貴;
> `aws_s3.table_import_from_s3` 是 DB 端一次讀 S3 串流灌入,適合百萬列級。cluster 讀 S3
> 的 IAM role 與 seed bucket 已由 `DatabaseStack` 建好(步驟 4),不用再手動設。

#### 步驟 2c:土地公告地價(每年約百萬列)—— 走 S3 匯入(`aws_s3` extension)

公告地價/公告土地現值 99~115 年,**每個年份約百萬列**(115 年 1,149,236 列),量級同門牌,
故走 S3 匯入而非 Data API。供 `land-value` Lambda 查最近年 vs 前一年 + 漲幅%(比較法「土地
正常單價」來源)。表結構見 `infra/local/import/sql/30-land-official-value.sql` 與
`lambda/shared/db/schema.ts` 的 `land_official_value`。

> **前置(你自己預處理)**:每年一個 CSV,欄位順序需為
> `county,district,segment,lid,year,official_value,official_price`(即把來源
> `country`/`official_value_busiprval`/`official_price_busiprval` 改名,並**新增一個
> `year` 常數欄**填該年民國年)。因為 `aws_s3.table_import_from_s3` 只能對應 CSV 既有欄位、
> 沒辦法在匯入時塞常數,所以 `year` 要在 CSV 端先補好。

1. **啟用 extension(一次;與門牌共用,已裝過可略)**:
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE;"
   ```

2. **建表(一次)**:跑上面「建表 DDL」那三句 `land_official_value` 的
   `CREATE TABLE` / `CREATE INDEX`(或本機的 `sql/30-land-official-value.sql`)。

3. **逐年上傳 CSV 到 seed bucket**(名稱見部署輸出 `SeedBucketName`):
   ```bash
   for y in 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115; do
     aws s3 cp assets/land-value/land-value-$y.csv \
       s3://<SeedBucketName>/seed/land-value/$y.csv
   done
   ```

4. **逐年從 S3 匯入到同一張表**(`year` 欄已在 CSV 內,直接對應即可;多年份重複 import
   累加進 `land_official_value`):
   ```bash
   for y in 99 100 101 102 103 104 105 106 107 108 109 110 111 112 113 114 115; do
     aws rds-data execute-statement \
       --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
       --sql "SELECT aws_s3.table_import_from_s3(
                'land_official_value',
                'county,district,segment,lid,year,official_value,official_price',
                '(FORMAT csv, HEADER true)',
                aws_commons.create_s3_uri('<SeedBucketName>','seed/land-value/$y.csv','<region>'));"
   done
   ```

   > 索引在建表時就建好了(見步驟 2)。若想加速百萬列匯入,可先 `DROP INDEX` 再全部
   > import 完重建;資料量還在 Aurora 能接受的範圍,不重建也可。匯完跑一次
   > `ANALYZE land_official_value;`(單獨一句)。

#### 步驟 2d:實價登錄(全市 ~5.7 萬列)—— Data API batch insert

實價登錄買賣案件(土地/房地/車位交易),全市約 5.7 萬列(小),走 Data API batch insert,
**已寫進 `scripts/seed-cloud.mjs` 的 `landtx` target**。匯入時會:解析 CSV(單一英文表頭列)、
解析 `rps02`(交易標的)拆出 `segment`/`lid`(房地/車位為門牌地址 → 解析不出則 null)、把
`rps07_yyymmddroc`/`rps14_yyymmddroc` 的民國 YYYMMDD 轉成西元 `date`(原始字串保留在
`rps07`/`rps14`)、數值欄轉 numeric/integer,並存下全部欄位(含 `rps28`~`rps32`:主建物/
附屬建物/陽台面積、電梯、移轉編號)。供 `land-transaction` Lambda 查歷史交易案例。

> **前置(你自己下載)**:把政府實價登錄買賣案件 CSV(UTF-8、單一表頭列,欄名為
> `district` + `rps01`~`rps32`)放到 `assets/不動產實價登錄資訊-買賣案件.csv`。
> 注意此版單價欄名是 `rps22_amountsunitdollars`(元/㎡),已對到表的 `rps22_unit`。

```bash
# 先驗證來源檔(不呼叫 AWS):印出筆數、解析出段/地號的比例
npm run seed:cloud -- landtx --dry-run

# 匯入(id = rps27,ON CONFLICT DO NOTHING,可重跑)
DB_CLUSTER_ARN="<ClusterArn>" DB_SECRET_ARN="<SecretArn>" \
  npm run seed:cloud -- landtx
```

> 注意 `npm run seed:cloud -- all` **不含** land_transaction(landtx 未列入 all,因為
> 來源檔要另外下載);要灌實價登錄請明確指定 `landtx` target。公告地價(land_official_value)
> 因為是百萬列走 S3,也不在 seed-cloud 範圍(見上面 2c)。

#### 步驟 2e:地籍段/宗地(公有土地 22.8 萬列)—— 走 S3 匯入(`aws_s3` extension)

段層 `land_section`(1,874 列)+ 宗地層 `land_parcel`(228,291 列),供 `land-locate` Lambda
查「(區, 段名 或 段代碼, 地號) → 經緯度 + 宗地邊界」。表結構見
`infra/local/import/sql/40-land-parcel.sql` 與 `lambda/shared/db/schema.ts` 的
`landSection` / `landParcel`;設計與實測數字見 `infra/docs/land-locate-plan.md`。

> ⚠️ **覆蓋率(會影響 demo 話術)**:來源是「新北市**公有土地**資料供應」,**不是完整地籍圖**。
> 段層覆蓋 1,318 / 1,869 ≈ 70%,宗地層只含公有地 —— **私有地地號一定查不到**,會退回段中心點
> (`precision: "section"`)。現場 demo 前先挑好會命中的地號:
> `SELECT district, section, parcelno FROM land_parcel WHERE district='樹林區' LIMIT 20;`

> **前置(離線轉檔)**:把 1,318 個 KML 放到 `assets/新北市公有土地資料供應/`(212MB,
> 已在 `assets/.gitignore`,不進 repo),再跑
> ```bash
> node infra/scripts/kml-to-csv.mjs   # 約 1 分鐘
> ```
> 產出 `infra/tmp/land-parcel/` 下的 `parcels.csv`(228,291 列)、`sections.csv`(1,874 列)、
> `ambiguous-report.json`、`skipped.log`。
>
> **轉檔完第一件事是看 `ambiguous-report.json`**:對照表有 11 個重複代碼(其中 7 個真的有
> KML)、另有 5 個代碼 KML 有但對照表沒有,這 12 個段的行政區是靠幾何判定的。報告會列出
> 每筆的中心點、各候選區距離與比值;`needsReview` 為 true 代表餘裕不足,需人工在腳本的
> `SECTNO_DISTRICT_OVERRIDES` 釘死後重跑(目前 `2017`/`2018` 已釘為中和區,其餘皆自動判定,
> 無 needsReview)。`skipped.log` 目前 11 筆,都是只有 2 個相異點、零面積的退化幾何。

1. **啟用 extension(一次;與門牌/公告地價共用,已裝過可略)**:
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "CREATE EXTENSION IF NOT EXISTS aws_s3 CASCADE;"
   ```

2. **建表(一次)**:把 `infra/local/import/sql/40-land-parcel.sql` 的每一句
   (`CREATE EXTENSION` / 3 個 `DROP` / 3 個 `CREATE TABLE`)**逐句**下 —— Data API 的
   `execute-statement` 不能用 `;` 串多句。

3. **上傳 CSV 到 seed bucket**(名稱見部署輸出 `SeedBucketName`):
   ```bash
   aws s3 cp infra/tmp/land-parcel/parcels.csv  s3://<SeedBucketName>/seed/land-parcel/parcels.csv
   aws s3 cp infra/tmp/land-parcel/sections.csv s3://<SeedBucketName>/seed/land-parcel/sections.csv
   ```

4. **從 S3 匯入**(宗地先進 staging,段層直接進正式表):
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "SELECT aws_s3.table_import_from_s3(
              'land_parcel_staging',
              'sectno,parcelno,master_no,sub_no,district,section,wkt',
              '(FORMAT csv, HEADER true)',
              aws_commons.create_s3_uri('<SeedBucketName>','seed/land-parcel/parcels.csv','<region>'));"

   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "SELECT aws_s3.table_import_from_s3(
              'land_section',
              'county,district,sectno,section,district_source',
              '(FORMAT csv, HEADER true)',
              aws_commons.create_s3_uri('<SeedBucketName>','seed/land-parcel/sections.csv','<region>'));"
   ```

5. **finalize**:把 `infra/local/import/sql/41-land-parcel-finalize.sql` 的每一句**逐句**下
   —— 依序是 staging→`land_parcel`(WKT 轉 geometry)、7 個 `CREATE INDEX`、
   `UPDATE land_section`(段中心點/bbox/宗地數聚合)、`DROP TABLE land_parcel_staging`、
   兩句 `ANALYZE`。

   > 22.8 萬列單句 `INSERT ... SELECT` 沒問題(門牌 2M 列的單句 import + 單句
   > `UPDATE ... geom` 已有前例)。若真的逾時,在那句加 `AND district = '板橋區'` 逐區跑。

6. **驗證**:
   ```bash
   aws rds-data execute-statement \
     --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
     --sql "SELECT (SELECT count(*) FROM land_parcel) AS parcels,
                   (SELECT count(*) FROM land_section) AS sections,
                   (SELECT count(*) FROM land_section WHERE has_geometry) AS with_geom,
                   (SELECT count(*) FROM land_section WHERE section IS NULL) AS no_name,
                   (SELECT count(*) FROM land_parcel WHERE NOT ST_IsValid(geom)) AS invalid;"
   # 預期:228291 / 1874 / 1318 / 5 / 0
   ```

#### 驗證(灌完抽查)

```bash
aws rds-data execute-statement \
  --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "SELECT (SELECT count(*) FROM pois) AS pois, (SELECT count(*) FROM doorplate) AS doorplate;"

# 端到端:打 facilities function URL(部署輸出的 FacilitiesFunctionUrl)
curl "<FacilitiesFunctionUrl>?lon=121.4627&lat=25.0111&radius=500"
```

> **demo 取捨**:若現場只需要 pois / 站點,可只做步驟 2a、跳過門牌(2b)。門牌只影響
> 回傳裡的 `doorplate` 摘要,其餘設施照常。

### 本機(Docker)

本機開發用 `postgis/postgis:16-3.4`(對齊雲端 PostgreSQL 16),你自行手動啟動:

```bash
# 啟動(背景)
docker compose -f infra/local/docker-compose.yml up -d

# 連線(host port 是 5433:docker-compose 把容器內 5432 映射到 host 5433)
psql postgresql://postgres:postgres@localhost:5433/gis

# 關閉(保留資料 volume)
docker compose -f infra/local/docker-compose.yml down
# 連資料一起清掉
docker compose -f infra/local/docker-compose.yml down -v
```

`infra/local/init/01-enable-postgis.sql` 會在**首次建立資料 volume 時**自動跑
`CREATE EXTENSION postgis`(image 只是在 OS 層裝好擴充,仍需在 `gis` 資料庫內啟用)。
若是對既有 DB 手動啟用,連進去執行同一行即可:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
```

若手邊有 `ogr2ogr`(`brew install gdal`),灌 SHP 最省事,一行搞定並轉成 EPSG:4326:

```bash
ogr2ogr -f PostgreSQL \
  "PG:host=localhost port=5433 dbname=gis user=postgres password=postgres" \
  soilmap.shp -nln soil_map -t_srs EPSG:4326 -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI
```

### 匯入 opendata(`infra/local/import/`)

`assets/` 下的交通圖層與門牌資料,可用內建腳本一次灌進本機 PostGIS。腳本**全程走
`docker exec` 連容器內的 `psql`,不需要 host 安裝 ogr2ogr / psql**,只要 Docker + Node。

```bash
# 容器需先啟動(見上)。預設連 CONTAINER=ntland-postgis、DB=gis、user=postgres。
infra/local/import/import.sh            # 全部
infra/local/import/import.sh transport  # 只灌交通 GeoJSON(高鐵/捷運/國道/鐵路/輕軌)
infra/local/import/import.sh busstops   # 只灌公車站位
infra/local/import/import.sh doorplate  # 只灌門牌 CSV(大檔,~2M 筆)
infra/local/import/import.sh pois       # 只灌 OSM POI + 高公局交流道(見下方「OSM POI」)

# 地籍段/宗地。**不在 `all` 裡**(來源 212MB 不進 repo,同 landtx 的理由),要灌請明確指定。
# CSV 不存在時會自動先跑 infra/scripts/kml-to-csv.mjs 轉檔(約 1 分鐘),灌完印驗收計數。
infra/local/import/import.sh landparcel
```

匯出的資料表(皆 4326、皆建 `*_geom_gix` GiST 索引):

| 表 | 來源 | 幾何 | 筆數 |
|----|------|------|------|
| `doorplate` | 新北市門牌 CSV(來源 **EPSG:3826**,匯入時轉 4326) | Point | ~1,985,767 有座標 |
| `bus_stops` | 公車站位 JSON(lon/lat 欄位) | Point | 33,109 |
| `freeway_lines` | 國道路線 | LineString | 58,276 |
| `rail_lines` | 鐵路路線 | LineString | 2,607 |
| `metro_lines` / `metro_stations` | 捷運路線 / 站位 | LineString / Point | 405 / 802 |
| `hsr_lines` / `hsr_stations` | 高鐵路線 / 站位 | LineString / Point | 131 / 12 |
| `lrt_lines` | 輕軌路線 | LineString | 29 |
| `pois` | OSM 新北市 POI + 高公局交流道(見下方「OSM POI」) | Point | 8,038(16 類) |
| `land_section` | 段代碼對照表 + KML 聚合(段中心點/bbox) | Point / Polygon | 1,874(其中 1,318 有幾何) |
| `land_parcel` | 新北市**公有土地**KML(1,318 檔) | MultiPolygon | 228,291 |

各表都有 `geom`(幾何)與 `props`(jsonb,保留原始屬性)。交通圖層的座標雖然屬性欄
`EPSGCode` 寫 3826,但 SHP→GeoJSON 轉檔時已重投影成 4326,實際幾何就是經緯度;只有
門牌 CSV 是真正的 3826,匯入時用 `ST_Transform(ST_SetSRID(...,3826),4326)` 轉。

範例:找離某點最近的捷運站(GiST 索引 + KNN `<->`):

```sql
SELECT props->>'MARKNAME1' AS name,
       round(ST_Distance(geom::geography,
             ST_SetSRID(ST_MakePoint(121.4627,25.0111),4326)::geography)) AS meters
FROM metro_stations
ORDER BY geom <-> ST_SetSRID(ST_MakePoint(121.4627,25.0111),4326)
LIMIT 5;
```

> **注意連接埠**:上面 `psql` 範例寫 5432,但若本機已有別的 Postgres 佔用 5432,你可能把
> 容器映射到別的 port(例如 5433);連線字串請對應實際 port。匯入腳本走 `docker exec`
> 不受 host port 影響。

### OSM POI(`pois` 表)

NLSC 環域 API 只涵蓋殯葬/加油站/醫療/文教,其餘設施類別(公園/市場/停車場/百貨/金融/
飯店/變電所/電塔/焚化/污廢水…)改由 **OpenStreetMap** 補齊。做法**不裝 osm2pgsql**、
不下載整包台灣 `.pbf`,而是用 Overpass API 以「新北市行政邊界」過濾,只抓需要的 tag
類別,產出一份小的 GeoJSON,再走既有 `load-geojson.mjs` 灌進 PostGIS(與其他圖層同一
條路徑)。

```bash
# 1) 產生 GeoJSON 快照(打 Overpass;約 8k 筆,寫到 assets/osm/ntpc-pois.geojson)
node infra/local/import/fetch-osm.mjs
#   換 mirror:OVERPASS_URL=https://overpass.kumi.systems/api/interpreter node ...
#   換行政區:node infra/local/import/fetch-osm.mjs --area="臺北市"

# 2) 灌進本機 PostGIS 的 pois 表(容器需先啟動)
infra/local/import/import.sh pois
```

`pois` 表結構:`category`(我方分類鍵,如 `park`/`bank`/`substation`)、`name`、
`props`(完整 OSM tags + osm_id/osm_type)、`geom`(Point, 4326)。建有 GiST 空間索引
與 `category` btree 索引。分類與 OSM tag 的對應定義在 `fetch-osm.mjs` 的
`CATEGORY_SELECTORS`(要新增類別改這裡即可)。

> `assets/osm/ntpc-pois.geojson` 是**快照**(對照「設施查詢對照表.md」的 C 類資料):
> OSM 會更新,定期重跑 `fetch-osm.mjs` 覆蓋即可,不需要即時打 Overpass。

#### 交流道(`motorway_junction`)—— 高公局 CSV + OSM 合併

交流道是 `pois` 裡唯一**雙來源**的分類,兩份資料互補:

| 來源 | 內容 | 筆數 | `props.source` |
|---|---|---|---|
| 高公局 `assets/交流道/*.csv` | 全台**國道**交流道,含 `road`(國道編號)與 `km`(里程) | 184 | `freeway-bureau` |
| OSM `highway=motorway_junction` | **快速道路**(台64/台65/台62)交流道,國道部分已被官方資料取代 | 23 | 無 |

當初只有 OSM 時,它存的是**匝道節點**而非交流道本體 —— 三重交流道被拆成 5 個點(散佈
824m)、林口交流道 3 個點(散佈 2.7km),還混入 21 筆「XX路出口」與 6 筆無名點,導致
「最近交流道 Xm」不可信。高公局 CSV 是官方清單、一個交流道一筆,但**只涵蓋國道**,所以
保留 OSM 補快速道路。兩者名稱只有 20/64 重疊,118 個 OSM 點裡有 40 個距任一國道交流道
超過 3km —— 實際上是互補而非重複。

合併規則寫在 **`sql/21-interchange-merge.sql`**,六個步驟(每步的理由見該檔註解):

1. CSV 同名收斂 —— 系統交流道會被列在它銜接的每條國道清單裡(南港系統交流道同時在
   國道3號與國道5號),收成群心一點,`road`/`km` 併成清單保留來源資訊
2. 刪掉 OSM 非交流道本體的點(出口匝道、無名、`石碇服務區`、誤標的`高速公路局`)
3. 刪掉 OSM 中**名稱**已被官方涵蓋的(18 組真重疊)
4. 刪掉 OSM 中**距官方點 < 300m** 的(名稱不同但同一設施的保險)
5. 剩下的 OSM 快速道路交流道,同名多點收斂成群心一點
6. 官方資料裡**同座標不同名**的收斂(台北交流道/環北交流道同點),名稱以 ` / ` 併存
   —— 這步**必須放最後**,因為它會改寫 `name`,提早跑會讓步驟 3 的名稱比對失效

> 這份 SQL 刻意獨立成一檔而不是接在 `20-pois.sql` 尾巴:**雲端 seeder 會重播同一份檔案**
> (`seed-cloud.mjs` 的 `execSqlFile()`),本機跟雲端才不會走出兩套規則。因為 Data API 一次
> 只能送一條 statement,該函式會先去掉 `--` 註解再用 `;` 切開 —— 所以這個目錄下要新增
> 給雲端重播的 SQL 檔時,**每條 statement 都要有分號結尾,且字串常值裡不能出現分號**。
> merge 本身是冪等的,重跑不會再改動任何列。

---

### 更新交流道資料

#### 1. 更新本機 PostGIS

```bash
# a) 把新的 CSV 放進 assets/交流道/
#    檔名格式 <國道名>_<資源id>.csv(國道編號取自檔名),Big5 編碼不用先轉
# b) 重跑 pois 匯入 —— 自動重轉 GeoJSON 並重建整張 pois 表
infra/local/import/import.sh pois
```

`import_pois()` 會先呼叫 `infra/scripts/interchange-to-geojson.mjs` 把 Big5 CSV 轉成
`assets/osm/interchanges.geojson`(`km` 存成 text,因為國道1號高架段的值長得像 `高架13`),
跟 OSM 的 GeoJSON 一起灌進 `pois_staging`,跑完 `20-pois.sql` 再跑
`21-interchange-merge.sql`。結尾會自動印兩個來源各幾筆 / 幾個不重複名稱。

> **不要把交流道拆成獨立的 import target**:`20-pois.sql` 開頭是 `DROP TABLE pois`,整張
> 表重建。拆開的話,下次任何人跑 `import.sh pois` 都會把交流道靜默清掉。`import.sh all`
> 已涵蓋 pois,所以也一併涵蓋交流道。

#### 2. 更新雲端 Aurora

```bash
cd infra

# a) 先確認 assets/osm/interchanges.geojson 存在(上面步驟 1 會產生;
#    只灌雲端沒跑過本機匯入的話,單獨產一次)
node scripts/interchange-to-geojson.mjs

# b) 先 dry-run 驗來源檔(不打任何 AWS)
node scripts/seed-cloud.mjs pois --dry-run

# c) 實際灌。ARN 取自 CDK stack outputs(NtlandDatabaseStack)
npm run seed:cloud -- pois \
  --cluster-arn "<ClusterArn>" --secret-arn "<SecretArn>" \
  --profile <AWS_PROFILE> --region ap-northeast-1
```

`seedPois()` 會讀 `ntpc-pois.geojson` **加上** `interchanges.geojson`,建表 + batch insert
之後重播 `21-interchange-merge.sql`,結果與本機一致。`interchanges.geojson` 不存在時會印
警告並退回「交流道只有 OSM」,不會整個失敗 —— 看到那行警告就是漏了步驟 a。

> `pois` 走的是 `DROP TABLE` + 重建,所以這個指令是**整張表重灌**,不是增量;只想補交流道
> 也一樣要跑整個 `pois` target。

#### 3. 驗收

本機匯入與雲端 seed 都會印來源計數。要再確認沒有重複(兩者都應為 0):

```bash
docker exec ntland-postgis psql -U postgres -d gis -c "
SELECT 'dup_name' AS check, count(*) FROM (
  SELECT name FROM pois WHERE category='motorway_junction' GROUP BY name HAVING count(*)>1) x
UNION ALL SELECT 'dup_coord', count(*) FROM (
  SELECT round(ST_X(geom)::numeric,5), round(ST_Y(geom)::numeric,5)
  FROM pois WHERE category='motorway_junction' GROUP BY 1,2 HAVING count(*)>1) y;"
```

再打一次 facilities 確認 API 端也乾淨(交流道應每個名稱只出現一次):

```bash
FACILITIES_DB_DRIVER=pg PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres \
PGPASSWORD=postgres PGDATABASE=gis \
  node --import ./scripts/register-ts.mjs lambda/facilities/invoke-local.ts
```

驗證資料(分類統計 + 某點附近查詢):

```bash
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT category, count(*) FROM pois GROUP BY category ORDER BY 2 DESC;"

# 金山 demo 座標附近 1500m,各類最近設施
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT category, name,
          round(ST_Distance(geom::geography, ST_MakePoint(121.636,25.221)::geography)::numeric,0) AS m
   FROM pois
   WHERE ST_DWithin(geom::geography, ST_MakePoint(121.636,25.221)::geography, 1500)
   ORDER BY category, m;"
```

### 設施範圍查詢(facilities Lambda,本機版)

`infra/lambda/facilities/` 是一個查 PostGIS 的 Lambda:給一個**範圍**,回傳範圍內的
設施與各自到範圍中心的距離,外加門牌地址的數量與最近幾筆。原始碼住 infra(infra 自有
Lambda,非 cli CLI)。

連線層是**可切換的 repo**(`db.ts`),由環境變數 `FACILITIES_DB_DRIVER` 決定:

| driver | 用途 | 連線 | 需要的環境變數 |
|--------|------|------|----------------|
| `pg`(預設) | 本機開發 | 直連 Docker PostGIS(TCP) | `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`(選 `PGSSL=require`) |
| `data-api` | 雲端(CDK 部署) | Aurora RDS Data API(HTTPS,免進 VPC) | `DB_CLUSTER_ARN`/`DB_SECRET_ARN`/`DB_NAME`(由 LambdaStack 注入) |

query 層(`query.ts`)只透過 `repo.query(sql, $1..$n)` 介面,兩個 driver 共用**完全相同
的 SQL**;Data API repo 內部把 `$n` 位置參數改寫成具名參數、並把回傳 records 還原成
`{ rows }`,對 query 層無感。**為什麼雲端選 Data API 而非 Lambda-in-VPC + pg**:Data API
是 AWS 託管的 HTTPS 前端,後端自帶連線池(等同內建 proxy),Lambda 不持有 DB 連線,避免
高並發時每個 execution environment 各開 pool 造成的連線爆炸;Lambda 也不進 VPC,免 NAT
Gateway,還能直接出網打 NLSC API。詳細取捨見 `docs/facilities-cloud-plan.md`。

回傳的設施合併三個來源(前端拿到的是統一的一份 `facilities[]`,每筆有 `kind` 中文標籤,
OSM/NLSC 來源另帶 `category` 鍵):

| 來源 | 內容 | 查法 |
|------|------|------|
| PostGIS 站點表 | 捷運/高鐵/公車站 | 空間查詢 |
| PostGIS `pois`(OSM) | 公園/市場/停車場/百貨/金融/飯店/變電所/電塔/焚化/污廢水… | 空間查詢 |
| **NLSC 環域 API(即時)** | 殯葬/加油站/醫療/文教 | live 呼叫(`nlsc.ts`) |

- **NLSC 是即時呼叫,不進 DB**(政府端會更新)。每類 8 秒 timeout,單類失敗會被吞掉
  (回空),不影響其他來源 — 現場斷網時 DB 那份照常回,只少了 NLSC 這幾類。
- polygon 模式下 NLSC 只能吃「點+半徑」,所以用多邊形 centroid + 覆蓋半徑查,再依 ring
  過濾回範圍內。
- **關掉 NLSC**:設環境變數 `FACILITIES_INCLUDE_NLSC=off`(或 `0`/`false`/`no`),走純
  DB(離線 demo、或不想打外部 API 的測試)。
- **效能**:doorplate(~2M 筆)查詢先用吃 GiST 索引的幾何預篩(`geomPrefilter`,不轉
  `::geography`),再用精確 geography 距離複核。少了這層,`::geography` 轉型會讓索引失效、
  全表掃描(實測單一 count 約 100 秒);加上後 <1 秒。

範圍支援三種輸入:

- **多邊形(包含判定)**:GeoJSON Polygon、或 `[lon,lat]` 陣列、或 query string
  `poly=lon,lat;lon,lat;...`。取多邊形**內**的設施,距離以多邊形 centroid 計。
- **中心點 + 半徑**:`center=[lon,lat]`(或 `lon`/`lat` 欄位)+ `radius`(公尺,預設 500,
  上限 20000)。距離以中心點計。
- **多邊形 + 半徑**:兩組一起帶。多邊形**只用來取中心**(它的幾何重心),成員判定仍走半徑
  (逐類半徑在此可用)。這是表1 勘查表的流程 —— 勘查標準講的是逐類半徑(站牌 800m、
  交流道 4000m),區段邊界內有幾個設施是地籍事實,不是勘查範圍。`area.kind` 回 `"radius"`
  並標 `centerFrom: "polygon"`。

三種都可以再帶一個 **`point`**(`[lon,lat]` / `"lon,lat"` / `pointLon`+`pointLat`):
**只讓每筆多回一個 `metersToPoint`,完全不影響查得到哪些設施**。兩個距離分工如下 ——

| 距離 | 基準點 | 誰用 |
|------|--------|------|
| `metersToCenter` | `area.center`(區段多邊形則為其幾何重心) | 表5 區域因素評級(評的是整個區段) |
| `metersToPoint` | `area.point`(地點／比準地) | 表4 個別因素評級(評的是這一筆宗地) |

沒帶 `point` 就**不輸出** `metersToPoint`(缺值 ≠ 0)。排序與各類 `nearest` 一律仍以
`metersToCenter` 為準 —— 那是這次查詢範圍自己的順序;要「離 point 最近」的那筆由呼叫端自己挑。

多邊形重心在 `input.ts` 的 `ringCentroid()` 一次算完(shoelace,先平移到首頂點再算以避開
大絕對值座標的抵消誤差),SQL 成員判定、NLSC 呼叫、回傳的 `area.center` 共用同一個圓心,
不會出現三套中心。4326 的 geometry 對 `ST_Centroid` 而言就是度數平面,所以這個值與 SQL
算的一致。

GET 用 query string,POST 用 JSON body,兩者共用同一組解析。

**回傳格式**:同時給「扁平清單」和「六大類彙總」,前端二選一或都用。

```jsonc
{
  // 帶了 polygon + radius + point 時:kind 仍是 "radius",center 是多邊形重心,
  // centerFrom 標明它的來源,point 原樣回拋
  "area": {
    "kind": "radius", "center": { "lon": 121.6, "lat": 25.2 }, "radiusMeters": 800,
    "centerFrom": "polygon", "point": { "lon": 121.63575, "lat": 25.2219 }
  },

  // 扁平清單,每筆已帶 name + 到中心距離(+ 到 point 的距離) — 給地圖疊點用
  "facilities": [
    { "kind": "文教設施", "category": "education", "name": "金美國小", "lon": 121.6, "lat": 25.2,
      "metersToCenter": 42, "metersToPoint": 310 }  // metersToPoint 只在帶了 point 時才有
    // 站點(捷運/高鐵/公車)無 category;OSM/NLSC 有 category
  ],

  // 同一批設施,依六大類 rollup — 給報告 UI 用(前端不用自己分組)
  // 六大類固定為:交通 / 公共設施 / 公共建設 / 特殊設施 / 工商活動 / 其他
  "byCategory": {
    "公共設施": {
      "count": 20,
      "nearest": { "kind": "文教設施", "name": "金美國小附幼", "metersToCenter": 38 },
      "items": [ { "kind": "文教設施", "category": "education", "name": "...", "metersToCenter": 38 } ]  // 該類全部,已依距離排序
    },
    "特殊設施": { "count": 5, "nearest": { "kind": "加油站", "name": "中油金山站", "metersToCenter": 476 }, "items": [ ] }
    // ...其餘四類同結構
  },

  // 門牌量大,只給數量 + 最近 5 筆
  "doorplate": { "count": 5522, "nearest": [ { "address": "中山路一段139號", "lon": 121.6, "lat": 25.2, "metersToCenter": 5 } ] }
}
```

各大類 ↔ category 對應(定義在 `query.ts` 的 `CATEGORY_GROUP`):

| 大類 | 內含 category / kind |
|------|----------------------|
| 交通 | 捷運站/高鐵站/公車站(站點,無 category)、`motorway_junction` |
| 公共設施 | `market` `park` `education` `medical` |
| 公共建設 | `tourism` `parking` `wastewater` |
| 特殊設施 | `substation` `power_tower` `gas_storage` `waste` `cemetery` `fuel` |
| 工商活動 | `department_store` `bank` `entertainment` `hotel` |
| 其他 | 未對應到上面的(不會靜默消失) |

**本機跑法**(連本機 Docker PostGIS,預設 port 5433):

前置:容器啟動 + 資料已灌(至少 `transport`/`busstops`/`pois`,門牌選灌)。

```bash
docker compose -f infra/local/docker-compose.yml up -d   # 起容器
infra/local/import/import.sh all                          # 灌全部資料(含 pois)
```

**方法 1 — 內建 harness(最快,跑幾個預設範例查詢)**

```bash
cd infra
npm run build:lambdas                      # 先把 handler(含 pg)打包
node lambda/facilities/run-local.mjs       # 用打包好的 handler 跑範例
# 換 port/連線:PGPORT=5433 PGHOST=127.0.0.1 node lambda/facilities/run-local.mjs
```

輸出範例(板橋車站附近 500m):捷運站 9(最近出入口 ~234m)、高鐵站 1(~394m)、
公車站數百、門牌數千,OSM POI:金融機構 26、百貨公司 4(遠東/誠品…)、觀光飯店 9
(希爾頓/凱撒…)、娛樂設施(秀泰影城)、公園、停車場、變電所(新民變電所 145m),
NLSC 即時:文教設施 32、醫療設施 17、加油站 1(整趟約 3 秒)。
(關 NLSC:前面加 `FACILITIES_INCLUDE_NLSC=off`,只剩前兩類來源。)

**方法 2 — 自訂座標(改 harness 或直接呼叫 handler)**

`run-local.mjs` 裡有三個範例事件(radius GET / polygon POST / 無效輸入),改座標即可測
你要的點。或用一行呼叫打包好的 handler:

```bash
cd infra
PGPORT=5433 node --input-type=module -e '
  const { handler, closePool } = await import("./build/lambda/facilities/index.mjs");
  // 1 個點 + 半徑(radius 模式)
  const res = await handler({
    requestContext: { http: { method: "GET" } },
    queryStringParameters: { lon: "121.636", lat: "25.221", radius: "800" },
  });
  console.log(JSON.stringify(JSON.parse(res.body), null, 2).slice(0, 2000));
  await closePool();
  process.exit(0);   // pg 打包版會留一個 socket handle,測試腳本直接強制退出
'
```

polygon 模式(4 個點)則 POST 一個 GeoJSON Polygon:

```bash
cd infra
PGPORT=5433 node --input-type=module -e '
  const { handler, closePool } = await import("./build/lambda/facilities/index.mjs");
  const res = await handler({
    requestContext: { http: { method: "POST" } },
    body: JSON.stringify({ polygon: { type: "Polygon", coordinates: [[
      [121.632,25.218],[121.641,25.218],[121.641,25.225],[121.632,25.225],[121.632,25.218],
    ]] } }),
  });
  const body = JSON.parse(res.body);
  const byKind = {};
  for (const f of body.facilities) byKind[f.kind] = (byKind[f.kind]||0)+1;
  console.log("area", body.area, "\nby kind", byKind);
  await closePool();
  process.exit(0);
'
```

**方法 3 — 純 SQL 直查(不經 Lambda,驗證資料本身)**

```bash
# radius 模式:某點 800m 內各類 POI 數量
docker exec ntland-postgis psql -U postgres -d gis -c \
  "SELECT category, count(*)
   FROM pois
   WHERE ST_DWithin(geom::geography, ST_MakePoint(121.636,25.221)::geography, 800)
   GROUP BY category ORDER BY 2 DESC;"

# polygon 模式:落在 4 點多邊形內的 POI
docker exec ntland-postgis psql -U postgres -d gis -c \
  "WITH area AS (SELECT ST_SetSRID(ST_GeomFromText(
       'POLYGON((121.632 25.218,121.641 25.218,121.641 25.225,121.632 25.225,121.632 25.218))'),4326) g)
   SELECT category, count(*) FROM pois, area
   WHERE ST_Contains(area.g, geom) GROUP BY category ORDER BY 2 DESC;"
```

> 型別檢查:`npm run build`(tsc `--noEmit` 等效)確認 query 層改動不破型別。

### 雲端(CDK)

已 wire 進 `LambdaStack`,`cdk deploy` 會建出 `ntpc-facilities` function 並輸出
`FacilitiesFunctionUrl`。它走 `data-api` driver 查 `NtlandDatabaseStack` 的 Aurora:

- CDK 用 `dbCluster.grantDataApiAccess(fn)` 補上 `rds-data:*` 與讀 credentials secret 的
  `secretsmanager:GetSecretValue`,並把 `DB_CLUSTER_ARN`/`DB_SECRET_ARN`/`DB_NAME` +
  `FACILITIES_DB_DRIVER=data-api` 以環境變數注入。
- `LambdaStack` 依賴 `DatabaseStack`(`bin/app.ts` 把 cluster 傳進去),`deploy --all`
  時 CDK 自動先建 DB 再建 Lambda。
- NLSC 是對外 HTTPS 呼叫(`api.nlsc.gov.tw`);Lambda 不進 VPC(走 Data API),Function
  URL 預設可出網,不需 NAT。不想在雲端打外部 API 就設 `FACILITIES_INCLUDE_NLSC=off`。

```bash
npm run deploy          # 或 npx cdk deploy NtlandLambdaStack(會自動先建 DB)
curl "<FacilitiesFunctionUrl>?lon=121.4627&lat=25.0111&radius=500"
```

> **部署後前置**:雲端 Aurora 要先 (1) 啟用 PostGIS 擴充、(2) 灌入資料,facilities 才查
> 得到東西(DB 空會回空結果、不報錯)。完整步驟(含小表 Data API batch insert、門牌走
> `aws_s3` 匯入)見下方「PostGIS 資料庫 → 雲端資料匯入」。此步尚未腳本化。

## 接到前端(Amplify)

前端由 Amplify 部署,不在這個 CDK app 裡,所以 Function URL 要**手動**填進 Amplify:

1. Amplify Console → 該 app → Hosting environments → Environment variables
2. 設 `VITE_ZONING_API_URL = <ZoningFunctionUrl>`
3. 重新觸發一次 build(環境變數不會讓進行中的 build 自動重跑)

本機開發則填進 `frontend/.env` 的 `VITE_ZONING_API_URL`,重開 `pnpm dev`。

## 清除

```bash
npm run destroy         # = cdk destroy --all
```

S3 bucket 設了 `autoDeleteObjects` + `RemovalPolicy.DESTROY`(hackathon 方便清乾淨);
**正式環境交付前應改成 `RETAIN`** 以免誤刪資料(見 `lib/asset-stack.ts` 註解)。

## 常用指令

```bash
npm run build          # tsc 型別檢查
npm run build:lambdas  # 用 esbuild 打包 cli handler 到 build/lambda/
npm run synth          # build:lambdas + cdk synth(合成 CloudFormation,不部署)
npm run diff           # cdk diff(與已部署狀態比對)
npm run deploy         # build:lambdas + cdk deploy --all
npm run destroy        # cdk destroy --all
```

## 之後要接 cli 的 Bedrock pipeline

範例目前只做 zoning-filter。要把 cli 的 `factorStandard` / `districtSurvey`
(透過 Bedrock 呼叫 Claude)也上雲時,照 `lib/lambda-stack.ts` 裡 `ZoningFilterFn`
的形狀新增一個 function,額外需要:

- 把 cli 程式碼與 `references/*.json` 打包進 Lambda(注意 `pipeline.ts` 目前用相對
  路徑 `./references/...` 讀檔,搬進 Lambda 要改用 `__dirname` 解析)
- 在該 function 的 role 上加 `bedrock:InvokeModel`,scope 到
  `jp.anthropic.claude-sonnet-4-6` 的模型 ARN
- **手動前置**:Bedrock 的模型存取權要先在該帳號的 console 開通(CDK 無法代開)

## NtlandBedrockStack 部署與端點驗證

cli 的「AI 產草稿 → 前端編輯 → 定稿產出」雲端雛型，與由它延伸的資料儲存 / 產製 /
匯出端點，都放在 `NtlandBedrockStack` 這個獨立 stack。目前共九支 Function URL。

> ℹ️ **前置**：兩支走 Bedrock 的 lambda（`factor-standard-extract`、`district-survey-draft`）
> 需要帳號能呼叫 `jp.anthropic.claude-sonnet-4-6`。AWS 已退休「Model access」頁、首次呼叫自動
> 啟用，但 Anthropic 模型首次使用可能要先填 use-case 表單。細節見
> [`docs/bedrock-model-access.md`](docs/bedrock-model-access.md)。

### 部署

`NtlandBedrockStack` 依賴 `NtlandDatabaseStack`（factor-standard-store / case-store 走
Data API）與 `NtlandAssetStack`（原始 PDF / 圖片存 `dataBucket`），CDK 會自動先部署它們。

```bash
cd infra
npm run build:lambdas          # 九支 handler 一起用 esbuild 打包到 build/lambda/
npx cdk deploy NtlandBedrockStack
```

部署後輸出以下 Function URL（CfnOutput）：

| CfnOutput | function | 角色 | 走 Bedrock? |
|-----------|----------|------|:-----------:|
| `FactorStandardFunctionUrl` | `ntpc-factor-standard-extract` | 基準明細表 PDF → 級距/修正率 JSON | ✅ |
| `DistrictSurveyDraftFunctionUrl` | `ntpc-district-survey-draft` | 產表3 草稿 content（可吃真實周邊設施） | ✅ |
| `FillDistrictSurveyFunctionUrl` | `ntpc-fill-district-survey` | content JSON → 表1 PDF | ❌ |
| `FactorStandardStoreFunctionUrl` | `ntpc-factor-standard-store` | 存/列/取數位化級距結果（重用，免重打 Bedrock） | ❌ |
| `CaseStoreFunctionUrl` | `ntpc-case-store` | 案件狀態儲存：建案 + 表3（比準地 + N 個比較標的）/表5/表4 定稿存取 | ❌ |
| `LandValueFunctionUrl` | `ntpc-land-value` | 公告地價/現值查詢 + 年度比較（比較法「土地正常單價」來源） | ❌ |
| `LandTransactionFunctionUrl` | `ntpc-land-transaction` | 實價登錄土地交易歷史查詢（比較法「交易日期 / 歷史交易案例」來源） | ❌ |
| `LandLocateFunctionUrl` | `ntpc-land-locate` | ⚠️ **deprecated，改用 `LandEasymapFunctionUrl`** — 地籍定位：段 + 地號 → 經緯度 + 宗地邊界（公有地子集，私有地退段中心點） | ❌ |
| `ImageUploadFunctionUrl` | `ntpc-image-upload` | 報告用圖片上傳 / 列表（S3） | ❌ |
| `ProduceSurveyFunctionUrl` | `ntpc-produce-survey` | 表3 產製端點（orchestrate facilities + draft） | ❌ |
| `ProduceRegionalFactorsFunctionUrl` | `ntpc-produce-regional-factors` | 表5 產製（v2 合併鏈：對比準地 + N 個比較標的各自 regional 評分 → 合成比較）；打 regional-factor-grading | ✅（間接） |
| `ProduceComparisonFunctionUrl` | `ntpc-produce-comparison` | 表4 比較法產製（v2 合併鏈：cli 個別因素鏈 + land-transaction 正常單價 + 價格鏈）；打 individual-factor-grading + land-transaction | ✅（間接） |
| `FillReportFunctionUrl` | `ntpc-fill-report` | 匯出用 PDF 合併器（多張合一份） | ❌ |

> `produce-regional-factors` / `produce-comparison` 自己不呼叫 Bedrock，但會 HTTP 呼叫
> `regional-factor-grading` / `individual-factor-grading`（那兩支走 Bedrock）+ `land-transaction`。
> 這三個上游的 Function URL 由 CDK 在同 stack 以 env 注入（`REGIONAL_FACTOR_GRADING_URL` /
> `INDIVIDUAL_FACTOR_GRADING_URL` / `LAND_TRANSACTION_URL`），無需手動設定；但 deploy 前務必先
> 對 `jp.anthropic.claude-sonnet-4-6` 開通 Bedrock model access，否則評分會被擋。

### 建表 DDL（部署前後擇一時機，跑一次）

`factor-standard-store` 用的 `factor_standard` 表、`case-store` 用的五張案件表都**不是自動
建的**（比照 doorplate）。用 Data API 逐句執行以下 DDL。ARN 取自 `NtlandDatabaseStack` 的
部署輸出（`ClusterArn` / `SecretArn`），`--database` 一律 `gis`。

> Data API 一次只能執行一條 statement（不能用 `;` 串多條），所以下面逐句列出。全部加了
> `IF NOT EXISTS`，可重複執行。case-store 的 DDL 由 `drizzle-kit generate` 從
> `lambda/shared/db/schema.ts` 產出（schema 的單一事實來源是那份 TS）。

```bash
# factor-standard-store — factor_standard（版本依 file_name 累加;extracted 為 jsonb 數位化結果）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS factor_standard (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, file_name text NOT NULL, s3_key text, extracted jsonb NOT NULL, version int NOT NULL, label text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (file_name, version));"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS factor_standard_file_name_idx ON factor_standard (file_name);"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS factor_standard_label_idx ON factor_standard (label);"

# case-store — appraisal_case（case_id 主鍵、section_id 副鍵）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS appraisal_case (case_id text PRIMARY KEY NOT NULL, section_id text NOT NULL, meta jsonb, status text NOT NULL DEFAULT 'draft', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());"
# case-store — case_survey（表3 定稿）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS case_survey (case_id text PRIMARY KEY NOT NULL REFERENCES appraisal_case(case_id), survey jsonb NOT NULL, benchmark jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());"
# case-store — case_regional_factors（表5 定稿）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS case_regional_factors (case_id text PRIMARY KEY NOT NULL REFERENCES appraisal_case(case_id), regional_factors jsonb NOT NULL, regional_total text, remarks jsonb, updated_at timestamptz NOT NULL DEFAULT now());"
# case-store — case_comparison（表4 定稿）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS case_comparison (case_id text PRIMARY KEY NOT NULL REFERENCES appraisal_case(case_id), comparison jsonb NOT NULL, comparison_form jsonb NOT NULL, computed jsonb, updated_at timestamptz NOT NULL DEFAULT now());"
# case-store — case_comparison_survey（v2：每個比較標的各自的表3 勘查表定稿；複合主鍵 (case_id, target_index)）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS case_comparison_survey (case_id text NOT NULL REFERENCES appraisal_case(case_id), target_index integer NOT NULL, survey jsonb NOT NULL, benchmark jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (case_id, target_index));"
# case-store — section_id 副鍵索引（GET ?sectionId= 列案件用）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS appraisal_case_section_id_idx ON appraisal_case USING btree (section_id);"
```

`land-value` 用的 `land_official_value` 表、`land-transaction` 用的 `land_transaction`
表(schema 事實來源同為 `lambda/shared/db/schema.ts`)。**這兩張的建表不必手跑**——資料匯入
流程會順帶 `CREATE TABLE`(公告地價的 DDL 在 `infra/local/import/sql/30-land-official-value.sql`;
實價登錄由 `seed-cloud.mjs` 的 `landtx` target 自建),見下方「土地公告地價匯入」與
「實價登錄匯入」。這裡僅列出等效 DDL 供理解:

```bash
# land-value — land_official_value（99~115 年,逐年一列;key = 段+地號+年）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS land_official_value (county text, district text, segment text NOT NULL, lid text NOT NULL, year integer NOT NULL, official_value numeric, official_price numeric, PRIMARY KEY (segment, lid, year));"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS land_official_value_lookup_idx ON land_official_value (segment, lid, year);"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS land_official_value_district_idx ON land_official_value (district, segment);"

# land-transaction — land_transaction（實價登錄;id = rps27 編號;段/地號/日期由匯入時衍生）
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE TABLE IF NOT EXISTS land_transaction (id text PRIMARY KEY, district text, segment text, lid text, trade_date date, build_date date, rps01 text, rps02 text, rps03_area numeric, rps04 text, rps05 text, rps06 text, rps07 text, rps08 text, rps09 text, rps10 text, rps11 text, rps12 text, rps13 text, rps14 text, rps15_area numeric, rps16_quantity integer, rps17_quantity integer, rps18_quantity integer, rps19 text, rps20 text, rps21_amount numeric, rps22_unit numeric, rps23 text, rps24_area numeric, rps25_amount numeric, rps26 text);"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS land_transaction_lookup_idx ON land_transaction (district, segment, trade_date);"
aws rds-data execute-statement --resource-arn "<ClusterArn>" --secret-arn "<SecretArn>" --database "gis" \
  --sql "CREATE INDEX IF NOT EXISTS land_transaction_kind_idx ON land_transaction (rps01);"
```

> `factor_standard.s3_key` **可為 NULL**（2026-09-11 起，對齊 `store.ts` 的行為）。
> POST 不帶 `pdfBase64`／`s3Key` 時代表「只存 `extracted`、不存原始 PDF」，`s3_key` 存 NULL；
> 帶了才寫入實際的 S3 路徑。早期已建好、`s3_key` 仍為 `NOT NULL` 的表，跑一次
> `ALTER TABLE factor_standard ALTER COLUMN s3_key DROP NOT NULL;` 對齊即可
> （否則不帶 PDF 的 POST 會撞 NOT NULL → 500，SQLState 23502）。

### 端點驗證（curl）

以下 `<XxxFunctionUrl>` 換成部署輸出的實際 URL。

#### factor-standard-extract（Bedrock，帶 PDF）

收基準明細表 PDF 的 base64（POST body 純字串，或 `{ "pdfBase64": "..." }`），回抽出的
級距/修正率 JSON。Bedrock 呼叫慢，timeout 已設 120s。

```bash
base64 -i ../cli/references/factor-standard.pdf -o /tmp/factor-standard.b64
curl -X POST "<FactorStandardFunctionUrl>" -H "content-type: text/plain" \
  --data-binary @/tmp/factor-standard.b64
```

#### district-survey-draft（Bedrock，純文字）

`{ category }`（POST body 或 `?category=`），回該類可編輯 content 草稿。建議一次一類避免逾時。
帶 `facts`（周邊設施查詢結果）時草稿會依真實設施產出；不帶則憑空產（向後相容）。

```bash
# category ∈ landImprovement | specialFacilities | commercialActivity | landUseRegulation
#          | trafficAndTransport | publicInfrastructure | environmentalPollution | naturalConditions
curl -X POST "<DistrictSurveyDraftFunctionUrl>" -H "content-type: application/json" \
  -d '{"category":"landImprovement"}'
# 回:{ "category":"...", "content":{...}, "usedFacts":false }
```

#### fill-district-survey（純 pdf-lib）

收編輯後的 content JSON，回填好的表1 地價區段勘查表 PDF（base64，Function URL 自動還原二進位）。

```bash
curl -X POST "<FillDistrictSurveyFunctionUrl>" -H "content-type: application/json" \
  --data-binary @../cli/src/fillDistrictSurvey/input/sample-data.json \
  -o /tmp/district-survey-filled.pdf
```

#### factor-standard-store（DB + S3）

存/列/取數位化級距結果，讓使用者重用之前抽好的版本。版本依 `file_name` 累加。

```bash
# 存一筆（帶 pdfBase64，本支上傳到 dataBucket 的 factor-standard/ 前綴）
python3 -c 'import json,base64; print(json.dumps({ \
  "fileName":"factor-standard.pdf", "label":"2026 範例", \
  "extracted":json.load(open("../cli/src/factorStandard/output/extracted.json")), \
  "pdfBase64":base64.b64encode(open("../cli/references/factor-standard.pdf","rb").read()).decode() }))' \
  > /tmp/factor-standard-store.json
curl -X POST "<FactorStandardStoreFunctionUrl>" -H "content-type: application/json" \
  --data-binary @/tmp/factor-standard-store.json

# 列表（輕量 metadata,不含 extracted）:全列 / 依 label / 某檔名所有版本
curl "<FactorStandardStoreFunctionUrl>"
curl "<FactorStandardStoreFunctionUrl>?fileName=factor-standard.pdf&list=1"

# 取單筆（含 extracted）:依 id / 依 fileName 取最新版 / 依 fileName+version
curl "<FactorStandardStoreFunctionUrl>?id=1"
curl "<FactorStandardStoreFunctionUrl>?fileName=factor-standard.pdf"
```

#### case-store（案件狀態儲存）

建案件 + 表3/表5/表4 定稿存取。`caseId` 主鍵、`sectionId` 副鍵。只存取定稿、不做計算。
v2：比準地表3 存 `?form=survey`，每個比較標的各自的表3 存 `?form=comparison-survey`
（帶 `targetIndex`，0-based；`caseNo = targetIndex + 1`）。

```bash
# 建立案件 -> { caseId, sectionId, status, ... }
curl -X POST "<CaseStoreFunctionUrl>" -H "content-type: application/json" \
  -d '{"sectionId":"P002-00"}'

# 存各表定稿（?form= 指定表;caseId 帶在 body。PUT / POST 皆可）
curl -X PUT "<CaseStoreFunctionUrl>?form=survey" -H "content-type: application/json" \
  -d '{"caseId":"<caseId>","survey":[],"benchmark":{}}'
# v2：每個比較標的的表3（各一份;targetIndex 0/1/2）
curl -X PUT "<CaseStoreFunctionUrl>?form=comparison-survey" -H "content-type: application/json" \
  -d '{"caseId":"<caseId>","targetIndex":0,"survey":[],"benchmark":{}}'
curl -X PUT "<CaseStoreFunctionUrl>?form=regional-factors" -H "content-type: application/json" \
  -d '{"caseId":"<caseId>","regionalFactors":[],"regionalTotal":0,"remarks":{"subject":"","cases":"","overall":""}}'
curl -X PUT "<CaseStoreFunctionUrl>?form=comparison" -H "content-type: application/json" \
  -d '{"caseId":"<caseId>","comparison":[],"comparisonForm":{},"computed":{}}'

# 取單一案件（組合各已存的表）/ 列某區段案件
curl "<CaseStoreFunctionUrl>?caseId=<caseId>"
curl "<CaseStoreFunctionUrl>?sectionId=P002-00"
# v2：列某案已存的比較標的表3（依 targetIndex 排序）
curl "<CaseStoreFunctionUrl>?form=comparison-survey&caseId=<caseId>"
```

#### land-value（公告地價/現值查詢 + 年度比較）

給 段小段 + 地號,回最近有資料年份的公告土地現值/公告地價、往前逐年找到的前一年、及兩者
漲幅%。`segment`+`lid` 必填,`district` 選填(同名段跨區時消歧義)。找不到任何年份回 404;
只有一年(找不到前一年)則 `previous:null`、漲幅為 `null`。

```bash
curl "<LandValueFunctionUrl>?district=汐止區&segment=北峰段&lid=1009"
# 回:{ district, segment, lid,
#      latest:{ year, officialValue, officialPrice },
#      previous:{ year, officialValue, officialPrice } | null,
#      valueGrowthPct: number|null, priceGrowthPct: number|null }
```

#### land-transaction（實價登錄土地/房地交易歷史查詢）

給 行政區 + 段小段,回該段歷史交易案例,供比較法求「土地正常單價」挑參考案例。`segment`
必填,`district` 選填。**土地案例排序優先、房地在後**,同類內再依交易日期新到舊。

`kind` 三態(估價實務上土地與房地都要看):
- `land` — 只 `土地`(可直接比較修正求土地單價)
- `landhouse`(**預設**)— 土地 + 房地(`房地(土地+建物)`、`房地(土地+建物)+車位`),排除純車位。
  房地需下游用「房地分配法」拆分(房地總價 − 建物現值 → 回推土地價值),故案例一併回傳拆分
  所需的建物欄位(建材/樓層/型態/屋齡/建物面積)。
- `all` — 全部(含純車位,除錯用)

另支援 `from`/`to`(交易日期區間,YYYY-MM-DD)與 `limit`(預設 50、上限 200)。
**本支只撈案例與拆分所需欄位,房地→土地的拆分/折舊計算交給下游(預計走 LLM)。**

```bash
# 該段土地+房地交易（預設 landhouse,土地優先、房地在後）
curl "<LandTransactionFunctionUrl>?district=汐止區&segment=北峰段"
# 只要純土地案例
curl "<LandTransactionFunctionUrl>?district=汐止區&segment=北峰段&kind=land"
# 指定日期區間 + 限筆數
curl "<LandTransactionFunctionUrl>?district=汐止區&segment=北峰段&from=2021-01-01&to=2022-12-31&limit=20"
# 回:{ district, segment, kind, count, landCount, houseLandCount,
#      cases:[{ id, tradeDate, kind, isLandOnly,
#               landArea, buildingArea, totalPrice, unitPrice,
#               urbanUse, nonUrbanUse,
#               buildingType, structure, totalFloors, buildDate, buildingAgeYears,
#               note }] }
# 土地案例:isLandOnly=true,可直接用 unitPrice。
# 房地案例:isLandOnly=false,用 totalPrice/buildingArea/structure/totalFloors/buildingAgeYears
#          交下游拆分回推土地單價。
```

#### land-locate（地籍定位）⚠️ DEPRECATED

> **已停用，新功能改接 [land-easymap](#land-easymap地籍圖資便民系統即時查詢)。**
> 停用原因是覆蓋率:幾何只有**公有土地**,私有地地號查不到、只能退段中心點,而估價實務上
> 比較標的大多是私有地。land-easymap 即時爬官方系統,任何地號都查得到,還一併回面積與公告值。
> 唯一還贏的是**真實宗地 polygon 邊界** —— 前端地籍圖層若真的要畫多邊形才需要這支。
>
> 端點仍然活著(沒有拆 CDK,舊呼叫不會壞),但表一的定位流程請走 land-easymap。
> **`lambda/land-locate/` 資料夾不要刪**:`parcelId.ts` / `freeText.ts` 是純字串工具,
> land-easymap 直接 import 它們。

段 + 地號 → 經緯度 + 宗地邊界。三種路由:段名查(`district` 必填,段名跨區重複)、段代碼查、
自由字串。`lid` 省略則只回段中心點。資料見上面「步驟 2e」。

**三層 fallback,保證永遠有答案**:地號命中宗地 → `precision:"parcel"`;段有幾何但地號不在
公有地集合 → `precision:"section"` + `note`;段存在但無幾何 → 404 `sectionExists:true`;
段不存在 → 404 `sectionExists:false`。

```bash
# 宗地級命中（公有地）
curl "<LandLocateFunctionUrl>?district=樹林區&section=樹德段&lid=31-1"
# 回:{ county, district, section, sectno, lid, precision:"parcel",
#      center:{lat,lng}, bbox:[minLng,minLat,maxLng,maxLat],
#      boundary:{GeoJSON MultiPolygon}, areaM2, radiusHint, source, note:null }

# 私有地地號 → 退段中心點（precision:"section" + note 說明原因）
curl "<LandLocateFunctionUrl>?district=樹林區&section=樹德段&lid=99999"

# 段代碼查（代碼歧義時可再帶 district 補刀）
curl "<LandLocateFunctionUrl>?sectno=1902&lid=31-1"

# 段存在於對照表但本資料集沒有幾何 → 404 + sectionExists:true
curl "<LandLocateFunctionUrl>?sectno=1700"

# 自由字串
curl -s --get --data-urlencode "q=樹林區樹德段31-1地號" "<LandLocateFunctionUrl>"
```

> `boundary` 在 `precision:"section"` 時是**該段的 bbox polygon**(不是真實邊界),
> `areaM2` 為 null,`radiusHint` 是 bbox 對角線一半 —— UI 這時應該畫誤差圈而不是精確標點。

#### image-upload（S3）

POST 上傳一張圖到 `<dataBucket>/case-images/<caseId>/<fileName>`；GET 列某案已上傳圖片。

```bash
curl -X POST "<ImageUploadFunctionUrl>" -H "content-type: application/json" \
  -d '{"caseId":"<caseId>","fileName":"site.jpg","contentType":"image/jpeg","dataBase64":"<base64>"}'
curl "<ImageUploadFunctionUrl>?caseId=<caseId>"
```

#### produce-survey（表3 產製）

收 `sectionId` + 比準地座標，內部 orchestrate facilities（周邊設施查詢）+ district-survey-draft
（8 類草稿），映射組 `ProduceSurveyResponse`。上游 URL 走 env（`FACILITIES_URL` /
`DISTRICT_SURVEY_DRAFT_URL`，由 stack 注入）。上游失敗仍回 200，對應欄位標「需人工確認」。

```bash
curl -X POST "<ProduceSurveyFunctionUrl>" -H "content-type: application/json" \
  -d '{"sectionId":"P002-00","benchmarkLocation":{"lat":25.2219,"lng":121.63575}}'
```

#### produce-regional-factors（表5 產製，v2 合併鏈）

收「比準地的表3（`survey`+`benchmark`）+ N 個比較標的各自的表3（`comparisonSurveys[]`）」，對
每份打 `regional-factor-grading`（env `REGIONAL_FACTOR_GRADING_URL`，由 stack 注入）取 graded，
再用 cli `gradingComparison` 的 `buildFillReport`（純 code）合成含比較標的的區域比較，
`mapRegionalComparisonToRows` 攤平回 `RegionalFactorRow[]`（含 `compare[]`）。內含多次 Bedrock
評分，timeout 120s。

```bash
curl -X POST "<ProduceRegionalFactorsFunctionUrl>" -H "content-type: application/json" \
  -d '{
        "sectionId":"P002-00",
        "survey":[ /* 比準地表3 SurveyField[] */ ],
        "benchmark":{ /* 比準地 ComparisonCondition */ },
        "comparisonSurveys":[
          {"survey":[ /* 比較標的1 表3 */ ],"benchmark":{ /* 比較標的1 條件 */ }}
        ]
      }'
# 回:{ regionalFactors, regionalTotal, caseCode, comparisonCases, regionalFactorRemarks }
```

#### produce-comparison（表4 比較法，v2 合併鏈）

以 cli 個別因素鏈為主體:收「已確認表5（`regionalFactors`/`regionalTotal`）+ 比準地
（`benchmark`,選帶 `benchmarkSurvey`）+ N 個比較標的各自的表3（`comparisonSurveys[]`,含各自
`benchmark`;可選帶座標 `comparisonLocations[]` 供圖台定位）」。流程:對比準地 + 各比較標的打
`individual-factor-grading`（env `INDIVIDUAL_FACTOR_GRADING_URL`）→ cli `individualComparison`
的 `buildFillReport` 合成 comparison（每項 `delta` = 修正率%）→ 打 `land-transaction`
（env `LAND_TRANSACTION_URL`）取最近一筆土地案例 `unitPrice` 當正常單價 → 依價格鏈（日期調整
預設 0% + 區域因素修正 + Σdelta）算試算價 → 回 `ProduceComparisonResponse`。內含多次 Bedrock
評分,timeout 120s。（舊的純規則佔位版 `rules.ts` 已退役。）

```bash
curl -X POST "<ProduceComparisonFunctionUrl>" -H "content-type: application/json" \
  -d '{
        "sectionId":"P002-00",
        "regionalFactors":[ /* 表5 確認後 */ ],
        "regionalTotal":0,
        "benchmark":{ /* 比準地 ComparisonCondition */ },
        "comparisonSurveys":[
          {"address":"新北市金山區溫泉段218地號","lat":25.2231,"lng":121.6389,
           "survey":[ /* 比較標的1 表3 */ ],"benchmark":{ /* 比較標的1 條件 */ }}
        ]
      }'
# 回:{ comparison: FactorRow[], comparisonForm: ComparisonForm, computed: {...} }
```

#### fill-report（匯出 PDF 合併器）

收前端各段已產好的 PDF（表1 / 表5 / 表4 + 地圖圖），依序合併成同一份 PDF 回傳。不重畫版式、
不需字型；三張地圖圖只能瀏覽器產，故後端只負責合併。

```bash
# { files: [{ name?, pdfBase64 }, ...] }（依陣列順序合併,每份可多頁;亦接受裸陣列 / 單筆 {pdfBase64}）
curl -X POST "<FillReportFunctionUrl>" -H "content-type: application/json" \
  -d '{"files":[{"name":"survey","pdfBase64":"<b64>"},{"name":"comparison","pdfBase64":"<b64>"}]}' \
  -o /tmp/report-merged.pdf
```

---

## Migration：`case_survey` 合表 + 宗地身分欄

### 用途

**一句話**：把「比準地的表1」和「比較標的的表1」合併成同一張 `case_survey`，並補上地號與座標，
讓歷史勘查資料可以被新案直接借用。

**為什麼要做**：表1 勘查的對象就是一筆宗地，格式不該因為它在某個案子裡扮演比準地還是比較標的
而不同。分別是**案件**的事，不是表1 的事。原本拆成兩張表造成兩個實際痛點：

1. **座標與地號存不進去**。比準地的地號/座標藏在 `appraisal_case.meta`
   （`benchmarkParcel` / `location`），比較標的則**完全沒有地方存**。前端打
   `produce-comparison` 時明明帶了 `comparisonSurveys[].lat/lng`，存檔走
   `?form=comparison-survey` 時卻被丟掉 —— 要撈回來只能繞去
   `case_comparison.comparison_form.cases[i].latLng`，而那份只有跑完表4 的案子才有。
2. **沒辦法問「這附近勘查過哪些宗地」**。要從歷史挑比較標的帶進新案，估價師實際的問法是
   空間查詢；資料散在 jsonb 裡查不動。

**宗地身分欄對齊前端的定位流程**：前端輸入 `district`（鄉鎮）+ `section`（段）+ 地號 →
打 [land-easymap](../API_REFERENCE.md) 取回 `center.lat/lng` 與 `fields.areaM2` →
存表1 時把這組資訊一起帶上。所以新增的欄位就是這條流程的輸入與輸出：

| 欄位 | 來源 | 備註 |
|------|------|------|
| `district` / `section` / `parcel_no` | 前端輸入 | **三個一組**才定得出一筆宗地 —— 地號在同一行政區內不唯一，不同段可以有相同地號 |
| `sectno` | easymap `resolved.sectno` | 段代碼，可 join `land_section` / `land_parcel` |
| `lat` / `lng` | easymap `center` | 定位失敗時上游回 null，這裡也就留 null |
| `area_m2` | easymap `fields.areaM2` | 上游的權威面積；`benchmark.area` 是估價師可改的顯示值，兩者不是同一回事，所以分開存 |

合表後兩種角色共用同一組欄位，`(role, target_index)` 才是案件層的區別：

| role | target_index | 意義 |
|------|--------------|------|
| `benchmark` | 固定 `0` | 比準地（宗地），一案一份 |
| `comparison` | `0..2` | 比較標的，一案 0~3 份；對齊表4/表5 的 `caseNo = target_index + 1` |

**對外 API 不變**：`?form=survey` 與 `?form=comparison-survey` 的路由、請求、回應欄位全部
相容，只是各自多了選填的 `parcelNo` / `district` / `lat` / `lng`。前端不改也不會壞。

### 執行方式

跟本文件其他 DDL 一樣走 Data API 手動執行（**不要**用 `drizzle-kit push`）。Data API
一次只吃一個 statement，所以逐條跑。先設一個 helper 省得每條都重打：

```bash
runsql() {
  aws rds-data execute-statement \
    --resource-arn "<ClusterArn>" \
    --secret-arn "<SecretArn>" \
    --database "gis" --region ap-northeast-1 --profile <PROFILE> \
    --sql "$1"
}
```

> ⚠️ 這是**有資料搬移**的 migration，`drizzle-kit generate` 產出的版本會直接 drop 掉
> `case_comparison_survey`（連同裡面的比較標的表1）。以下是手寫的保留資料版本，請照順序跑。
> 建議先對 `case_survey` / `case_comparison_survey` 各跑一次 `SELECT count(*)` 記下數字。

```bash
# 1. 新欄位（role/target_index 先允許 NULL，下一步才回填）
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS role text;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS target_index integer;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS district text;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS section text;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS sectno text;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS parcel_no text;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS lat double precision;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS lng double precision;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS area_m2 double precision;"

# 2. 既有列全是比準地
runsql "UPDATE case_survey SET role = 'benchmark', target_index = 0 WHERE role IS NULL;"

# 3. 換主鍵：case_id -> (case_id, role, target_index)
#    （PostgreSQL 移除 PK 不會一併移除欄位的 NOT NULL，case_id 仍是 NOT NULL）
runsql "ALTER TABLE case_survey ALTER COLUMN role SET NOT NULL;"
runsql "ALTER TABLE case_survey ALTER COLUMN target_index SET NOT NULL;"
runsql "ALTER TABLE case_survey ALTER COLUMN target_index SET DEFAULT 0;"
runsql "ALTER TABLE case_survey DROP CONSTRAINT case_survey_pkey;"
# 明確指定 constraint 名稱,對齊 Drizzle 複合主鍵的命名慣例(<table>_<cols>_pk);
# 用 PG 預設的 case_survey_pkey 也能跑,但之後 drizzle-kit generate 會看到假的 diff。
runsql "ALTER TABLE case_survey ADD CONSTRAINT case_survey_case_id_role_target_index_pk
        PRIMARY KEY (case_id, role, target_index);"

# 4. 把比較標的的表1 併進來
runsql "INSERT INTO case_survey (case_id, role, target_index, survey, benchmark, updated_at)
        SELECT case_id, 'comparison', target_index, survey, benchmark, updated_at
        FROM case_comparison_survey
        ON CONFLICT (case_id, role, target_index) DO NOTHING;"

# 5. 「這筆地以前勘查過嗎」的非空間入口
#    三欄一組才定得出一筆宗地 —— 地號在同一行政區內不唯一，不同段可以有相同地號。
runsql "CREATE INDEX IF NOT EXISTS case_survey_parcel_idx
        ON case_survey USING btree (district, section, parcel_no);"

# 6. 驗完第 4 步筆數對得上，再讓舊表退場
runsql "SELECT role, count(*) FROM case_survey GROUP BY role;"
runsql "DROP TABLE case_comparison_survey;"
```

### 選配：空間查詢欄（需要 PostGIS）

要做「新比準地附近有哪些勘查過的宗地」才需要這段。`centroid` 是 **generated column**，
由 `lat`/`lng` 自動算出，寫入端完全不用管它 —— 這也是它**刻意不宣告在 `schema.ts`** 的原因：
宣告了會被 Drizzle 的 `$inferInsert` 帶進 INSERT 而寫壞。

```bash
runsql "CREATE EXTENSION IF NOT EXISTS postgis;"
runsql "ALTER TABLE case_survey ADD COLUMN IF NOT EXISTS centroid geometry(Point, 4326)
        GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED;"
runsql "CREATE INDEX IF NOT EXISTS case_survey_centroid_idx
        ON case_survey USING gist (centroid);"
```

之後查半徑 500 公尺內勘查過的宗地：

```sql
SELECT case_id, role, target_index, district, section, parcel_no, lat, lng, area_m2
FROM case_survey
WHERE centroid IS NOT NULL
  AND ST_DWithin(centroid::geography,
                 ST_SetSRID(ST_MakePoint(<lng>, <lat>), 4326)::geography, 500);
```

> `case-store` 目前**沒有**開這條查詢的路由，上面只是資料備妥後可以直接用的 SQL。
> 要開成 API 再談語意（半徑上限、要不要排除同一案、回傳格式）。

### 回滾

第 6 步跑之前都還救得回來（舊表還在，第 4 步是複製不是搬移）：

```bash
runsql "DELETE FROM case_survey WHERE role = 'comparison';"
runsql "ALTER TABLE case_survey DROP CONSTRAINT case_survey_case_id_role_target_index_pk;"
runsql "ALTER TABLE case_survey ADD CONSTRAINT case_survey_pkey PRIMARY KEY (case_id);"
runsql "ALTER TABLE case_survey DROP COLUMN IF EXISTS role;"
runsql "ALTER TABLE case_survey DROP COLUMN IF EXISTS target_index;"
```

`DROP TABLE case_comparison_survey` 跑掉之後就只能靠 DB snapshot 還原，所以第 6 步務必等
第 4 步的筆數驗過再跑。
