#!/bin/bash

# AWS Deployment Script for AI Appraisal Platform
# This script deploys the React app to S3 + CloudFront

set -e

echo "🚀 AI 不動產評估平台 AWS 部署開始"
echo "=================================="

# Configuration
PROJECT_NAME="ai-appraisal-platform"
BUCKET_NAME="${PROJECT_NAME}-$(date +%s)"
REGION="us-east-1"
BUILD_DIR="dist"

# Check if build directory exists
if [ ! -d "$BUILD_DIR" ]; then
    echo "❌ 錯誤: dist 目錄不存在，請先執行 npm run build"
    exit 1
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ 錯誤: AWS CLI 未安裝，請先安裝 AWS CLI"
    echo "詳情: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
    exit 1
fi

echo "✅ 檢查通過"
echo ""

# Step 1: Create S3 Bucket
echo "📦 第一步：創建 S3 Bucket..."
echo "S3 Bucket 名稱: $BUCKET_NAME"

aws s3 mb "s3://$BUCKET_NAME" --region "$REGION" 2>/dev/null || {
    echo "⚠️  Bucket 已存在或創建失敗，嘗試使用現有 bucket"
    BUCKET_NAME=$(aws s3 ls | grep "$PROJECT_NAME" | awk '{print $3}' | head -1)
    if [ -z "$BUCKET_NAME" ]; then
        echo "❌ 無法創建或找到 S3 Bucket"
        exit 1
    fi
}

echo "✅ S3 Bucket: $BUCKET_NAME"
echo ""

# Step 2: Enable static website hosting
echo "🌐 第二步：啟用 S3 靜態網站託管..."

aws s3 website "s3://$BUCKET_NAME" \
    --index-document index.html \
    --error-document index.html \
    --region "$REGION" 2>/dev/null || echo "⚠️  已啟用或跳過"

echo "✅ 靜態網站託管已啟用"
echo ""

# Step 3: Set bucket policy for public access
echo "🔓 第三步：設定 Bucket 公開策略..."

BUCKET_POLICY='{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::'"$BUCKET_NAME"'/*"
    }
  ]
}'

echo "$BUCKET_POLICY" > /tmp/bucket-policy.json
aws s3api put-bucket-policy --bucket "$BUCKET_NAME" --policy file:///tmp/bucket-policy.json --region "$REGION"
rm /tmp/bucket-policy.json

echo "✅ Bucket 策略已設定"
echo ""

# Step 4: Upload files to S3
echo "📤 第四步：上傳構建文件到 S3..."

aws s3 sync "$BUILD_DIR" "s3://$BUCKET_NAME" \
    --region "$REGION" \
    --delete \
    --cache-control "max-age=31536000,public" \
    --exclude "*.html" \
    --exclude "*.json"

aws s3 sync "$BUILD_DIR" "s3://$BUCKET_NAME" \
    --region "$REGION" \
    --delete \
    --cache-control "max-age=0,no-cache,no-store,must-revalidate" \
    --include "*.html" \
    --include "*.json"

echo "✅ 文件已上傳"
echo ""

# Step 5: Create CloudFront Distribution
echo "⚡ 第五步：建立 CloudFront 分佈..."

# Check if distribution already exists
DIST_ID=$(aws cloudfront list-distributions --region "$REGION" \
    --query "DistributionList.Items[?Origins.Items[0].DomainName=='$BUCKET_NAME.s3.amazonaws.com'].Id" \
    --output text 2>/dev/null | head -1)

if [ -z "$DIST_ID" ]; then
    echo "建立新的 CloudFront 分佈..."
    
    # Create distribution config
    DIST_CONFIG=$(cat <<EOF
{
  "CallerReference": "$(date +%s)",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "S3Origin",
        "DomainName": "$BUCKET_NAME.s3.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": ""
        }
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3Origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    },
    "MinTTL": 0
  },
  "CacheBehaviors": [
    {
      "PathPattern": "*.html",
      "TargetOriginId": "S3Origin",
      "ViewerProtocolPolicy": "redirect-to-https",
      "TrustedSigners": {
        "Enabled": false,
        "Quantity": 0
      },
      "ForwardedValues": {
        "QueryString": false,
        "Cookies": {
          "Forward": "none"
        }
      },
      "MinTTL": 0,
      "DefaultTTL": 0,
      "MaxTTL": 0
    }
  ],
  "Comment": "Distribution for $PROJECT_NAME",
  "Enabled": true,
  "HttpVersion": "http2",
  "DefaultRootObject": "index.html"
}
EOF
)
    
    echo "$DIST_CONFIG" > /tmp/dist-config.json
    
    DIST_CREATION=$(aws cloudfront create-distribution \
        --distribution-config file:///tmp/dist-config.json \
        --region "$REGION" 2>/dev/null || echo "failed")
    
    if [ "$DIST_CREATION" != "failed" ]; then
        DIST_ID=$(echo "$DIST_CREATION" | grep -o '"Id": "[^"]*"' | cut -d'"' -f4 | head -1)
        echo "✅ CloudFront 分佈已建立: $DIST_ID"
    else
        echo "⚠️  CloudFront 建立失敗，但 S3 已可訪問"
        DIST_ID=""
    fi
    
    rm /tmp/dist-config.json
else
    echo "✅ CloudFront 分佈已存在: $DIST_ID"
fi

echo ""
echo "=================================="
echo "✅ 部署完成！"
echo "=================================="
echo ""
echo "📍 應用地址："
echo "   S3 Website: http://$BUCKET_NAME.s3-website-$REGION.amazonaws.com"
if [ -n "$DIST_ID" ]; then
    echo "   CloudFront: https://$DIST_ID.cloudfront.net"
fi
echo ""
echo "💾 部署信息保存："
echo "   S3 Bucket: $BUCKET_NAME"
echo "   Region: $REGION"
if [ -n "$DIST_ID" ]; then
    echo "   CloudFront ID: $DIST_ID"
fi
echo ""
echo "🔄 下次部署只需執行: npm run deploy"
