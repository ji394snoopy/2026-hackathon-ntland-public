import html2canvas from "html2canvas";
import jsPDF from "jspdf";

// html2canvas 對巢狀 CSS transform 的矩陣換算常出錯：Leaflet 圖磚、標記、版面全部用
// translate3d() 定位（圖磚版面一層、每張圖磚／每個標記各自再一層），html2canvas 疊加這些巢狀
// transform 時經常算錯，擷取結果會是縮放/平移錯位、甚至裁掉部分標記的畫面——即使地圖當下就在畫面上
// 也一樣，不是本元件 off-screen 擷取才有的問題。擷取前把 Leaflet 用到的 translate3d 全部攤平成
// left/top（position:absolute 本身就會建立新的 containing block，效果與 transform 相同，攤平後不影響版面），
// 讓 html2canvas 走它處理得穩定的一般定位路徑；擷取後再還原回 transform，避免影響畫面上原本的即時互動地圖。
function neutralizeLeafletTransforms(root: HTMLElement): () => void {
  const restores: (() => void)[] = [];
  const els = root.querySelectorAll<HTMLElement>(
    ".leaflet-container, .leaflet-container *",
  );
  for (const el of els) {
    const match = el.style.transform.match(
      /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px,\s*-?[\d.]+px\s*\)/,
    );
    if (!match) continue;

    const [, xStr, yStr] = match;
    const x = parseFloat(xStr);
    const y = parseFloat(yStr);
    const prevTransform = el.style.transform;
    const prevLeft = el.style.left;
    const prevTop = el.style.top;
    const prevPosition = el.style.position;

    el.style.transform = "none";
    el.style.position = prevPosition || "absolute";
    el.style.left = `${(parseFloat(prevLeft) || 0) + x}px`;
    el.style.top = `${(parseFloat(prevTop) || 0) + y}px`;

    restores.push(() => {
      el.style.transform = prevTransform;
      el.style.left = prevLeft;
      el.style.top = prevTop;
      el.style.position = prevPosition;
    });
  }
  return () => restores.forEach((restore) => restore());
}

// 擷取單一 DOM 節點並切頁附加到既有 jsPDF 文件（供單檔輸出與多份版面合併成一份 PDF 共用）；
// isFirstPageOverall 為 true 時沿用 pdf 建構時就有的第一頁，否則每個切頁前都呼叫 addPage 開新頁
// （可視 orientation 在同一份 PDF 內切換直式/橫式）
export async function appendElementToPdf(
  pdf: jsPDF,
  element: HTMLElement,
  orientation: "portrait" | "landscape",
  isFirstPageOverall: boolean,
) {
  if (document.fonts?.ready) await document.fonts.ready;

  const restoreLeafletTransforms = neutralizeLeafletTransforms(element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
  } finally {
    restoreLeafletTransforms();
  }

  let renderedPx = 0;
  let isFirstSlice = true;
  while (renderedPx < canvas.height) {
    if (!(isFirstPageOverall && isFirstSlice)) {
      pdf.addPage("a4", orientation);
    }

    const pageWidthMm = pdf.internal.pageSize.getWidth();
    const pageHeightMm = pdf.internal.pageSize.getHeight();
    const pxPerMm = canvas.width / pageWidthMm;
    const pageHeightPx = Math.floor(pageHeightMm * pxPerMm);
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);

    const pageCanvas = document.createElement("canvas");
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;
    const ctx = pageCanvas.getContext("2d");
    if (!ctx) throw new Error("無法建立畫布內容");
    ctx.drawImage(
      canvas,
      0,
      renderedPx,
      canvas.width,
      sliceHeightPx,
      0,
      0,
      canvas.width,
      sliceHeightPx,
    );

    const imgData = pageCanvas.toDataURL("image/png");
    const sliceHeightMm = sliceHeightPx / pxPerMm;
    pdf.addImage(imgData, "PNG", 0, 0, pageWidthMm, sliceHeightMm);

    renderedPx += sliceHeightPx;
    isFirstSlice = false;
  }
}

// 擷取單一 DOM 節點成一張 JPEG（base64，不含 data: 前綴）——供圖籍上傳至 image-upload
// （見 API_REFERENCE.md §G）使用，不切頁、不進 jsPDF。用 JPEG 不用 PNG：圖磚底圖 PNG 壓不小，
// 三張 scale:2 的圖籍 PNG 合計 7 MB+，併進報告後超過 export-report 回應的 6 MB 上限；JPEG 約 1.9 MB。
export async function captureElementAsJpegBase64(
  element: HTMLElement,
): Promise<string> {
  if (document.fonts?.ready) await document.fonts.ready;

  const restoreLeafletTransforms = neutralizeLeafletTransforms(element);
  let canvas: HTMLCanvasElement;
  try {
    canvas = await html2canvas(element, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
    });
  } finally {
    restoreLeafletTransforms();
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

// 將指定 DOM 節點擷取為圖像並切頁輸出成 A4 PDF（供表1勘查表、各類明細表、圖籍等版面單檔輸出使用）
export async function exportElementToPdf(
  element: HTMLElement,
  filename: string,
  options?: { orientation?: "portrait" | "landscape" },
) {
  const orientation = options?.orientation ?? "portrait";
  const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
  await appendElementToPdf(pdf, element, orientation, true);
  pdf.save(filename);
}

function loadImageSize(
  dataUrl: string,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("無法讀取圖片尺寸"));
    img.src = dataUrl;
  });
}

// 將使用者上傳的補充圖片（已是 dataUrl，無需 html2canvas 擷取 DOM）依原始比例縮放置中、
// 附加成一頁 A4 直式 PDF；供輸出頁「補充圖片」章節與一鍵輸出合併使用
export async function appendImageToPdf(
  pdf: jsPDF,
  dataUrl: string,
  isFirstPageOverall: boolean,
  caption?: string,
) {
  if (!isFirstPageOverall) {
    pdf.addPage("a4", "portrait");
  }

  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const marginMm = 10;
  const captionSpaceMm = caption ? 8 : 0;
  const maxWidthMm = pageWidthMm - marginMm * 2;
  const maxHeightMm = pageHeightMm - marginMm * 2 - captionSpaceMm;

  const { width, height } = await loadImageSize(dataUrl);
  const scale = Math.min(maxWidthMm / width, maxHeightMm / height);
  const drawWidthMm = width * scale;
  const drawHeightMm = height * scale;
  const x = (pageWidthMm - drawWidthMm) / 2;
  const y = marginMm;

  const format = dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
  pdf.addImage(dataUrl, format, x, y, drawWidthMm, drawHeightMm);

  if (caption) {
    pdf.setFontSize(9);
    pdf.text(caption, pageWidthMm / 2, y + drawHeightMm + 6, {
      align: "center",
    });
  }
}

// 依序擷取多個 DOM 節點，合併成同一份 PDF（各自保留自己的 portrait/landscape），供「一鍵輸出」用
export async function exportElementsToSinglePdf(
  items: { element: HTMLElement; orientation?: "portrait" | "landscape" }[],
  filename: string,
  onProgress?: (index: number) => void,
) {
  if (items.length === 0) return;

  const pdf = new jsPDF({
    orientation: items[0].orientation ?? "portrait",
    unit: "mm",
    format: "a4",
  });
  for (let i = 0; i < items.length; i++) {
    onProgress?.(i);
    await appendElementToPdf(
      pdf,
      items[i].element,
      items[i].orientation ?? "portrait",
      i === 0,
    );
  }
  pdf.save(filename);
}
