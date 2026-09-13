// 使用者從 <input type="file">／拖放選的圖片，上傳到 G · image-upload 前的前處理。
//
// 兩個限制決定了這裡的規則（見 API_REFERENCE.md §G／§Hx）：
//   - export-report 用 pdf-lib 把圖放進 PDF，只吃 PNG／JPEG；其他格式（webp、gif…）上傳會成功，
//     但匯出時會被默默略過，所以一律在前端先轉成 JPEG。
//   - Function URL 單次請求／回應上限 6 MB，base64 再膨脹約 33%，原始檔實際上限約 4.5 MB；
//     手機現場照動輒 3–8 MB，超過就縮圖重新壓成 JPEG，而不是直接擋掉。

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
// 補充照片跟三張圖籍共用 export-report 回應的 6 MB 額度，圖籍約佔 1.9 MB，所以照片壓得比較小
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.85;

export type PreparedImage = {
  fileName: string;
  contentType: "image/png" | "image/jpeg";
  dataBase64: string;
};

// 先解碼再畫到 canvas 重新輸出 JPEG：createImageBitmap 預設會套用 EXIF 方向，手機直拍的照片
// 不會轉成橫的。PNG 透明區轉 JPEG 會變黑，先鋪白底。
async function reencodeAsJpeg(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(
      `瀏覽器無法解碼「${file.name}」（例如 HEIC），請先轉成 JPG 或 PNG 再上傳`,
    );
  }
  const scale = Math.min(1, MAX_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`「${file.name}」轉檔失敗`))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("無法讀取圖片"));
    reader.readAsDataURL(blob);
  });
}

// S3 key 是 <prefix>/<caseId>/<fileName>，同名會直接覆蓋（iOS 選多張常常全叫 image.jpg），
// 所以加時間戳＋亂數前綴。副檔名要跟實際格式一致：image-upload 列表的 contentType 是依副檔名推的，
// export-report 靠它決定用 embedPng 還是 embedJpg。
function toUploadFileName(original: string, contentType: PreparedImage["contentType"]): string {
  const ext = contentType === "image/png" ? "png" : "jpg";
  const base =
    original
      .replace(/\.[^.]*$/, "")
      .replace(/[/\\\0]/g, "_")
      .trim() || "image";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${base}.${ext}`;
}

export async function prepareImageForUpload(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`「${file.name}」不是圖片檔`);
  }
  const passthrough =
    (file.type === "image/png" || file.type === "image/jpeg") &&
    file.size <= MAX_UPLOAD_BYTES;
  const blob = passthrough ? file : await reencodeAsJpeg(file);
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new Error(`「${file.name}」壓縮後仍超過 4 MB，無法上傳`);
  }
  const contentType = blob.type as PreparedImage["contentType"];
  return {
    fileName: toUploadFileName(file.name, contentType),
    contentType,
    dataBase64: await blobToBase64(blob),
  };
}
