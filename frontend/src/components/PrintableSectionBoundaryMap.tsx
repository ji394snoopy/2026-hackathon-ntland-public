import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  NLSC_LAND_OPENDATA_ATTRIBUTION,
  NLSC_LAND_OPENDATA_URL,
  NLSC_LANDSECT_URL,
  calloutIcon,
  getComparableCaseMarker,
  getSectionBoundary,
} from "../lib/officialMap";
import { PrintableMapPage } from "./PrintableMapPage";

// 完全比照官方紙本「土地徵收市價查估地價區段圖」版式的輸出用元件（供 html2canvas 擷取列印/PDF）；
// 與畫面版 SectionBoundaryMap 的差異：無縮放控制、無畫面用圖例／資料來源側欄，並補上畫面版缺少的
// 區段自身標籤（比照參考圖右側「區段P002-00」callout）。
export default function PrintableSectionBoundaryMap({
  result,
}: {
  result: ProduceResult;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([center.lat, center.lng], 17);
    mapRef.current = map;

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: NLSC_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    L.tileLayer(NLSC_LANDSECT_URL, { maxZoom: 19, opacity: 0.9 }).addTo(map);
    L.tileLayer(NLSC_LAND_OPENDATA_URL, {
      attribution: NLSC_LAND_OPENDATA_ATTRIBUTION,
      maxZoom: 19,
      opacity: 0.9,
    }).addTo(map);

    const sectionBoundary = getSectionBoundary(center);
    L.polygon(sectionBoundary, {
      color: "#E4292F",
      weight: 2.5,
      fill: false,
    }).addTo(map);
    L.marker(sectionBoundary[1], {
      icon: calloutIcon(`區段${result.meta.sectionId}`, "#E4292F", "right"),
    }).addTo(map);

    L.circleMarker([center.lat, center.lng], {
      radius: 4,
      color: "#B7791F",
      fillColor: "#B7791F",
      fillOpacity: 1,
    }).addTo(map);
    L.marker([center.lat, center.lng], {
      icon: calloutIcon(
        `區段${result.meta.sectionId}比準地：${result.meta.district.replace("新北市", "")}${result.meta.benchmarkParcel}（${
          result.meta.landUseType === "商業用地"
            ? "第二種商業區"
            : result.meta.landUseType
        }）`,
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

    // animate:false：off-screen 渲染供 html2canvas 擷取，未合成的內容 fitBounds 動畫常卡在轉場中途
    const allBounds: [number, number][] = [
      ...sectionBoundary,
      [comparableCase1.lat, comparableCase1.lng],
    ];
    if (result.comparisonForm.cases[1]?.latLng) {
      allBounds.push([
        result.comparisonForm.cases[1].latLng.lat,
        result.comparisonForm.cases[1].latLng.lng,
      ]);
    }
    if (result.comparisonForm.cases[2]?.latLng) {
      allBounds.push([
        result.comparisonForm.cases[2].latLng.lat,
        result.comparisonForm.cases[2].latLng.lng,
      ]);
    }
    map.fitBounds(allBounds, {
      paddingTopLeft: [50, 50],
      paddingBottomRight: [50, 50],
      animate: false,
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, result.meta.sectionId]);

  return (
    <PrintableMapPage
      title={`${result.meta.district}土地徵收市價查估地價區段圖`}
      legendColor="#E4292F"
      mapRef={mapNodeRef}
    />
  );
}
