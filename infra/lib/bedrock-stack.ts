import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as path from "node:path";

/**
 * BedrockStack props。
 *
 * 原本三支 Bedrock/PDF lambda 不吃任何 DB / S3,BedrockStack 是刻意隔離的。缺口①
 * (基準表數位化結果儲存/重用)新增第四支 factor-standard-store CRUD lambda,需要:
 *  - DatabaseStack 的 Aurora cluster(走 RDS Data API 存 factor_standard 表),
 *  - AssetStack 的 dataBucket(存原始基準表 PDF)。
 *
 * 這是刻意打破隔離的既定方向:之後還會在這個 stack 開其他 private lambda 讓 Bedrock
 * 透過它拉 DB 資料(例如 C-2 評分吃已存的級距),所以「BedrockStack 依賴 DB/Asset」
 * 是路線,不是要避免的副作用。CDK 依這些 props 自動建立 stack 間依賴、排序部署
 * (先 DB/Asset 後 Bedrock)。只有 factor-standard-store 那支掛 DB/S3 IAM,原三支不受影響。
 */
export interface BedrockStackProps extends cdk.StackProps {
  /** DatabaseStack 的 Aurora cluster,factor-standard-store 走 Data API 存取,並用 grantDataApiAccess 授權。 */
  readonly dbCluster: rds.IDatabaseCluster;
  /** DB 帳密 secret 的 ARN(Data API 認證用),以環境變數傳給 factor-standard-store。 */
  readonly dbSecretArn: string;
  /** 預設資料庫名稱(gis)。 */
  readonly dbName: string;
  /** AssetStack 的 dataBucket,原始基準表 PDF 存這裡(factor-standard/ 前綴)。 */
  readonly dataBucket: s3.IBucket;
  /**
   * AssetStack 前面那個 CloudFront 的 domain(OAC 讀 dataBucket + CORS 全開)。export-report 把
   * 合併好的 PDF 寫進 dataBucket 的 case-exports/ 後,用這個 domain 組下載網址回給前端。
   */
  readonly assetDistributionDomainName: string;
  /**
   * LambdaStack 的 facilities Function URL(周邊設施查詢 API)。produce-survey(表3 產製)
   * orchestrate 時要打它查比準地周邊設施 → 走 env FACILITIES_URL 注入。跨 stack 傳入
   * (LambdaStack → BedrockStack 單向,無循環),值是 CloudFormation token,CDK 自動建
   * export/import 並排序部署(先 LambdaStack 後 BedrockStack)。C-survey 只讀 env、不碰 infra。
   */
  readonly facilitiesFunctionUrl: string;
}

/**
 * BedrockStack — cli 的「AI 產草稿 → 前端編輯 → 定稿產出」雲端雛型。
 *
 * 五支 Lambda(公開 Function URL,authType NONE + CORS):
 *  - FactorStandardExtractFn(Bedrock,帶 PDF):收評價基準明細表 PDF 的 base64,
 *    用 Claude on Bedrock 抽成結構化級距/修正率 JSON。維持純抽取,不碰儲存。
 *  - DistrictSurveyDraftFn(Bedrock,純文字):收 { category },產該類可編輯的
 *    表3/表1 content JSON 草稿(一次一類避免逾時)。
 *  - FillDistrictSurveyFn(純 pdf-lib,= /api/export):收編輯後的 content JSON,
 *    用 inline 的範本 PDF/字型/coordinates 填 表1,回 base64 PDF。
 *  - FactorStandardStoreFn(缺口①,DB + S3):存/列表/取回「基準表數位化結果」,
 *    讓使用者重用之前抽好的版本,不用每次重打 Bedrock。走 RDS Data API 存
 *    factor_standard 表,原始 PDF 存 AssetStack dataBucket。與 extract 分離,
 *    「抽 → 存」串接由呼叫端負責。
 *  - CaseStoreFn(案件狀態儲存,DB only):存/取使用者定稿(流程 B/D/F)—建立案件 +
 *    表3/表4/表5 各自 upsert + 讀回。共用 DB 存取層(lambda/shared/db,Drizzle over
 *    RDS Data API)的第一個使用者,存 appraisal_case / case_survey /
 *    case_regional_factors / case_comparison 四表。不是 produce/*(不做計算),不碰 S3。
 *
 * 前三支 handler 由 scripts/build-lambdas.mjs 用 esbuild 打包成自帶依賴的 index.mjs
 * (Anthropic SDK + pdf-lib 一起 bundle;.ttf/.pdf/vocabulary .json inline);第四支
 * (factor-standard-store)只用 @aws-sdk/*(runtime 內建、external),不 bundle
 * anthropic/pdf-lib。都輸出到 build/lambda/<name>/,這裡 Code.fromAsset 直接送。
 * 部署前務必先跑 `npm run build:lambdas`。
 *
 * Bedrock 憑證走 AWS 預設 credential chain,程式不放金鑰;兩支 Bedrock function 的
 * 執行角色補 bedrock:InvokeModel(+ WithResponseStream)。第四支則掛 DB(Data API)
 * + S3 讀寫 IAM。因此本 stack 依賴 DatabaseStack / AssetStack(見 BedrockStackProps)—
 * 這是刻意的既定方向,不是要避免的副作用。
 *
 * ⚠️ 前置條件(非 code):部署帳號必須在 Bedrock console(us-west-2)對
 * us.anthropic.claude-sonnet-4-6 開通 model access,否則 Bedrock 呼叫會被擋。
 */
export class BedrockStack extends cdk.Stack {
  public readonly factorStandardFunctionUrl: string;
  public readonly regionalFactorGradingFunctionUrl: string;
  public readonly individualFactorGradingFunctionUrl: string;
  public readonly districtSurveyDraftFunctionUrl: string;
  public readonly fillDistrictSurveyFunctionUrl: string;
  public readonly fillRegionalAnalysisFunctionUrl: string;
  public readonly fillIndividualAnalysisFunctionUrl: string;
  public readonly factorStandardStoreFunctionUrl: string;
  public readonly caseStoreFunctionUrl: string;
  public readonly landValueFunctionUrl: string;
  public readonly landTransactionFunctionUrl: string;
  public readonly landLocateFunctionUrl: string;
  public readonly imageUploadFunctionUrl: string;
  public readonly produceSurveyFunctionUrl: string;
  public readonly produceRegionalFactorsFunctionUrl: string;
  public readonly produceComparisonFunctionUrl: string;
  public readonly fillReportFunctionUrl: string;
  public readonly exportReportFunctionUrl: string;

  constructor(scope: Construct, id: string, props: BedrockStackProps) {
    super(scope, id, props);

    const bundledLambdaDir = path.join(__dirname, "..", "build", "lambda");

    // --- FactorStandardExtractFn(Bedrock,帶 PDF):抽整份基準表可能數十秒,timeout
    // 放長;PDF 進 memory + Bedrock streaming,memory 給 1024。---
    const factorStandardFn = new lambda.Function(this, "FactorStandardExtractFn", {
      functionName: "ntpc-factor-standard-extract",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "factor-standard-extract")),
      memorySize: 1024,
      timeout: cdk.Duration.seconds(120),
    });
    this.grantBedrockInvoke(factorStandardFn);
    this.factorStandardFunctionUrl = this.addPublicUrl(
      factorStandardFn,
      "FactorStandardFunctionUrl",
      "factor-standard extract (Bedrock, PDF -> grading JSON)",
    );

    // --- RegionalFactorGradingFn(Bedrock,純文字):表五 區域因素評分。收 { meta, benchmark }
    // (勘查資料),一次 Bedrock 呼叫抽證據 → 依 inline 的 factor-standard 級距在 code 內判等級,
    // 回 graded JSON。factor-standard.json 已 inline;無 PDF、無 DB/S3。timeout 放長吸收模型延遲。---
    const regionalFactorGradingFn = new lambda.Function(this, "RegionalFactorGradingFn", {
      functionName: "ntpc-regional-factor-grading",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "regional-factor-grading")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
    });
    this.grantBedrockInvoke(regionalFactorGradingFn);
    this.regionalFactorGradingFunctionUrl = this.addPublicUrl(
      regionalFactorGradingFn,
      "RegionalFactorGradingFunctionUrl",
      "regional-factor grading (Bedrock, { meta, benchmark } -> graded JSON, 表五)",
    );

    // --- IndividualFactorGradingFn(Bedrock,純文字,吃 benchmark):表四 個別因素評分。姊妹版,
    // resolveGrades 以 benchmark 為第三引數補每項 display value。同樣 inline factor-standard、無 DB/S3。---
    const individualFactorGradingFn = new lambda.Function(this, "IndividualFactorGradingFn", {
      functionName: "ntpc-individual-factor-grading",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "individual-factor-grading")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
    });
    this.grantBedrockInvoke(individualFactorGradingFn);
    this.individualFactorGradingFunctionUrl = this.addPublicUrl(
      individualFactorGradingFn,
      "IndividualFactorGradingFunctionUrl",
      "individual-factor grading (Bedrock, { meta, benchmark } -> graded JSON, 表四)",
    );

    // --- DistrictSurveyDraftFn(Bedrock,純文字):一次一類,一次一次 Bedrock 呼叫;
    // timeout 放長以吸收模型延遲。---
    const districtSurveyDraftFn = new lambda.Function(this, "DistrictSurveyDraftFn", {
      functionName: "ntpc-district-survey-draft",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "district-survey-draft")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
    });
    this.grantBedrockInvoke(districtSurveyDraftFn);
    this.districtSurveyDraftFunctionUrl = this.addPublicUrl(
      districtSurveyDraftFn,
      "DistrictSurveyDraftFunctionUrl",
      "district-survey draft generator (Bedrock, { category } -> content JSON)",
    );

    // --- FillDistrictSurveyFn(純 pdf-lib,= /api/export):純運算,不需任何額外 IAM。
    // 填一頁 PDF 很快,memory 512、timeout 30s 足夠。範本/字型/coordinates 已 inline。---
    const fillDistrictSurveyFn = new lambda.Function(this, "FillDistrictSurveyFn", {
      functionName: "ntpc-fill-district-survey",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "fill-district-survey")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });
    this.fillDistrictSurveyFunctionUrl = this.addPublicUrl(
      fillDistrictSurveyFn,
      "FillDistrictSurveyFunctionUrl",
      "fill district-survey (pure pdf-lib, content JSON -> base64 PDF)",
    );

    // --- FillRegionalAnalysisFn(純 pdf-lib,表5 區域因素分析明細表 PDF;斷點3 路 B):收
    // { purpose, ...content }(purpose 選 5 種用地範本之一),填該用地表5 回 base64 PDF。純運算,
    // 不需任何額外 IAM。5 份範本 + 5 份 coordinates + 中文字型已 inline(font ~16MB,同
    // fill-district-survey 已驗證可上雲)。填一頁 PDF 很快,memory 512、timeout 30s 足夠。---
    const fillRegionalAnalysisFn = new lambda.Function(this, "FillRegionalAnalysisFn", {
      functionName: "ntpc-fill-regional-analysis",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "fill-regional-analysis")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });
    this.fillRegionalAnalysisFunctionUrl = this.addPublicUrl(
      fillRegionalAnalysisFn,
      "FillRegionalAnalysisFunctionUrl",
      "fill regional-analysis (pure pdf-lib, { purpose, content } -> base64 PDF, 表5)",
    );

    // --- FillIndividualAnalysisFn(純 pdf-lib,表4 比較法調查估價表 個別因素 PDF;斷點3 路 B):
    // 收 content JSON 填表4 回 base64 PDF。純運算,不需任何額外 IAM。範本/字型/coordinates
    // 已 inline。填一頁 PDF 很快,memory 512、timeout 30s 足夠。---
    const fillIndividualAnalysisFn = new lambda.Function(this, "FillIndividualAnalysisFn", {
      functionName: "ntpc-fill-individual-analysis",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "fill-individual-analysis")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
    });
    this.fillIndividualAnalysisFunctionUrl = this.addPublicUrl(
      fillIndividualAnalysisFn,
      "FillIndividualAnalysisFunctionUrl",
      "fill individual-analysis (pure pdf-lib, content JSON -> base64 PDF, 表4)",
    );

    // --- FactorStandardStoreFn(缺口①,DB + S3):存/列表/取回「基準表數位化結果」,
    // 讓使用者重用之前抽好的版本,不用每次重打 Bedrock。DB 走 RDS Data API 存 gis 的
    // factor_standard 表,原始 PDF 存 AssetStack dataBucket(factor-standard/ 前綴)。
    // 只用 @aws-sdk/*(runtime 內建),bundle 很小(只帶 pg 供本機測試);純 CRUD + 一次
    // S3 PutObject,memory 512、timeout 30s 足夠。---
    const factorStandardStoreFn = new lambda.Function(this, "FactorStandardStoreFn", {
      functionName: "ntpc-factor-standard-store",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "factor-standard-store")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        // Data API(不進 VPC),存取 DatabaseStack 的 gis DB。
        FACTOR_STANDARD_DB_DRIVER: "data-api",
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
        // 原始 PDF 存 AssetStack dataBucket 的 factor-standard/ 前綴下。
        ASSET_BUCKET: props.dataBucket.bucketName,
        S3_PREFIX: "factor-standard",
      },
    });

    // rds-data:ExecuteStatement / BatchExecuteStatement + 讀 credentials secret,scope 到
    // 這個 cluster / secret(同 LambdaStack 對 facilities 的授權)。
    props.dbCluster.grantDataApiAccess(factorStandardStoreFn);
    // 存原始 PDF(PutObject)+ 之後可能取回(GetObject);dataBucket 是 private,靠這條 IAM。
    props.dataBucket.grantReadWrite(factorStandardStoreFn);

    this.factorStandardStoreFunctionUrl = this.addPublicUrl(
      factorStandardStoreFn,
      "FactorStandardStoreFunctionUrl",
      "factor-standard store/list/get (Data API + S3; reuse digitized results)",
    );

    // --- CaseStoreFn(案件狀態儲存 CRUD,DB only):存/取使用者定稿(流程 B/D/F)。共用 DB
    // 存取層(lambda/shared/db,Drizzle over RDS Data API)的第一個使用者。建立案件 +
    // 表3/表4/表5 各自 upsert + 讀回,全走 gis 的 appraisal_case / case_survey /
    // case_regional_factors / case_comparison 四表。不是 produce/*(不做計算),也不碰 S3
    // (故不 grant bucket、不帶 ASSET_BUCKET/S3_PREFIX)。drizzle 已 bundle 進 handler,
    // @aws-sdk/* 維持 runtime external;純 CRUD,memory 512、timeout 30s 足夠。---
    const caseStoreFn = new lambda.Function(this, "CaseStoreFn", {
      functionName: "ntpc-case-store",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "case-store")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        // 共用 DB 層固定走 Data API,讀這三個值(無 per-lambda driver 開關)。
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
      },
    });

    // rds-data:ExecuteStatement + 讀 credentials secret,scope 到這個 cluster / secret
    // (同 FactorStandardStoreFn / facilities 的授權)。case-store 不碰 S3,故不 grant bucket。
    props.dbCluster.grantDataApiAccess(caseStoreFn);

    this.caseStoreFunctionUrl = this.addPublicUrl(
      caseStoreFn,
      "CaseStoreFunctionUrl",
      "case-store create/patch/save-final/get/list (Data API; appraisal case + 三表 定稿)",
      // 案件 metadata 的局部更新走 PATCH ?caseId=;唯一需要額外方法的 function URL。
      [lambda.HttpMethod.PATCH],
    );

    // --- LandValueFn(= GET /api/land/value):土地公告地價/現值查詢 + 年度比較。
    // 給 段小段 + 地號,回最近年 vs 前一年公告現值/地價 + 漲幅%(比較法「土地正常單價」來源)。
    // 資料存 gis 的 land_official_value(99~115 年,每年百萬列走 aws_s3 匯入);查詢走
    // 共用 DB 層(Data API),同 case-store 給 DB env + grantDataApiAccess,不碰 S3。
    // memory 512、timeout 30s。---
    const landValueFn = new lambda.Function(this, "LandValueFn", {
      functionName: "ntpc-land-value",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "land-value")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
      },
    });
    props.dbCluster.grantDataApiAccess(landValueFn);
    this.landValueFunctionUrl = this.addPublicUrl(
      landValueFn,
      "LandValueFunctionUrl",
      "land-value (Data API; 公告地價/現值查詢 + 年度比較)",
    );

    // --- LandTransactionFn(= GET /api/land/transaction):實價登錄土地交易歷史查詢。
    // 給 行政區 + 段小段,回該段歷史交易案例(依交易日期排序,預設只回土地);比較法
    // 「交易日期 / 歷史交易案例」來源。資料存 gis 的 land_transaction(~5.7 萬列走
    // seed-cloud Data API batch);查詢走共用 DB 層(Data API),同上給 env + grantDataApiAccess。
    // memory 512、timeout 30s。---
    const landTransactionFn = new lambda.Function(this, "LandTransactionFn", {
      functionName: "ntpc-land-transaction",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "land-transaction")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
      },
    });
    props.dbCluster.grantDataApiAccess(landTransactionFn);
    this.landTransactionFunctionUrl = this.addPublicUrl(
      landTransactionFn,
      "LandTransactionFunctionUrl",
      "land-transaction (Data API; 實價登錄土地交易歷史查詢)",
    );

    // --- LandLocateFn(= GET /api/land/locate):地籍定位。⚠️ DEPRECATED —— 新功能改接
    // LandEasymapFn(NtlandLambdaStack)。本支幾何只有公有土地,私有地地號查不到、只能退段
    // 中心點,估價實務上的比較標的大多是私有地。這裡刻意**不拆**:唯一還贏的是真實宗地
    // polygon 邊界(easymap 只有定位點),前端地籍圖層可能還要;拆了舊呼叫也會直接 404。
    // 給 (區, 段名 或 段代碼, 地號),回經緯度 + 宗地 polygon + bbox;查不到地號時退回段
    // 中心點並標 precision:"section"(保證永遠有答案)。同時餵 produce-survey 的
    // benchmarkLocation 與前端地籍圖層。資料存 gis 的 land_section / land_parcel
    // (22.8 萬列公有地宗地,走 aws_s3 匯入,見 README 步驟 2e);查詢走共用 DB 層
    // (Data API),同上給 env + grantDataApiAccess。memory 512、timeout 30s。---
    const landLocateFn = new lambda.Function(this, "LandLocateFn", {
      functionName: "ntpc-land-locate",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "land-locate")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
      },
    });
    props.dbCluster.grantDataApiAccess(landLocateFn);
    this.landLocateFunctionUrl = this.addPublicUrl(
      landLocateFn,
      "LandLocateFunctionUrl",
      "land-locate [DEPRECATED — use LandEasymapFunctionUrl] (Data API; 段/地號 → 經緯度 + 宗地邊界)",
    );

    // === 線 B:五支對外端點 lambda 的 infra 接線(image-upload / produce-survey /
    // produce-regional-factors / produce-comparison / fill-report)。皆已實作真邏輯
    // (非 STUB)。都不走 Bedrock(不呼叫 grantBedrockInvoke),Bedrock 評分由它們 HTTP
    // 呼叫上面的 grading Function URL 完成。 ===

    // --- ImageUploadFn(流程 G,S3):案件圖片上傳/列表(已實作)。POST 上傳圖片、GET ?caseId=
    // 列該案圖片。S3 IAM + env 給足(dataBucket.grantReadWrite + ASSET_BUCKET/S3_PREFIX,
    // case-images 前綴)。只用 @aws-sdk/client-s3(runtime 內建、external),bundle 很小。
    // memory 512、timeout 30s。匯出時把圖片併入報告 PDF 由 fill-report 匯出串接負責。---
    const imageUploadFn = new lambda.Function(this, "ImageUploadFn", {
      functionName: "ntpc-image-upload",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "image-upload")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(30),
      environment: {
        // 圖片存 AssetStack dataBucket 的 case-images/ 前綴下。
        ASSET_BUCKET: props.dataBucket.bucketName,
        S3_PREFIX: "case-images",
      },
    });
    // 上傳(PutObject)+ 列表/取回(List/GetObject);dataBucket 是 private,靠這條 IAM。
    props.dataBucket.grantReadWrite(imageUploadFn);
    this.imageUploadFunctionUrl = this.addPublicUrl(
      imageUploadFn,
      "ImageUploadFunctionUrl",
      "image-upload (S3; 案件圖片上傳/列表)",
    );

    // --- ProduceSurveyFn(表3 產製對外端點,流程 ①;已實作):orchestrate
    // district-survey-draft + facilities 組 ProduceSurveyResponse。預留 DB env +
    // grantDataApiAccess(props 已有),供未來讀 case 用,免回頭改 infra。
    // memory 512、timeout 60s —— draft 要吃 facilities 的結果當事實依據,兩個上游改為序列
    // (facilities 10s + 8 類 draft 並行 45s),30s 已經不夠用。---
    const produceSurveyFn = new lambda.Function(this, "ProduceSurveyFn", {
      functionName: "ntpc-produce-survey",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "produce-survey")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
      environment: {
        // 預留:未來走共用 DB 層(Data API)讀 case / section 資料。
        DB_CLUSTER_ARN: props.dbCluster.clusterArn,
        DB_SECRET_ARN: props.dbSecretArn,
        DB_NAME: props.dbName,
        // C-survey orchestration 的兩個上游 Function URL(HTTP 呼叫,不需 IAM):
        //   - facilities(周邊設施查詢,LambdaStack)跨 stack 傳入;
        //   - district-survey-draft(Bedrock 產草稿)是本 stack 上面剛建的那支,直接取其 URL。
        // 兩支都開 public Function URL(authType NONE),produce-survey 用 fetch 直打即可。
        FACILITIES_URL: props.facilitiesFunctionUrl,
        DISTRICT_SURVEY_DRAFT_URL: this.districtSurveyDraftFunctionUrl,
      },
    });
    // 預留 Data API 授權(同 CaseStoreFn / FactorStandardStoreFn 的用法),供 C-survey 直接用。
    props.dbCluster.grantDataApiAccess(produceSurveyFn);
    this.produceSurveyFunctionUrl = this.addPublicUrl(
      produceSurveyFn,
      "ProduceSurveyFunctionUrl",
      "produce-survey (= /api/produce/survey; 表3 產製; orchestrate draft + facilities)",
    );

    // --- ProduceRegionalFactorsFn(表5 產製對外端點,流程 ②;v2 合併鏈):對「比準地 + N 個
    // 比較標的」各自的表1 打 regional-factor-grading(同 stack,上面已建),再用 cli
    // gradingComparison 的 buildFillReport 合成含比較標的的區域比較 → RegionalFactorRow[]。
    // 只 HTTP 呼叫 grading Function URL(authType NONE,無需 IAM);純運算,無 DB。memory 512、
    // timeout 120s(內含多次 Bedrock 評分)。REGIONAL_FACTOR_GRADING_URL 引用上面剛建的那支。---
    const produceRegionalFactorsFn = new lambda.Function(this, "ProduceRegionalFactorsFn", {
      functionName: "ntpc-produce-regional-factors",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "produce-regional-factors")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      environment: {
        REGIONAL_FACTOR_GRADING_URL: this.regionalFactorGradingFunctionUrl,
      },
    });
    this.produceRegionalFactorsFunctionUrl = this.addPublicUrl(
      produceRegionalFactorsFn,
      "ProduceRegionalFactorsFunctionUrl",
      "produce-regional-factors (= /api/produce/regional-factors; 表5 產製; v2 合併鏈)",
    );

    // --- ProduceComparisonFn(表4 比較法,流程 ③,E;v2 合併鏈):對「比準地 + N 個比較標的」
    // 各自的表1 打 individual-factor-grading(同 stack,上面已建),cli individualComparison
    // 的 buildFillReport 合成 comparison(delta = 修正率%),打 land-transaction(同 stack)取
    // 正常單價,依價格鏈算試算價 → ProduceComparisonResponse。只 HTTP 呼叫兩支 Function URL
    // (authType NONE,無需 IAM);純運算,無 DB。timeout 120s(內含多次 Bedrock 評分)。
    // INDIVIDUAL_FACTOR_GRADING_URL / LAND_TRANSACTION_URL 引用上面已建的那兩支。---
    const produceComparisonFn = new lambda.Function(this, "ProduceComparisonFn", {
      functionName: "ntpc-produce-comparison",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "produce-comparison")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      environment: {
        INDIVIDUAL_FACTOR_GRADING_URL: this.individualFactorGradingFunctionUrl,
        LAND_TRANSACTION_URL: this.landTransactionFunctionUrl,
      },
    });
    this.produceComparisonFunctionUrl = this.addPublicUrl(
      produceComparisonFn,
      "ProduceComparisonFunctionUrl",
      "produce-comparison (= /api/produce/comparison; 表4 比較法; v2 合併鏈)",
    );

    // --- FillReportFn(流程 H,純 pdf-lib):匯出用 PDF 合併器 —— 收各段已產好的 PDF,依序
    // 用 copyPages 合併成同一份回傳。斷點3 路 B:表1 由 fill-district-survey、表5 由
    // fill-regional-analysis、表4 由 fill-individual-analysis 於後端產(皆本 stack,上面已建);
    // 三張地圖仍為 Leaflet 只能瀏覽器產、圖片由 image-upload 取回轉頁,由匯出串接彙整後丟本支。
    // 後端只負責合併,不重畫版式。純運算,無額外 IAM/env;bundle pdf-lib(合併不需字型/範本)。
    // 合併多頁 PDF 可能較久,timeout 給 60s、memory 512。---
    const fillReportFn = new lambda.Function(this, "FillReportFn", {
      functionName: "ntpc-fill-report",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "fill-report")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(60),
    });
    this.fillReportFunctionUrl = this.addPublicUrl(
      fillReportFn,
      "FillReportFunctionUrl",
      "fill-report (pdf-lib; 匯出用 PDF 合併器; 收各段 PDF 合併成一份)",
    );

    // --- ExportReportFn(流程 H,匯出報告 orchestrator = /api/export;斷點3 路 B 串接者):
    // 對表1/表2/表3 各打對應填表 lambda 取 PDF、併入前端附的三張地圖、圖片轉頁(s3Keys 直讀
    // dataBucket,或 caseId 經 image-upload),在本支用 pdf-lib 依報告順序合併,寫進 dataBucket 的
    // case-exports/,回 JSON { url }(url 走 AssetStack 的 CloudFront)讓前端下載。
    // 不再經 fill-report 合併:所有段落 base64 塞同一個請求會超過 Function URL 6 MB 上限;PDF 也不放
    // 回應裡,因為 Function URL 回應同樣 6 MB 上限。
    // S3 只開 case-images/* 讀取(= image-upload 的上傳前綴),s3Keys 讀不到其他前綴;寫入只開 case-exports/*。
    // 內含數次填表 + 合併,timeout 給 120s、memory 512。三個 FILL_*_URL / IMAGE_UPLOAD_URL 皆引用上面已建的那幾支。---
    const exportReportFn = new lambda.Function(this, "ExportReportFn", {
      functionName: "ntpc-export-report",
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(bundledLambdaDir, "export-report")),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      environment: {
        FILL_DISTRICT_SURVEY_URL: this.fillDistrictSurveyFunctionUrl,
        FILL_REGIONAL_ANALYSIS_URL: this.fillRegionalAnalysisFunctionUrl,
        FILL_INDIVIDUAL_ANALYSIS_URL: this.fillIndividualAnalysisFunctionUrl,
        IMAGE_UPLOAD_URL: this.imageUploadFunctionUrl,
        ASSET_BUCKET: props.dataBucket.bucketName,
        REPORT_PUBLIC_BASE_URL: `https://${props.assetDistributionDomainName}`,
      },
    });
    props.dataBucket.grantRead(exportReportFn, "case-images/*");
    props.dataBucket.grantPut(exportReportFn, "case-exports/*");
    this.exportReportFunctionUrl = this.addPublicUrl(
      exportReportFn,
      "ExportReportFunctionUrl",
      "export-report (= /api/export; 匯出報告 orchestrator; 表1/2/3 填表 + 地圖 + 圖片 -> 合併寫 S3,回 CloudFront 下載網址)",
    );
  }

  /**
   * 給一支 function 呼叫 Bedrock 的 IAM。model 是 cross-region inference profile
   * (us.anthropic.claude-sonnet-4-6),這類 profile 通常需要同時授權 inference profile
   * ARN 與其底層各 region 的 foundation-model ARN。這裡先用較寬但仍 scope 到 anthropic
   * claude 的 resource(profile + foundation-model),之後可再收斂到單一 model id。
   */
  private grantBedrockInvoke(fn: lambda.Function): void {
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          // cross-region inference profile(帳號範圍),us. 前綴的 anthropic claude profiles
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-*`,
          // profile 底層各 region 的 foundation model(帳號無關,region 用 * 覆蓋跨區推論)
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-*",
        ],
      }),
    );
  }

  /**
   * 建一個公開 Function URL(authType NONE + CORS,POST + OPTIONS,allowedHeaders 含
   * content-type),輸出成 CfnOutput。CDK 會自動補上 InvokeFunctionUrl + InvokeFunction
   * 兩條 resource policy。回傳的 JSON 或 base64 PDF 靠 handler 自己設 isBase64Encoded,
   * Function URL 會自動 decode 回 client。
   *
   * `extraMethods` 給少數需要 GET/POST/PUT 以外方法的 function(目前只有 case-store 的
   * PATCH)。刻意不把它加進共用預設:CORS 只該開實際有 handler 的方法。
   */
  private addPublicUrl(
    fn: lambda.Function,
    outputId: string,
    label: string,
    extraMethods: lambda.HttpMethod[] = [],
  ): string {
    const fnUrl = fn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [
          lambda.HttpMethod.POST,
          lambda.HttpMethod.GET,
          lambda.HttpMethod.PUT,
          ...extraMethods,
        ],
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
