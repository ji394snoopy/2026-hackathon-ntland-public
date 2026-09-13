import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  ZONING_ATTRIBUTION,
  ZONING_FALLBACK_URL,
  ZONING_LEGEND,
  buildZoningApiUrl,
  calloutIcon,
  findZoneFeatureAt,
  getComparableCaseMarker,
  getSectionBoundary,
  nearbyFeatureFilter,
  zoneColor,
} from "../lib/officialMap";
import { PrintableMapPage, PrintableZoningLegend } from "./PrintableMapPage";

type ZoningGeoJson = GeoJSON.FeatureCollection<
  GeoJSON.Geometry,
  {
    ZONE?: string;
  }
>;

const API_TIMEOUT_MS = 4000;

// 依座標打 Lambda 篩選 API；沒設定或逾時/失敗就退回本地全市簡化檔（前端再篩一次附近範圍）
async function loadZoningGeoJson(center: {
  lat: number;
  lng: number;
}): Promise<ZoningGeoJson> {
  const apiUrl = buildZoningApiUrl(center);
  if (apiUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
      const res = await fetch(apiUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return await res.json();
    } catch {
      // 打不到 API，往下退回本地檔案
    }
  }

  const res = await fetch(ZONING_FALLBACK_URL);
  if (!res.ok) throw new Error(`zoning fallback fetch failed: ${res.status}`);
  const geojson: ZoningGeoJson = await res.json();
  return {
    ...geojson,
    features: geojson.features.filter(nearbyFeatureFilter(center)),
  };
}

// 完全比照官方紙本「土地徵收市價查估地價使用分區圖」版式的輸出用元件（供 html2canvas 擷取列印/PDF）；
// 與畫面版 ZoningMap 的差異：無縮放控制／互動點選、無畫面用資料來源側欄，圖例改為右下角固定圖例框。
export default function PrintableZoningMap({
  result,
  onReady,
}: {
  result: ProduceResult;
  onReady?: () => void;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };
  const [usedLegend, setUsedLegend] = useState(ZONING_LEGEND);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([center.lat, center.lng], 16);
    mapRef.current = map;

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: `${NLSC_ATTRIBUTION}｜${ZONING_ATTRIBUTION}`,
      maxZoom: 19,
      opacity: 0.5,
    }).addTo(map);

    const sectionBoundary = getSectionBoundary(center);
    let sectionLayer: L.Polygon | L.GeoJSON = L.polygon(sectionBoundary, {
      color: "#1E4FD8",
      weight: 2.5,
      fill: false,
    }).addTo(map);
    L.marker(sectionBoundary[1], {
      icon: calloutIcon(`區段${result.meta.sectionId}`, "#1E4FD8", "right"),
    }).addTo(map);

    loadZoningGeoJson(center)
      .then((geojson) => {
        const usedColors = new Set<string>();
        L.geoJSON(geojson, {
          style: (feature) => {
            const color = zoneColor(feature?.properties?.ZONE);
            if (color) usedColors.add(color);
            return {
              color: "#9CA3AF",
              weight: 0.5,
              fillColor: color ?? "#FFFFFF",
              fillOpacity: color ? 0.6 : 0,
            };
          },
        }).addTo(map);
        setUsedLegend(
          ZONING_LEGEND.filter((item) => usedColors.has(item.color)),
        );

        const sectionFeature = findZoneFeatureAt(geojson, center);
        if (sectionFeature) {
          map.removeLayer(sectionLayer);
          sectionLayer = L.geoJSON(sectionFeature, {
            style: { color: "#1E4FD8", weight: 2.5, fill: false },
          }).addTo(map);
          const zoningBounds = sectionLayer.getBounds();
          [
            result.comparisonForm.cases[0]?.latLng ??
              getComparableCaseMarker(center),
            result.comparisonForm.cases[1]?.latLng,
            result.comparisonForm.cases[2]?.latLng,
          ].forEach((pt) => {
            if (pt) zoningBounds.extend([pt.lat, pt.lng]);
          });
          map.fitBounds(zoningBounds, {
            paddingTopLeft: [50, 50],
            paddingBottomRight: [50, 50],
            animate: false,
          });
        }
        setIsDataLoaded(true);
        onReady?.();
      })
      .catch(() => {
        // 分區資料載入失敗：維持旋轉矩形佔位框，圖上其餘標示照常顯示
        setIsDataLoaded(true);
        onReady?.();
      });

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
      title={`${result.meta.district}土地徵收市價查估地價使用分區圖`}
      legendColor="#1E4FD8"
      mapRef={mapNodeRef}
      sideLegend={<PrintableZoningLegend items={usedLegend} />}
    />
  );
}
