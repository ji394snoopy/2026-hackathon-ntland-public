import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";

export interface DatabaseStackProps extends cdk.StackProps {
  /** 初始資料庫名稱(建 cluster 時建立)。預設 "gis"。 */
  readonly databaseName?: string;
  /**
   * Serverless v2 最小容量 (ACU)。預設 0.5 = 常駐最低容量,cluster 不會暫停,
   * 沒有冷啟動延遲(比賽期間為求穩定/快速用這個)。設 0 才會開啟 auto-pause /
   * scale-to-zero(閒置暫停到 0 ACU、省運算費,但暫停後首個查詢約十幾秒恢復延遲)。
   */
  readonly minCapacityAcu?: number;
  /** Serverless v2 最大容量 (ACU)。預設 2。 */
  readonly maxCapacityAcu?: number;
  /**
   * 是否建立 seed bucket 並授權 cluster 從中匯入(`aws_s3.table_import_from_s3`)。
   * 門牌 ~2M 筆走 S3 匯入用。預設 true;不需要 S3 匯入(例如只 demo pois/站點)可設
   * false 省掉這個 bucket。
   */
  readonly enableS3Import?: boolean;
}

/**
 * PostGIS 資料庫 stack — Aurora PostgreSQL Serverless v2 + RDS Data API。
 *
 * 為什麼是這個組合(而不是 RDS instance / 一般 Lambda-in-VPC):
 *  - 之後會匯入很多 opendata 大資料集(土壤圖、排水圖…),這些本質是空間查詢
 *    (point-in-polygon / 最近鄰),交給 PostGIS + GiST 索引最合適,查詢時完全
 *    不用像 CLI 那樣每次下載/解析大檔。
 *  - **Data API**:Lambda 透過 HTTPS 呼叫 RDS Data API 查 DB,不必把 Lambda 放進
 *    VPC,也就不需要常駐、要收費的 NAT Gateway 讓 Lambda 出去打外部 API。這讓
 *    DB 能無痛加進現有純 serverless 架構。
 *  - **Serverless v2**:容量隨負載縮放,預設 min 0.5 常駐(不暫停、沒有冷啟動延遲,
 *    比賽期間求穩定/快速);要省成本可把 minCapacityAcu 設 0 開啟 auto-pause(閒置
 *    暫停到 0 ACU、不收運算費用,但首個查詢有約十幾秒恢復延遲)。
 *    hackathon 用完 `cdk destroy` 就清掉(注意會刪資料,見下 removalPolicy)。
 *
 * Aurora cluster 一定要住在 VPC,但這裡用「只有 isolated subnet、沒有 NAT」的最小
 * VPC:DB 不需要對外連線,Lambda 也不進 VPC(走 Data API),所以不用 NAT。
 *
 * PostGIS 擴充不是建 cluster 時自動裝的,要連進 DB 執行一次
 * `CREATE EXTENSION IF NOT EXISTS postgis;`(見 README 的 bootstrap 說明 / 可用
 * Data API 一行 execute-statement 完成)。
 */
export class DatabaseStack extends cdk.Stack {
  public readonly cluster: rds.DatabaseCluster;
  /** cluster ARN,Lambda 用 Data API 時需要。 */
  public readonly clusterArn: string;
  /** 存 DB 主帳密的 Secrets Manager secret ARN,Data API 需要。 */
  public readonly secretArn: string;
  public readonly databaseName: string;
  /**
   * seed bucket:放要用 `aws_s3.table_import_from_s3` 匯入的來源檔(門牌 CSV…)。
   * 只有 `enableS3Import`(預設 true)時才建立,否則為 undefined。
   */
  public readonly seedBucket?: s3.Bucket;

  constructor(scope: Construct, id: string, props: DatabaseStackProps = {}) {
    super(scope, id, props);

    this.databaseName = props.databaseName ?? "gis";
    // 預設 0.5:常駐最低容量,cluster 不暫停、沒有冷啟動延遲(比賽期間求穩定/快速)。
    // 要省成本可把 minCapacityAcu 設 0 開啟 auto-pause(閒置暫停到 0 ACU、不收運算費用,
    // 但首個查詢約十幾秒恢復延遲;需 aws-cdk-lib >= 2.178 與近期 Aurora PostgreSQL 修訂版)。
    const minCapacity = props.minCapacityAcu ?? 0.5;
    const maxCapacity = props.maxCapacityAcu ?? 2;

    // 最小 VPC:2 個 AZ、只開 isolated subnet、不建 NAT Gateway(0 個),避免 NAT
    // 的常駐費用。DB 只在 VPC 內被存取,不需要對外。
    const vpc = new ec2.Vpc(this, "DbVpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const enableS3Import = props.enableS3Import ?? true;

    // S3 Gateway Endpoint:`aws_s3.table_import_from_s3` 是「cluster 自己」從 VPC 內部
    // 連去 S3 抓物件的。這個 VPC 是 isolated subnet + 0 NAT(刻意省 NAT 費用),所以
    // 沒有 endpoint 的話 cluster 根本沒有到 S3 的路由 ——`aws_s3` 匯入就會 timeout
    // (DatabaseErrorException: Amazon S3 client returned 'timed out', SQLState 38000)。
    // Gateway Endpoint 只往 route table 加一條到 S3 的路由,是免費的(不像 NAT / Interface
    // Endpoint 要收費),正好補上 isolated subnet 連 S3 的能力,不違背省 NAT 的設計。
    // 只有要用 S3 匯入(enableS3Import)時才需要。
    if (enableS3Import) {
      vpc.addGatewayEndpoint("S3Endpoint", {
        service: ec2.GatewayVpcEndpointAwsService.S3,
        subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
      });
    }

    // Seed bucket:給 `aws_s3.table_import_from_s3` 讀來源檔(門牌 CSV 等百萬列級,不適
    // 合逐批打 Data API)。傳進 cluster 的 `s3ImportBuckets`,CDK 會自動建一個能讀這個
    // bucket 的 IAM role 並關聯到 cluster(等同手動設 `s3ImportRole`,但少一步)。
    // private(全封鎖公開存取);hackathon 用 DESTROY + autoDeleteObjects 方便清乾淨。
    const seedBucket = enableS3Import
      ? new s3.Bucket(this, "SeedBucket", {
          blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
          encryption: s3.BucketEncryption.S3_MANAGED,
          enforceSSL: true,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          autoDeleteObjects: true,
        })
      : undefined;
    this.seedBucket = seedBucket;

    // Aurora PostgreSQL Serverless v2。engine version 選 PostGIS 支援良好的近期版本;
    // 帳密由 CDK 產生並存進 Secrets Manager(Data API 要靠這個 secret 認證)。
    this.cluster = new rds.DatabaseCluster(this, "PostgisCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_17_9,
      }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      // 開啟 RDS Data API:讓 Lambda 免進 VPC、走 HTTPS 查詢。
      enableDataApi: true,
      serverlessV2MinCapacity: minCapacity,
      serverlessV2MaxCapacity: maxCapacity,
      writer: rds.ClusterInstance.serverlessV2("writer"),
      defaultDatabaseName: this.databaseName,
      credentials: rds.Credentials.fromGeneratedSecret("postgres", {
        secretName: "ntland/postgis/credentials",
      }),
      // 授權 cluster 從 seed bucket 匯入(aws_s3 extension 用)。CDK 依此建 s3Import
      // role 並掛上;`aws_s3.table_import_from_s3` 才讀得到 S3 物件。
      ...(seedBucket ? { s3ImportBuckets: [seedBucket] } : {}),
      // Hackathon 用:stack 砍掉就連 DB 一起清乾淨。正式環境請改成 RETAIN 並開快照,
      // 否則 cdk destroy 會直接刪掉資料。
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.clusterArn = this.cluster.clusterArn;
    // enableDataApi 時 secret 必定存在;! 斷言以滿足型別。
    this.secretArn = this.cluster.secret!.secretArn;

    new cdk.CfnOutput(this, "ClusterArn", {
      value: this.clusterArn,
      description: "Aurora cluster ARN — pass to Lambdas using the RDS Data API.",
    });
    new cdk.CfnOutput(this, "SecretArn", {
      value: this.secretArn,
      description: "Secrets Manager ARN holding the DB credentials (for Data API).",
    });
    new cdk.CfnOutput(this, "DatabaseName", {
      value: this.databaseName,
      description: "Default database name.",
    });
    if (seedBucket) {
      new cdk.CfnOutput(this, "SeedBucketName", {
        value: seedBucket.bucketName,
        description:
          "S3 bucket the cluster can import from (aws_s3.table_import_from_s3). Upload doorplate CSV here.",
      });
    }
  }
}
