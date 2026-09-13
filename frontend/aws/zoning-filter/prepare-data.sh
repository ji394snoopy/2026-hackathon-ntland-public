#!/bin/bash

# 準備新北市全市都市計畫土地使用分區資料
# 兩邊用同一份簡化版：
#   - public/data/zoning/ntpc-zoning.geojson  — 前端 fallback 原始檔，要進 git
#     （Amplify build 是全新 git clone，這份 ignore 掉的話部署上去會 404，故意壓到
#      GitHub 100MiB 硬限制以下——約 88MB，留了安全餘裕，不是卡在邊緣的 100.x MB）
#   - aws/zoning-filter/zoning-data.geojson   — 複製一份給 Lambda 部署包，不進 git（見 .gitignore）
# 原本想給 Lambda 用未簡化全精度版，但反投影後 278MB 超過 Lambda 250MB 解壓後大小上限，
# 所以兩邊都用簡化版；Lambda 的價值在於「伺服器端先篩選，瀏覽器只拿附近範圍」，
# 不在於精度更高，用同一份資料完全不影響這個效果
#
# 需要：curl、ditto（macOS 內建，處理 Big5 檔名用）、ogr2ogr（GDAL）
# 若無 ogr2ogr：brew install gdal

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(mktemp -d)"
SRC_URL="https://urban.planning.ntpc.gov.tw/opendataDownload/%E6%96%B0%E5%8C%97%E5%B8%82%E4%BD%BF%E7%94%A8%E5%88%86%E5%8D%80.zip"

echo "🗺️  新北市使用分區資料準備開始"
echo "=================================="

if ! command -v ogr2ogr &> /dev/null; then
    echo "❌ 錯誤: 找不到 ogr2ogr（GDAL）。macOS 可用 brew install gdal 安裝"
    echo "   或指定含 GDAL 的路徑，例如："
    echo "   export PATH=\"/Applications/Postgres.app/Contents/Versions/latest/bin:\$PATH\""
    exit 1
fi

echo "📥 第一步：下載新北市使用分區 Shapefile（原始檔約 75MB，來源：新北市城鄉發展局）..."
curl -sL -m 280 --retry 3 -o "$WORK_DIR/zoning.zip" "$SRC_URL"
echo "✅ 下載完成：$(du -h "$WORK_DIR/zoning.zip" | cut -f1)"
echo ""

echo "📂 第二步：解壓縮（檔名為 Big5 編碼，用 ditto 處理）..."
mkdir -p "$WORK_DIR/extracted"
ditto -x -k "$WORK_DIR/zoning.zip" "$WORK_DIR/extracted"
SHP_FILE=$(find "$WORK_DIR/extracted" -name "*.shp" | head -1)
if [ -z "$SHP_FILE" ]; then
    echo "❌ 錯誤: 解壓縮後找不到 .shp 檔"
    exit 1
fi
echo "✅ 解壓完成：$SHP_FILE"
echo ""

echo "🌐 第三步：反投影 TWD97/TM2(EPSG:3826) → WGS84 + 簡化幾何..."
PUBLIC_ZONING_DIR="$DIR/../../public/data/zoning"
mkdir -p "$PUBLIC_ZONING_DIR"
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -s_srs EPSG:3826 \
    -simplify 0.003 \
    -lco COORDINATE_PRECISION=5 \
    "$PUBLIC_ZONING_DIR/ntpc-zoning.geojson" "$SHP_FILE"
OUT_SIZE_BYTES=$(stat -f%z "$PUBLIC_ZONING_DIR/ntpc-zoning.geojson" 2>/dev/null || stat -c%s "$PUBLIC_ZONING_DIR/ntpc-zoning.geojson")
echo "✅ 完成：$(du -h "$PUBLIC_ZONING_DIR/ntpc-zoning.geojson" | cut -f1)（public/data/zoning/ntpc-zoning.geojson，記得確認伺服器有開 gzip，實際傳輸約 10MB）"
if [ "$OUT_SIZE_BYTES" -gt 104857600 ]; then
    echo "⚠️  警告：超過 GitHub 100MiB 硬限制，git push 會被擋，要調高 -simplify 容差重跑"
fi
echo ""

echo "📄 第四步：複製一份給 Lambda 部署包用..."
cp "$PUBLIC_ZONING_DIR/ntpc-zoning.geojson" "$DIR/zoning-data.geojson"
echo "✅ 完成：$DIR/zoning-data.geojson"
echo ""

rm -rf "$WORK_DIR"

echo "=================================="
echo "✅ 資料準備完成！"
echo "=================================="
echo ""
echo "接下來："
echo "  1. 執行 ./aws/zoning-filter/deploy.sh 部署 Lambda（需要 AWS 帳號/憑證）"
echo "  2. 前端 .env 設定 VITE_ZONING_API_URL=<deploy.sh 印出的 Function URL>"
echo "  3. 沒設定或連不上時，前端會自動退回 public/data/zoning/ntpc-zoning.geojson"
