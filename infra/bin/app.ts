#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { AssetStack } from "../lib/asset-stack";
import { BedrockStack } from "../lib/bedrock-stack";
import { DatabaseStack } from "../lib/database-stack";
import { LambdaStack } from "../lib/lambda-stack";

const app = new cdk.App();

// 部署到 us-west-2(與 shared/constants.ts 的 AWS_REGION / Bedrock 呼叫一致);
// 比賽當天換帳號時只要換 CLI 憑證,region 沿用即可(需要別的 region 時
// export CDK_DEFAULT_REGION)。
const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
};

// 靜態資料 CDN:private S3 + CloudFront(OAC),存放 geojson 等大型靜態檔。
// 前端 SPA 本體仍由 Amplify 部署,這個 stack 不碰 SPA。
const assetStack = new AssetStack(app, "NtlandAssetStack", {
  env,
  description: "Static-asset CDN (geojson etc.) served via CloudFront + private S3.",
});

// PostGIS 資料庫:Aurora PostgreSQL Serverless v2 + Data API,供匯入的 opendata
// 大資料集(門牌/交通/OSM POI…)做空間查詢。獨立成一個 stack,方便單獨部署/銷毀。
// 先建立,好把 cluster/secret 交給 LambdaStack 的 facilities function 走 Data API 查。
const databaseStack = new DatabaseStack(app, "NtlandDatabaseStack", {
  env,
  description: "PostGIS (Aurora PostgreSQL Serverless v2 + Data API) for opendata.",
});

// Lambda stack:zoning-filter(讀 S3 geojson)+ cli B 類 CLI
// (windCondition / mapTiles)+ facilities(查 PostGIS,走 Data API),都以公開
// Function URL 對外。facilities 需要 DatabaseStack 的 cluster,傳入建立依賴
// (--all 部署時 CDK 依此自動排序,先 DB 後 Lambda)。
const lambdaStack = new LambdaStack(app, "NtlandLambdaStack", {
  env,
  description:
    "zoning-filter + cli B-class CLIs (wind, map tiles) + facilities (PostGIS via Data API) as public Function URLs.",
  dataBucket: assetStack.dataBucket,
  zoningDataKey: assetStack.zoningDataKey,
  dbCluster: databaseStack.cluster,
  dbSecretArn: databaseStack.secretArn,
  dbName: databaseStack.databaseName,
});

// Bedrock stack:cli 的「AI 產草稿 → 前端編輯 → 定稿產出」雲端雛型,四支公開
// Function URL(factorStandard / districtSurvey 走 Bedrock,fillDistrictSurvey 純
// pdf-lib,factor-standard-store 走 DB + S3)。第四支(缺口①:基準表數位化結果
// 儲存/重用)需要 DatabaseStack 的 cluster/secret(走 Data API 存 factor_standard 表)
// 與 AssetStack 的 dataBucket(存原始 PDF),因此把它們當 props 傳入建立 stack 間依賴
// (--all 部署時 CDK 依此自動排序,先 DB/Asset 後 Bedrock)。這是刻意的既定方向:
// 之後還會在此 stack 開 private lambda 讓 Bedrock 拉 DB 資料。部署前先
// `npm run build:lambdas`,並確認帳號已在 Bedrock console 開通
// jp.anthropic.claude-sonnet-4-6 的 model access。
new BedrockStack(app, "NtlandBedrockStack", {
  env,
  description:
    "cli Bedrock/PDF pipeline prototype: factor-standard extract + district-survey draft (Bedrock) + fill district-survey (pdf-lib) + factor-standard-store (DB via Data API + S3), as public Function URLs.",
  dbCluster: databaseStack.cluster,
  dbSecretArn: databaseStack.secretArn,
  dbName: databaseStack.databaseName,
  dataBucket: assetStack.dataBucket,
  // export-report 把匯出 PDF 寫進 dataBucket 後,用這個 CloudFront domain 組下載網址。
  assetDistributionDomainName: assetStack.distributionDomainName,
  // produce-survey(表3 產製)orchestrate 時要打 facilities(周邊設施查詢)API。跨 stack
  // 傳入 LambdaStack 的 Function URL(單向依賴,CDK 自動排序:先 LambdaStack 後 BedrockStack)。
  facilitiesFunctionUrl: lambdaStack.facilitiesFunctionUrl,
});
