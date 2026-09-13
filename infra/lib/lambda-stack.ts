import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "node:path";

export interface LambdaStackProps extends cdk.StackProps {
  /** AssetStack 建立的 bucket,存放 zoning geojson。 */
  readonly dataBucket: s3.IBucket;
  /** geojson 在 bucket 內的 object key。 */
  readonly zoningDataKey: string;
  /**
   * DatabaseStack 的 Aurora cluster。facilities function 走 RDS Data API 查它,
   * 用 `grantDataApiAccess` 補上 rds-data:* 與讀 secret 的 IAM。
   */
  readonly dbCluster: rds.IDatabaseCluster;
  /** DB 帳密 secret 的 ARN(Data API 認證用),以環境變數傳給 facilities。 */
  readonly dbSecretArn: string;
  /** 預設資料庫名稱(gis)。 */
  readonly dbName: string;
}

/**
 * 範例 Lambda stack。
 *
 * 目前只有一個 function:zoning-filter,示範
 *  - 從 AssetStack 的 S3 讀資料(而非把大檔塞進部署包)
 *  - 公開 Function URL(authType NONE)+ CORS,CDK 原生處理 2025-10 起
 *    需要的雙 resource-policy statement,不用像舊 deploy.sh 手動補、也不用檢查
 *    CLI 版本。
 *
 * 之後要接 cli 的 Bedrock pipeline(factorStandard / districtSurvey)時,
 * 照這個 function 的形狀新增即可,額外需要:把 cli 程式碼 + references 打包進來、
 * 在 role 上加 bedrock:InvokeModel 權限(scope 到 jp.anthropic.claude-sonnet-4-6)。
 */
export class LambdaStack extends cdk.Stack {
  public readonly zoningFunctionUrl: string;
  public readonly windFunctionUrl: string;
  public readonly baseTopoFunctionUrl: string;
  public readonly detailTopoFunctionUrl: string;
  public readonly facilitiesFunctionUrl: string;
  public readonly landEasymapFunctionUrl: string;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    // cli 的 B 類 CLI(wind / maptiles)handler 由 scripts/build-lambdas.mjs 用
    // esbuild 打包成自帶依賴的 index.mjs,輸出到 build/lambda/<name>/。這裡直接
    // Code.fromAsset 那個資料夾,沿用 zoning-filter「自帶 asset、不在部署後裝依賴」
    // 的做法。部署前務必先跑 `npm run build:lambdas`(見 package.json)。
    const bundledLambdaDir = path.join(__dirname, "..", "build", "lambda");

    const zoningFn = new lambda.Function(this, "ZoningFilterFn", {
      functionName: "ntpc-zoning-filter",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      // handler 只用到 @aws-sdk/client-s3,已內建於 nodejs22 runtime,不需 bundling。
      code: lambda.Code.fromAsset(
        path.join(__dirname, "..", "lambda", "zoning-filter"),
      ),
      // 冷啟動要把整份 geojson 讀進記憶體並建索引,給足記憶體(也連帶提高 CPU)。
      memorySize: 1536,
      timeout: cdk.Duration.seconds(15),
      environment: {
        ZONING_DATA_BUCKET: props.dataBucket.bucketName,
        ZONING_DATA_KEY: props.zoningDataKey,
      },
    });

    // 只給讀取權限;bucket 是 private,靠這條 IAM 讓 Lambda 能 GetObject。
    props.dataBucket.grantRead(zoningFn, props.zoningDataKey);

    // 公開 Function URL。CDK 會自動補上 InvokeFunctionUrl + InvokeFunction 兩條
    // resource policy,解決舊 deploy.sh 手動處理的 403 陷阱。
    const fnUrl = zoningFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.GET],
        maxAge: cdk.Duration.hours(1),
      },
    });
    this.zoningFunctionUrl = fnUrl.url;

    new cdk.CfnOutput(this, "ZoningFunctionUrl", {
      value: fnUrl.url,
      description:
        "Public Function URL for the zoning filter. Set as VITE_ZONING_API_URL in Amplify.",
    });

    // --- cli B 類 CLI:純公開 API / 讀圖層,免 AWS 憑證、免 DB。---

    // windCondition:呼叫 Open-Meteo Archive API,回近一年平均風速 + 主風向 JSON。
    // 無原生依賴、無大檔,給預設記憶體即可;對外 API 偶爾較慢,timeout 放寬到 30s。
    const windFn = new lambda.Function(this, "WindConditionFn", {
      functionName: "ntpc-wind-condition",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "wind-condition")),
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
    });
    this.windFunctionUrl = this.addPublicJsonUrl(windFn, "WindFunctionUrl", "wind condition");

    // mapTiles baseTopo(B5000 1/5000 全國基本地形圖):抓 NLSC 圖磚、用 pngjs 拼接、
    // 回傳 PNG(base64 + isBase64Encoded)。拼接吃 CPU/記憶體,radius 越大抓越多磚,
    // 給足記憶體(連帶提高 CPU)並放寬 timeout。
    const baseTopoFn = new lambda.Function(this, "MapTilesBaseFn", {
      functionName: "ntpc-maptiles-base",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "maptiles-base")),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
    });
    this.baseTopoFunctionUrl = this.addPublicJsonUrl(
      baseTopoFn,
      "BaseTopoFunctionUrl",
      "base topo map tiles (PNG)",
    );

    // mapTiles detailTopo(TOPO01K 1/1000 新北市都市計畫地形圖):同 base,額外先抓
    // GetCapabilities(413 圖層)篩出新北市 ~56 個 sheet;handler 已把解析結果快取在
    // module scope,warm 執行環境不會重抓。
    const detailTopoFn = new lambda.Function(this, "MapTilesDetailFn", {
      functionName: "ntpc-maptiles-detail",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "maptiles-detail")),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
    });
    this.detailTopoFunctionUrl = this.addPublicJsonUrl(
      detailTopoFn,
      "DetailTopoFunctionUrl",
      "detail topo map tiles (PNG, 新北市)",
    );

    // --- facilities:給範圍(polygon / center+radius),查 PostGIS 回範圍內設施 + 到
    // 中心距離 + 門牌摘要,並即時 merge NLSC 環域 API。連 DB 走 RDS Data API
    // (FACILITIES_DB_DRIVER=data-api):Lambda 不進 VPC、免 NAT,Data API 的託管連線池
    // 也避免 Lambda 高並發時直連 pg 造成的連線爆炸。handler 由 build-lambdas.mjs 打包
    // (自帶 pg;@aws-sdk/* 走 runtime 內建)。---
    const facilitiesFn = new lambda.Function(this, "FacilitiesFn", {
      functionName: "ntpc-facilities",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "facilities")),
      // 空間查詢 + merge,不吃大量記憶體;NLSC 是網路 I/O,timeout 放寬。
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        FACILITIES_DB_DRIVER: "data-api",
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
      },
    });

    // 補上 rds-data:ExecuteStatement / BatchExecuteStatement + 讀取 credentials secret
    // 的 secretsmanager:GetSecretValue,scope 到這個 cluster / secret。
    props.dbCluster.grantDataApiAccess(facilitiesFn);

    this.facilitiesFunctionUrl = this.addPublicJsonUrl(
      facilitiesFn,
      "FacilitiesFunctionUrl",
      "facilities-in-area query (PostGIS via Data API + live NLSC)",
    );

    // --- land-easymap:即時打 easymap.moi.gov.tw(地籍圖資便民系統)查單筆地號,回公告現值/
    // 公告地價 + 面積 + 宗地定位點 + 建號。跟 wind-condition 是同一類東西 —— 只往外打公開
    // 網站,**無 DB、無 S3、無 Bedrock、無 IAM**,所以住這個 stack 而不是 BedrockStack。
    // 一筆查詢要 4~5 次上游往返(token 一次性,必須序列),POST 批次又是逐筆序列送,所以
    // timeout 放到 60s;HTML/XML 解析走 cheerio(已 bundle),512MB 讓冷啟動與解析都寬裕。---
    const landEasymapFn = new lambda.Function(this, "LandEasymapFn", {
      functionName: "ntpc-land-easymap",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "land-easymap")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
    });
    this.landEasymapFunctionUrl = this.addPublicJsonUrl(
      landEasymapFn,
      "LandEasymapFunctionUrl",
      "land-easymap (live easymap.moi.gov.tw; 地號 → 公告現值/地價 + 面積 + 定位點)",
    );
  }

  /**
   * 建一個公開 Function URL(authType NONE + CORS GET),並輸出成 CfnOutput。
   *
   * 三個 cli handler 都是「GET query string -> 回應」,回傳 JSON 或
   * base64 PNG(靠 handler 自己回 isBase64Encoded,Function URL 會自動處理),所以
   * 共用同一組設定。CDK 會自動補上 InvokeFunctionUrl + InvokeFunction 兩條 resource
   * policy(2025-10 起需要),不用像舊 deploy.sh 手動補。
   */
  private addPublicJsonUrl(fn: lambda.Function, outputId: string, label: string): string {
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        // GET for the query-string endpoints; POST so facilities can take a JSON body
        // (polygon). Extra method is harmless for the GET-only handlers.
        allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
        allowedHeaders: ["content-type"],
        maxAge: cdk.Duration.hours(1),
      },
    });
    new cdk.CfnOutput(this, outputId, {
      value: fnUrl.url,
      description: `Public Function URL for ${label}.`,
    });
    return fnUrl.url;
  }
}
