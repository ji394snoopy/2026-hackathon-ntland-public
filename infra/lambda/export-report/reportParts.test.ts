// export-report / reportParts 單元測試(純 pdf-lib,不連網、不碰 S3)。
// 執行:npm --prefix infra run test:export-report

import assert from "node:assert/strict";
import { test } from "node:test";
import { PDFDocument } from "pdf-lib";
import { assetToPdf, mergeParts, sniffAssetKind } from "./reportParts";

// 1x1 PNG(同 e2e-journey.mjs)與 1x1 JPEG,都是真的圖檔,pdf-lib 嵌得進去。
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG_1X1 = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

async function pdfWithPages(count: number, width = 100): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < count; i++) doc.addPage([width + i, 200]);
  return doc.save();
}

async function pageWidths(pdf: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => Math.round(p.getWidth()));
}

test("sniffAssetKind 看檔頭判斷,不看副檔名", async () => {
  assert.equal(sniffAssetKind(PNG_1X1), "png");
  assert.equal(sniffAssetKind(JPEG_1X1), "jpeg");
  assert.equal(sniffAssetKind(await pdfWithPages(1)), "pdf");
  assert.equal(sniffAssetKind(Buffer.from("GIF89a")), null);
  assert.equal(sniffAssetKind(new Uint8Array([0x89])), null);
});

test("assetToPdf 把 PNG / JPEG 各包成一頁", async () => {
  assert.deepEqual(await pageWidths(await assetToPdf(PNG_1X1)), [1]);
  assert.deepEqual(await pageWidths(await assetToPdf(JPEG_1X1)), [1]);
});

test("assetToPdf 遇到 PDF 內容不變", async () => {
  const pdf = await pdfWithPages(2);
  assert.deepEqual(await assetToPdf(pdf), pdf);
});

test("assetToPdf 吃得下 Buffer pool 裡的一段(byteOffset ≠ 0)", async () => {
  // Buffer.from(base64) 小於 4 KB 會切自共用 pool;S3 / base64 解出來的 bytes 都可能長這樣。
  const pooled = Buffer.from(JPEG_1X1.toString("base64"), "base64");
  assert.notEqual(pooled.byteOffset, 0);
  assert.deepEqual(await pageWidths(await assetToPdf(pooled)), [1]);
});

test("assetToPdf 對不支援或壞掉的檔案丟錯(由呼叫端略過那張)", async () => {
  await assert.rejects(assetToPdf(Buffer.from("GIF89a....")), /不支援的格式/);
  await assert.rejects(assetToPdf(Buffer.from("%PDF-1.7 this is not a pdf")), /讀不出任何頁面/);
});

test("mergeParts 依傳入順序合併,保留每份的全部頁面", async () => {
  const merged = await mergeParts([
    { name: "table1", pdf: await pdfWithPages(2, 100) },
    { name: "image:a.png", pdf: await assetToPdf(PNG_1X1) },
    { name: "table2", pdf: await pdfWithPages(1, 300) },
  ]);
  assert.deepEqual(await pageWidths(merged), [100, 101, 1, 300]);
});

test("mergeParts 有段落讀不開時,錯誤訊息帶出段名", async () => {
  await assert.rejects(
    mergeParts([{ name: "map-1", pdf: Buffer.from("not a pdf") }]),
    /"map-1"/,
  );
});
