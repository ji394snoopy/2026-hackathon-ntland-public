import * as path from "node:path";
import * as fs from "node:fs";
import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";

/**
 * 靜態資料 CDN。
 *
 * - 一個 private S3 bucket(全面封鎖公開存取),用來存放大型靜態資料,例如
 *   新北市使用分區 geojson。
 * - 一個 CloudFront distribution,透過 OAC(Origin Access Control)是唯一
 *   能讀這個 bucket 的來源;外界只能經 CloudFront,不能直接打 S3。
 * - 把 infra/assets/data/ 底下的檔案上傳到 bucket(BucketDeployment)。
 *
 * 前端 SPA 本體由 Amplify 部署,這個 stack 只負責「額外的大型靜態資產」。
 */
export class AssetStack extends cdk.Stack {
  /** 存放 geojson 等靜態資料的 bucket,給 LambdaStack 讀取用。 */
  public readonly dataBucket: s3.Bucket;
  /** zoning geojson 在 bucket 內的 object key,LambdaStack 用來讀資料。 */
  public readonly zoningDataKey = "data/zoning/ntpc-zoning.geojson";
  /** 對外服務靜態資產的 CloudFront domain。 */
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    this.dataBucket = new s3.Bucket(this, "DataBucket", {
      // 全面封鎖公開存取;只讓 CloudFront 經 OAC 讀取。
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // hackathon 環境:方便 cdk destroy 一鍵清乾淨。正式環境要改成 RETAIN。
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: "Static asset CDN (geojson etc.)",
      defaultBehavior: {
        // S3BucketOrigin.withOriginAccessControl 會自動建立 OAC 並在 bucket policy
        // 上加對應的允許陳述,不需要手動處理舊式 OAI。
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.dataBucket),
        viewerProtocolPolicy:
          cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // geojson 很大但不常變,讓 CloudFront 積極快取。
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        // 前端從瀏覽器直接抓 fallback geojson 時需要 CORS,交給 CloudFront 轉發
        // Origin 相關 header。
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        responseHeadersPolicy:
          cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
    });
    this.distributionDomainName = distribution.distributionDomainName;

    // 把本地 infra/assets/data/ 的檔案部署到 bucket。這個資料夾在 git 忽略,
    // geojson 由 frontend/aws/zoning-filter/prepare-data.sh 產生後複製進來
    // (見 infra/README)。若資料夾不存在或為空,BucketDeployment 會失敗,
    // 所以確保它至少有一個 .keep 檔存在。
    const localAssetDir = path.join(__dirname, "..", "assets");
    if (fs.existsSync(localAssetDir)) {
      new s3deploy.BucketDeployment(this, "DeployStaticAssets", {
        sources: [s3deploy.Source.asset(localAssetDir)],
        destinationBucket: this.dataBucket,
        distribution,
        // 只失效 data 路徑,避免整站失效浪費配額。
        distributionPaths: ["/data/*"],
        prune: false,
      });
    }

    new cdk.CfnOutput(this, "DataBucketName", {
      value: this.dataBucket.bucketName,
      description: "S3 bucket holding static data (geojson).",
    });
    new cdk.CfnOutput(this, "DistributionDomainName", {
      value: `https://${distribution.distributionDomainName}`,
      description: "CloudFront domain serving static assets.",
    });
    new cdk.CfnOutput(this, "ZoningGeoJsonUrl", {
      value: `https://${distribution.distributionDomainName}/${this.zoningDataKey}`,
      description: "Public URL of the zoning geojson (front-end fallback source).",
    });
  }
}
