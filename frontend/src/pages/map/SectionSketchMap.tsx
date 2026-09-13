import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  calloutIcon,
  getComparableCaseMarker,
  getSectionBoundary,
  resolveSectionBoundary,
  unifiedSectionBounds,
} from "../../lib/officialMap";

type BoundarySource = "zoning" | "synthetic";

const BOUNDARY_SOURCE_LABEL: Record<BoundarySource, string> = {
  zoning: "使用分區圖（含比準地座標之分區面，近似值）",
  synthetic: "人工旋轉矩形（示意，未取得實際邊界）",
};

export default function SectionSketchMap({
  result,
}: {
  result: ProduceResult;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };
  const [boundarySource, setBoundarySource] = useState<BoundarySource | null>(
    null,
  );

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      [24.991484, 121.418345],
      15,
    );
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

    // 依序嘗試：使用分區圖近似 → 人工示意矩形
    resolveSectionBoundary(center)
      .then(({ feature, source }) => {
        setBoundarySource(source);
        let sectionCorners: [number, number][];
        let labelPoint: [number, number];
        if (feature) {
          const layer = L.geoJSON(feature, {
            style: { color: "#E4292F", weight: 2.5, fill: false },
          }).addTo(map);
          const b = layer.getBounds();
          sectionCorners = [
            [b.getSouth(), b.getWest()],
            [b.getNorth(), b.getEast()],
          ];
          labelPoint = [b.getNorth(), b.getEast()];
        } else {
          sectionCorners = getSectionBoundary(center);
          L.polygon(sectionCorners, {
            color: "#E4292F",
            weight: 2.5,
            fill: false,
          }).addTo(map);
          labelPoint = sectionCorners[1];
        }
        L.marker(labelPoint, {
          icon: calloutIcon(`區段${result.meta.sectionId}`, "#E4292F", "right"),
        }).addTo(map);

        map.fitBounds(
          unifiedSectionBounds(center, feature, [
            comparableCase1,
            result.comparisonForm.cases[1]?.latLng,
            result.comparisonForm.cases[2]?.latLng,
          ]),
          {
            paddingTopLeft: [120, 100],
            paddingBottomRight: [60, 60],
          },
        );
      })
      .catch(() => setBoundarySource("synthetic"));

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, result.meta.sectionId]);

  return (
    <>
      <div className="flex-1 bg-white border border-[#D9DCE0] rounded-[4px] overflow-hidden relative min-h-0">
        <div className="absolute top-0 left-0 right-0 z-[1000] bg-[rgba(255,255,255,0.95)] border-b border-[#D9DCE0] px-3 py-1.5 text-center">
          <div className="text-[13px] font-bold text-[#1A1A1A]">
            {result.meta.district}土地徵收市價查估地價區段略圖
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
            說明
          </div>
          <p className="text-[11px] text-[#374151] leading-relaxed">
            略圖為地價區段圖之簡化版，僅標示區段範圍、比準地與比較實例位置，供報告內文快速參照。詳細段籍界線請見「地價區段圖」分頁。
          </p>
          <div className="text-[10px] text-[#9CA3AF] mt-2 pt-2 border-t border-[#D9DCE0]">
            區段範圍來源：
            {boundarySource
              ? BOUNDARY_SOURCE_LABEL[boundarySource]
              : "查詢中..."}
          </div>
        </div>
      </div>
    </>
  );
}
