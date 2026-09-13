import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  NLSC_LAND_OPENDATA_ATTRIBUTION,
  NLSC_LAND_OPENDATA_URL,
  NLSC_LANDSECT_URL,
  calloutIcon,
  getComparableCaseMarker,
  getSectionBoundary,
  resolveSectionBoundary,
} from "../../lib/officialMap";

type SectionFeature = GeoJSON.Feature<GeoJSON.Geometry, { ZONE?: string }>;
type BoundarySource = "zoning" | "synthetic";

const BOUNDARY_SOURCE_LABEL: Record<BoundarySource, string> = {
  zoning: "使用分區圖（含比準地座標之分區面，近似值）",
  synthetic: "人工旋轉矩形（未取得實際邊界）",
};

export default function SectionBoundaryMap({
  result,
}: {
  result: ProduceResult;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [sectionFeature, setSectionFeature] = useState<SectionFeature | null>(
    null,
  );
  const [boundarySource, setBoundarySource] = useState<BoundarySource | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };

  // 依序嘗試：使用分區圖近似 → 人工示意矩形
  useEffect(() => {
    setIsLoading(true);
    resolveSectionBoundary(center)
      .then(({ feature, source }) => {
        setSectionFeature(feature);
        setBoundarySource(source);
      })
      .catch((err) => {
        console.error("地價區段邊界查詢失敗:", err);
        setSectionFeature(null);
        setBoundarySource("synthetic");
      })
      .finally(() => setIsLoading(false));
  }, [result.meta.sectionId, center]);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      [center.lat, center.lng],
      17,
    );
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

    // 邊界加載完成後添加到地圖：優先用真實/近似邊界，都拿不到才退回人工示意矩形
    let sectionCorners: [number, number][] | null = null;
    if (sectionFeature) {
      const layer = L.geoJSON(sectionFeature, {
        style: { color: "#E4292F", weight: 2.5, fill: false },
      }).addTo(map);
      const b = layer.getBounds();
      sectionCorners = [
        [b.getSouth(), b.getWest()],
        [b.getNorth(), b.getEast()],
      ];
    } else if (!isLoading) {
      sectionCorners = getSectionBoundary(center);
      L.polygon(sectionCorners, {
        color: "#E4292F",
        weight: 2.5,
        fill: false,
      }).addTo(map);
    }

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

    // 只在邊界數據可用時才計算邊界視圖
    if (sectionCorners) {
      const allBounds: [number, number][] = [
        ...sectionCorners,
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
        paddingTopLeft: [90, 70],
        paddingBottomRight: [30, 30],
      });
    }

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    center.lat,
    center.lng,
    result.meta.sectionId,
    sectionFeature,
    isLoading,
  ]);

  return (
    <>
      <div className="flex-1 bg-white border border-[#D9DCE0] rounded-[4px] overflow-hidden relative min-h-0">
        <div className="absolute top-0 left-0 right-0 z-[1000] bg-[rgba(255,255,255,0.95)] border-b border-[#D9DCE0] px-3 py-1.5 text-center">
          <div className="text-[13px] font-bold text-[#1A1A1A]">
            {result.meta.district}土地徵收市價查估地價區段圖
          </div>
        </div>
        <div className="absolute top-9 left-2 z-[1000] bg-white border border-[#D9DCE0] rounded-[4px] px-2 py-1 text-[10px] text-[#1A1A1A] flex items-center gap-2 shadow-sm">
          <span className="font-semibold">比例尺：1:1800</span>
          <span className="inline-block w-4 h-3 border-2 border-[#E4292F]" />
          <span>區段範圍</span>
        </div>
        <div ref={mapNodeRef} className="w-full h-full" />
      </div>

      <div className="w-56 h-full overflow-y-auto space-y-3 shrink-0">
        <div className="bg-white border border-[#D9DCE0] rounded-[4px] p-3">
          <div className="text-[12px] font-semibold text-[#6B7280] mb-2 pb-1.5 border-b border-[#D9DCE0]">
            圖例
          </div>
          <div className="space-y-2">
            {[
              {
                color: "#E4292F",
                label: `區段範圍（${result.meta.sectionId}）`,
              },
              { color: "#B7791F", label: "比準地" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-3 border-2 shrink-0"
                  style={{ borderColor: item.color }}
                />
                <span className="text-[11px] text-[#374151]">{item.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px] p-3">
          <div className="text-[12px] font-semibold text-[#6B7280] mb-2 pb-1.5 border-b border-[#D9DCE0]">
            資料來源
          </div>
          <div className="space-y-1.5 text-[11px]">
            <div>
              <span className="text-[#1A1A1A] font-medium">底圖／段籍圖</span>
              <span className="text-[#9CA3AF]">
                ｜內政部國土測繪中心 EMAP＋LANDSECT｜WMTS
              </span>
            </div>
            <div>
              <span className="text-[#1A1A1A] font-medium">公有地地籍圖</span>
              <span className="text-[#9CA3AF]">
                ｜內政部國土測繪中心 LAND_OPENDATA｜WMTS
              </span>
            </div>
            <div>
              <span className="text-[#1A1A1A] font-medium">區段範圍</span>
              <span className="text-[#9CA3AF]">
                ｜
                {boundarySource
                  ? BOUNDARY_SOURCE_LABEL[boundarySource]
                  : "查詢中..."}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
