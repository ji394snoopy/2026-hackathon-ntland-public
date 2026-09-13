#!/bin/bash

# 都市計畫土地使用分區 - 座標篩選 Lambda 部署腳本
# 資料存在部署包裡（不用 S3），前端打 Function URL 帶 lat/lng 查詢附近範圍

set -e

FUNCTION_NAME="ntpc-zoning-filter"
REGION="${AWS_REGION:-ap-northeast-1}"
RUNTIME="nodejs20.x"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🚀 zoning-filter Lambda 部署開始"
echo "=================================="

if ! command -v aws &> /dev/null; then
    echo "❌ 錯誤: AWS CLI 未安裝"
    exit 1
fi

# 2025-10 起 Function URL 匿名存取要求 resource policy 同時有 InvokeFunctionUrl 與
# InvokeFunction（帶 InvokedViaFunctionUrl 條件）兩條 statement，後者要用
# --invoked-via-function-url 這個旗標，舊版 CLI（實測 aws-cli/2.15.26 沒有）不支援，
# 加不進去也不會噴錯（因為腳本原本用 || true 吞掉），現象是 Function URL 永遠 403，
# 但 authenticated invoke 又完全正常，很容易誤判成帳號層級的 SCP/RCP 問題
if ! aws lambda add-permission help 2>&1 | grep -q -- "--invoked-via-function-url"; then
    echo "❌ 錯誤: 目前的 aws CLI（$(aws --version 2>&1)）不支援 --invoked-via-function-url"
    echo "   Function URL 匿名存取一定會卡在 403，但 aws lambda invoke 直接呼叫沒事，容易誤判成帳號權限問題"
    echo "   請升級：pip install --upgrade awscli，或 brew upgrade awscli"
    exit 1
fi

if [ ! -f "$DIR/zoning-data.geojson" ]; then
    echo "❌ 錯誤: 找不到 $DIR/zoning-data.geojson"
    echo "   請先把簡化過的新北市使用分區 GeoJSON 放到這個路徑再部署"
    exit 1
fi

echo "📦 第一步：打包部署檔（zoning-data.geojson 約 278MB，最大壓縮後預期在 40MB 上下）..."
ZIP_PATH="$DIR/function.zip"
rm -f "$ZIP_PATH"
(cd "$DIR" && zip -q -9 -r "$ZIP_PATH" index.mjs zoning-data.geojson)
ZIP_SIZE_BYTES=$(stat -f%z "$ZIP_PATH" 2>/dev/null || stat -c%s "$ZIP_PATH")
echo "✅ 打包完成：$(du -h "$ZIP_PATH" | cut -f1)"
if [ "$ZIP_SIZE_BYTES" -gt 50000000 ]; then
    echo "⚠️  警告：壓縮後超過 50MB，Lambda CLI 無法直接上傳，需先傳 S3 再用 --s3-bucket/--s3-key 部署"
    echo "   （這份腳本目前走的是直接上傳路徑，超過會在下一步失敗）"
fi
echo ""

echo "🔎 第二步：確認 IAM 執行角色..."
ROLE_NAME="ntpc-zoning-filter-role"
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query "Role.Arn" --output text 2>/dev/null || echo "")

if [ -z "$ROLE_ARN" ]; then
    echo "建立新的執行角色..."
    TRUST_POLICY='{
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": { "Service": "lambda.amazonaws.com" },
          "Action": "sts:AssumeRole"
        }
      ]
    }'
    echo "$TRUST_POLICY" > /tmp/trust-policy.json
    ROLE_ARN=$(aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file:///tmp/trust-policy.json \
        --query "Role.Arn" --output text)
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
    rm /tmp/trust-policy.json
    echo "✅ 角色已建立：$ROLE_ARN"
    echo "⏳ 等待 IAM 角色生效..."
    sleep 10
else
    echo "✅ 角色已存在：$ROLE_ARN"
fi
echo ""

echo "⚡ 第三步：建立或更新 Lambda function..."
if aws lambda get-function --function-name "$FUNCTION_NAME" --region "$REGION" &>/dev/null; then
    echo "已存在，更新程式碼..."
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file "fileb://$ZIP_PATH" \
        --region "$REGION" > /dev/null
    aws lambda wait function-updated --function-name "$FUNCTION_NAME" --region "$REGION"
    aws lambda update-function-configuration \
        --function-name "$FUNCTION_NAME" \
        --timeout 15 \
        --memory-size 1536 \
        --region "$REGION" > /dev/null
else
    echo "建立新 function..."
    aws lambda create-function \
        --function-name "$FUNCTION_NAME" \
        --runtime "$RUNTIME" \
        --role "$ROLE_ARN" \
        --handler index.handler \
        --zip-file "fileb://$ZIP_PATH" \
        --timeout 15 \
        --memory-size 1536 \
        --region "$REGION" > /dev/null
fi
echo "✅ Lambda function 已就緒"
echo ""

echo "🌐 第四步：設定 Function URL（含 CORS）..."
FUNCTION_URL=$(aws lambda get-function-url-config \
    --function-name "$FUNCTION_NAME" --region "$REGION" \
    --query "FunctionUrl" --output text 2>/dev/null || echo "")

if [ -z "$FUNCTION_URL" ]; then
    FUNCTION_URL=$(aws lambda create-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --cors '{"AllowOrigins":["*"],"AllowMethods":["GET"],"MaxAge":3600}' \
        --region "$REGION" \
        --query "FunctionUrl" --output text)
else
    echo "Function URL 已存在，更新設定..."
    aws lambda update-function-url-config \
        --function-name "$FUNCTION_NAME" \
        --auth-type NONE \
        --cors '{"AllowOrigins":["*"],"AllowMethods":["GET"],"MaxAge":3600}' \
        --region "$REGION" > /dev/null
fi

# NONE auth type 需要兩條 resource policy statement 才能匿名呼叫（2025-10 起 Lambda 的新規定）：
# InvokeFunctionUrl（過 Function URL 這一關）+ InvokeFunction（實際執行函式那一關），
# 少一條都會在呼叫端拿到 403，且錯誤訊息完全看不出是少了哪一條
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id FunctionURLAllowPublicAccess \
    --action lambda:InvokeFunctionUrl \
    --principal "*" \
    --function-url-auth-type NONE \
    --region "$REGION" > /dev/null 2>&1 || true
aws lambda add-permission \
    --function-name "$FUNCTION_NAME" \
    --statement-id FunctionURLAllowPublicInvoke \
    --action lambda:InvokeFunction \
    --principal "*" \
    --invoked-via-function-url \
    --region "$REGION" > /dev/null 2>&1 || true

echo ""
echo "=================================="
echo "✅ 部署完成！"
echo "=================================="
echo ""
echo "📍 Function URL："
echo "   $FUNCTION_URL"
echo ""
echo "🧪 測試："
echo "   curl \"${FUNCTION_URL}?lat=25.2219&lng=121.63575\""
echo ""
echo "📝 把這個網址設進前端 .env："
echo "   VITE_ZONING_API_URL=${FUNCTION_URL}"
