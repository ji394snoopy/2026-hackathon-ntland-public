// export-report 的純 PDF 組裝邏輯(無 AWS / 無網路),抽出來讓 node:test 能直接測 ——
// lambda.ts 本身 import 了 ../shared/db/mappers(目錄 import),register-ts 解不了。

import { PDFDocument } from "pdf-lib";

export interface ReportPart {
  name: string;
  pdf: Uint8Array;
}

export type AssetKind = "png" | "jpeg" | "pdf";

// 看檔頭判斷格式,不信副檔名或 S3 ContentType:image-upload 沒指定 contentType 時存成
// application/octet-stream,檔名也可能跟實際格式對不上(例如 JPEG 內容配 .png 檔名)。
export function sniffAssetKind(bytes: Uint8Array): AssetKind | null {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "pdf"; // %PDF
  }
  return null;
}

// 一個圖片/PDF 檔 -> 可併入報告的單份 PDF。PNG/JPEG 包成一頁(頁面尺寸 = 圖片像素);PDF 先 load
// 一次確認讀得開,壞檔在這裡就丟錯,由呼叫端當成「這張略過」,不會等到最後合併才讓整份報告失敗。
export async function assetToPdf(input: Uint8Array): Promise<Uint8Array> {
  // pdf-lib 的 JPEG embedder 用 new DataView(bytes.buffer) 從底層 ArrayBuffer 的第 0 byte 讀,
  // 不管 byteOffset;Node 的小 Buffer 是共用 pool 的一段,直接丟進去會讀到別人的資料
  // ("SOI not found in JPEG")。先複製成獨立的 Uint8Array。
  const bytes = new Uint8Array(input);
  const kind = sniffAssetKind(bytes);
  if (kind === "pdf") {
    // pdf-lib load 很寬鬆,亂碼開頭 %PDF 也會「成功」,壞在之後讀頁面時才炸,所以要實際數頁。
    let pageCount = 0;
    try {
      pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true })).getPageCount();
    } catch {
      // 讀不開一律當 0 頁,下面統一丟同一個錯
    }
    if (pageCount === 0) throw new Error("PDF 讀不出任何頁面");
    return bytes;
  }
  if (kind === null) throw new Error("不支援的格式(只收 PNG / JPEG / PDF)");

  const doc = await PDFDocument.create();
  const image = kind === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  return doc.save();
}

// 依序合併成一份。原本丟 fill-report 合併,但那要把所有段落 base64 塞進一個 JSON 請求,
// 圖片一多就超過 Function URL 6 MB 上限;同一段 copyPages 在這裡做即可。
export async function mergeParts(parts: ReportPart[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    let src: PDFDocument;
    try {
      src = await PDFDocument.load(part.pdf, { ignoreEncryption: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`無法讀取段落 "${part.name}" 的 PDF: ${message}`);
    }
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  return merged.save();
}
