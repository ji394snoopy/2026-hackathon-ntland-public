# 🏠 AI 不動產評估平台

React + Vite + Tailwind CSS 不動產評估管理應用

## 🚀 快速開始

### 環境準備

- Node.js 18+
- pnpm (見 `.mise.toml` 推薦版本)

### 啟動開發伺服器

```bash
# 安裝依賴
pnpm install

# 啟動開發伺服器
pnpm dev
# 訪問 http://localhost:5174
```

## 📁 專案結構

```
src/
├── main.tsx              # React 入口
├── App.tsx               # 主應用元件
├── index.css             # 全域樣式 & Tailwind
├── types.ts              # 全域型別定義
├── api/                  # API 型別與工具
├── components/           # 可復用 UI 元件
│   ├── Printable*.tsx    # PDF 列印範本
│   └── ...
├── pages/                # 應用頁面
│   ├── ComparisonAppraisalPage.tsx
│   ├── ExportPage.tsx
│   ├── MapProductionPage.tsx
│   ├── RegionalFactorPage.tsx
│   ├── SurveyFormPage.tsx
│   ├── TaskSetupPage.tsx
│   └── map/              # 地圖相關頁面
├── lib/                  # 工具函數
│   ├── exportPdf.ts      # PDF 輸出邏輯
│   └── officialMap.ts    # 地圖工具
└── mock/                 # Mock 資料

public/data/             # 靜態資料（備援分區圖）
```

## 🛠️ 技術棧

| 層面 | 技術                                   |
| ---- | -------------------------------------- |
| 框架 | React 19 + TypeScript 5.7              |
| 構建 | Vite 8 + pnpm                          |
| 樣式 | Tailwind CSS v4 + @tailwindcss/vite    |
| 地圖 | Leaflet 1.9 (NLSC 圖台)                |
| PDF  | jsPDF 4.2 + html2canvas 1.4            |
| 部署 | AWS Amplify (前端) + Lambda (座標篩選) |

## 📖 開發指南

### 核心檔案

- **`src/main.tsx`** — React 入點，導入全域樣式並掛載 `App.tsx`
- **`src/App.tsx`** — 應用路由與主邏輯
- **`src/index.css`** — Tailwind 導入與全域樣式定制
- **`vite.config.ts`** — Vite 設定 (React、Tailwind v4、`@` 別名)
- **`package.json`** — 依賴與構建指令

### 樣式系統

- 使用 **Tailwind CSS v4** 實用程式類
- 全域 CSS 與主題定制放在 `src/index.css`
- 無須 `tailwind.config.js` 或 PostCSS 設定
- 字體與 `@font-face` 規則在 `src/index.css` 定義

### 代碼規範

- 單引號或雙引號：含撇號用雙引號 (`"We're here"`)
- 轉義撇號：`'can\'t'` 會破壞構建，用 `"can't"` 替代
- JSX 標籤必須閉合，大括號平衡
- 元件預設導出 (`export default`)

## 📚 文檔導航

### 部署與基礎架構

- **[DEPLOYMENT.md](./docs/DEPLOYMENT.md)** — Amplify 前端部署 + Lambda 座標篩選，含黑客松操作流程

### 技術細節

- **[zoning-filter.md](./docs/zoning-filter.md)** — Lambda 座標篩選技術細節（架構、資料準備、常見問題）


## 🔧 主要命令

```bash
pnpm dev           # 開發伺服器 (http://localhost:5174)
pnpm build         # 生産構建
pnpm preview       # 預覽生産構建
pnpm format        # 格式化代碼 (oxfmt)
```

## 🌍 環境變數

建立 `.env.local` 設定 API 端點：

```
VITE_API_BASE_URL=https://api.example.com
VITE_ZONING_API_URL=https://xxx.lambda-url.ap-northeast-1.on.aws/
```

## 📞 運維說明

### 自動部署 (Amplify)

- GitHub push → 自動觸發構建 → CDN 上線
- Live: https://main.d23f5hgmk6uka3.amplifyapp.com/.  (目前部署在 Linda 的 aws amplify)

### Lambda 座標篩選

- 部署腳本：`aws/zoning-filter/deploy.sh`
- 備援：失敗時使用本地 GeoJSON (`public/data/zoning/ntpc-zoning.geojson`)

## 📦 依賴清單

查看 `package.json`。主要依賴：

- React 19 / React DOM 19
- Vite 8 / TypeScript 5.7
- Tailwind CSS v4
- Leaflet 1.9
- jsPDF 4.2 / html2canvas 1.4

## 🎓 新隊員入門

1. **複製專案**: `git clone`
2. **安裝依賴**: `pnpm install`
3. **啟動開發**: `pnpm dev`
4. **查看文檔**: 從 [docs/README.md](./docs/README.md) 開始

---

**最後更新**: 2025-09-03  
**Live Preview**: https://main.d23f5hgmk6uka3.amplifyapp.com/
