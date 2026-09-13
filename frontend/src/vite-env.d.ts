/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ZONING_API_URL?: string;
  readonly VITE_ZONING_LAMBDA_URL?: string;
  readonly VITE_FACILITIES_API_URL?: string;
  readonly VITE_FACILITIES_LAMBDA_URL?: string;
  readonly VITE_PRODUCE_REGIONAL_FACTORS_API_URL?: string;
  readonly VITE_PRODUCE_REGIONAL_FACTORS_LAMBDA_URL?: string;
  readonly VITE_PRODUCE_COMPARISON_API_URL?: string;
  readonly VITE_PRODUCE_COMPARISON_LAMBDA_URL?: string;
  readonly VITE_CASE_STORE_API_URL?: string;
  readonly VITE_CASE_STORE_LAMBDA_URL?: string;
  readonly VITE_IMAGE_UPLOAD_API_URL?: string;
  readonly VITE_IMAGE_UPLOAD_LAMBDA_URL?: string;
  readonly VITE_EXPORT_REPORT_API_URL?: string;
  readonly VITE_EXPORT_REPORT_LAMBDA_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
