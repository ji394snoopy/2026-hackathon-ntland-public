# 部署文件

這個專案有兩塊部署標的：

1. **前端**（Vite 靜態站）→ AWS Amplify Hosting
2. **座標篩選 Lambda**（都市計畫土地使用分區）→ AWS Lambda + Function URL，細節見 [zoning-filter.md](./zoning-filter.md)

兩者是獨立的：Lambda 沒部署或掛掉，前端會自動退回 `public/data/zoning/ntpc-zoning.geojson` 這份已經進 git 的 fallback 資料，demo 不會因為 Lambda 出問題而整個掛掉。

## 前端：AWS Amplify Hosting

專案根目錄的 [`amplify.yml`](../amplify.yml) 已經是完整 build spec，沒有寫死任何帳號資訊：

```yaml
frontend:
  phases:
    preBuild: [corepack enable, pnpm --version, pnpm install --frozen-lockfile]
    build: [pnpm run build]
  artifacts: { baseDirectory: dist, files: ["**/*"] }
```

Amplify Console 操作：

1. 建立新 app → Host web app → 連 GitHub repo，選這個 repo 和分支
2. 它會自動讀到根目錄的 `amplify.yml`，不用另外貼 build command
3. 若有設定 `VITE_ZONING_API_URL`（見下），要在 Hosting environments → Environment variables 加上去，改完要重新觸發一次 build（環境變數不會讓進行中的 build 自動重跑）

`public/data/zoning/ntpc-zoning.geojson`（約 88MB，simplify 過壓在 GitHub 100MiB 限制以下）**已經進 git**，Amplify 是全新 `git clone` 建置，所以這份 fallback 檔案部署後不會 404，不用額外處理。

## 座標篩選 Lambda

腳本、架構、常見錯誤（Function URL 403 的坑）都寫在 [zoning-filter.md](./zoning-filter.md)，這裡只列黑客松當天的操作順序。

## 黑客松當天：換到正式 AWS 帳號

現在本機開發用的是練習帳號（`amplify-demo`，`ap-northeast-1`）。主辦方現場才會發正式競賽帳號，`deploy.sh` / `prepare-data.sh` 都沒有寫死任何帳號 ID，全部吃 CLI 當下的 active credentials，所以換帳號只需要下面幾步：

1. **換憑證**
   ```bash
   aws configure   # 或 export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN
   ```
   把練習帳號換成主辦方發的正式帳號憑證。

2. **確認資料檔還在**
   `aws/zoning-filter/zoning-data.geojson` 是本機才有、不進 git 的檔案（部署包用）。如果本機還在（多半是，因為沒被 git clone 清掉），跳過這步；若是全新環境（例如換一台筆電上場），要先跑一次：
   ```bash
   ./aws/zoning-filter/prepare-data.sh
   ```
   會重新下載新北市官方 Shapefile + 反投影，比較花時間，能提前跑就提前跑。

3. **部署 Lambda**
   ```bash
   ./aws/zoning-filter/deploy.sh
   ```
   會在新帳號下全新建立 IAM 角色（`ntpc-zoning-filter-role`）、Lambda function、Function URL，跟舊帳號完全無關，不用手動清理舊帳號留下的東西。

4. **換前端指向的 Function URL**
   `deploy.sh` 跑完會印出新的 Function URL（域名一定跟舊帳號的不同），先用 curl 測過能打通：
   ```bash
   curl "<新的 Function URL>?lat=25.2219&lng=121.63575"
   ```
   再填進：
   - 本機 `.env` 的 `VITE_ZONING_API_URL`（改完重開 `pnpm dev`）
   - Amplify Console → 該 app → Hosting environments → Environment variables，同一個 key 更新，重新觸發部署

5. **Region**：預設 `ap-northeast-1`，跟現在一樣；只有正式帳號限定別的 region 時才需要 `export AWS_REGION=xxx` 再跑 `deploy.sh`。

**不用管的**：`public/data/zoning/ntpc-zoning.geojson` fallback 檔跟帳號無關，就算當天 Lambda 部署失敗或帳號有狀況，前端會自動退回這份資料。

**不是這份文件負責的**：`produceForms` / `exportForms` / 比較案例 / 周邊設施距離查詢是後端隊友的 Lambda（見 [`src/api/index.ts`](../src/api/index.ts) 裡的 TODO），目前是 mock，帳號置換是他那邊的事。
