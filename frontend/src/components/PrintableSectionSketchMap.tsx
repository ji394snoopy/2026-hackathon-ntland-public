import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  calloutIcon,
  getComparableCaseMarker,
  getSectionBoundary,
  resolveSectionBoundary,
  unifiedSectionBounds,
} from "../lib/officialMap";
import { PrintableMapPage } from "./PrintableMapPage";

// 完全比照官方紙本「土地徵收市價查估地價區段略圖」版式的輸出用元件（供 html2canvas 擷取列印/PDF）；
// 與畫面版 SectionSketchMap 的差異：無縮放控制、無畫面用說明／待補側欄。
// 區段範圍／zoom·center 一律以 resolveSectionBoundary（使用分區圖）為主，跟另外兩張圖籍
// （PrintableSectionBoundaryMap／PrintableZoningMap）共用同一套 unifiedSectionBounds 公式，
// 避免三張圖各自兜 bounds 導致 zoom/center 不一致。
export default function PrintableSectionSketchMap({
  result,
  onReady,
}: {
  result: ProduceResult;
  onReady?: () => void;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([center.lat, center.lng], 16);
    mapRef.current = map;

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: NLSC_ATTRIBUTION,
      maxZoom: 19,
      opacity: 0.8,
    }).addTo(map);

    L.circleMarker([center.lat, center.lng], {
      radius: 4,
      color: "#B7791F",
      fillColor: "#B7791F",
      fillOpacity: 1,
    }).addTo(map);
    L.marker([center.lat, center.lng], {
      icon: calloutIcon(
        `區段${result.meta.sectionId}比準地：${result.meta.benchmarkParcel}`,
        "#B7791F",
      ),
    }).addTo(map);

    // 比較標的1
    const comparableCase1 =
      result.comparisonForm.cases[0]?.latLng ?? getComparableCaseMarker(center);
    L.circleMarker(comparableCase1, {
      radius: 4,
      color: "#1E4FD8",
      fillColor: "#1E4FD8",
      fillOpacity: 1,
    }).addTo(map);
    if (result.comparisonForm.cases[0]?.caseNo) {
      L.marker(comparableCase1, {
        icon: calloutIcon(
          `區段P002-00：${result.comparisonForm.cases[0].caseNo}`,
          "#1E4FD8",
          "right",
        ),
      }).addTo(map);
    }

    // 比較標的2
    if (result.comparisonForm.cases[1]?.latLng) {
      const comparableCase2 = result.comparisonForm.cases[1].latLng;
      L.circleMarker(comparableCase2, {
        radius: 4,
        color: "#059669",
        fillColor: "#059669",
        fillOpacity: 1,
      }).addTo(map);
      L.marker(comparableCase2, {
        icon: calloutIcon(
          `區段P003-00：${result.comparisonForm.cases[1].caseNo}`,
          "#059669",
          "right",
        ),
      }).addTo(map);
    }

    // 比較標的3
    if (result.comparisonForm.cases[2]?.latLng) {
      const comparableCase3 = result.comparisonForm.cases[2].latLng;
      L.circleMarker(comparableCase3, {
        radius: 4,
        color: "#DC2626",
        fillColor: "#DC2626",
        fillOpacity: 1,
      }).addTo(map);
      L.marker(comparableCase3, {
        icon: calloutIcon(
          `區段P004-00：${result.comparisonForm.cases[2].caseNo}`,
          "#DC2626",
          "right",
        ),
      }).addTo(map);
    }

    // 依序嘗試：使用分區圖近似 → 人工示意矩形（跟另兩張圖籍共用同一套解析邏輯）
    resolveSectionBoundary(center)
      .then(({ feature }) => {
        let labelPoint: [number, number];
        if (feature) {
          const layer = L.geoJSON(feature, {
            style: { color: "#E4292F", weight: 2.5, fill: false },
          }).addTo(map);
          const b = layer.getBounds();
          labelPoint = [b.getNorth(), b.getEast()];
        } else {
          const sectionBoundary = getSectionBoundary(center);
          L.polygon(sectionBoundary, {
            color: "#E4292F",
            weight: 2.5,
            fill: false,
          }).addTo(map);
          labelPoint = sectionBoundary[1];
        }
        L.marker(labelPoint, {
          icon: calloutIcon(`區段${result.meta.sectionId}`, "#E4292F", "right"),
        }).addTo(map);

        // animate:false：此元件永遠 off-screen 渲染供 html2canvas 擷取，瀏覽器不會排程該內容的合成幀，
        // 預設會有動畫的 fitBounds 常卡在轉場中途，擷取結果會是縮放/平移到一半的畫面
        map.fitBounds(
          unifiedSectionBounds(center, feature, [
            comparableCase1,
            result.comparisonForm.cases[1]?.latLng,
            result.comparisonForm.cases[2]?.latLng,
          ]),
          {
            paddingTopLeft: [50, 50],
            paddingBottomRight: [50, 50],
            animate: false,
          },
        );
        onReady?.();
      })
      .catch(() => onReady?.());

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, result.meta.sectionId]);

  return (
    <PrintableMapPage
      title={`${result.meta.district}土地徵收市價查估地價區段略圖`}
      legendColor="#E4292F"
      mapRef={mapNodeRef}
    />
  );
}
