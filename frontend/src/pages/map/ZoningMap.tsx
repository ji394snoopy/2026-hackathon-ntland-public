import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../../types";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  ZONING_ATTRIBUTION,
  ZONING_LEGEND,
  calloutIcon,
  findZoneFeatureAt,
  getComparableCaseMarker,
  getSectionBoundary,
  loadZoningGeoJson,
  unifiedSectionBounds,
  zoneColor,
} from "../../lib/officialMap";

export default function ZoningMap({ result }: { result: ProduceResult }) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };
  const [usedLegend, setUsedLegend] = useState(ZONING_LEGEND);
  const [zoningError, setZoningError] = useState(false);
  const [zoningSource, setZoningSource] = useState<"api" | "fallback" | null>(
    null,
  );
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>(center);
  const [mapZoom, setMapZoom] = useState(15);

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      [24.991484, 121.418345],
      15,
    );
    mapRef.current = map;

    // 監聽地圖移動和縮放事件，實時更新中心點和縮放級別
    const updateMapState = () => {
      const currentCenter = map.getCenter();
      setMapCenter({ lat: currentCenter.lat, lng: currentCenter.lng });
      setMapZoom(map.getZoom());
    };
    map.on('move', updateMapState);
    map.on('zoom', updateMapState);
    updateMapState();

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: `${NLSC_ATTRIBUTION}｜${ZONING_ATTRIBUTION}`,
      maxZoom: 19,
      opacity: 0.5,
    }).addTo(map);

    const comparable =
      result.comparisonForm.cases[0]?.latLng ?? getComparableCaseMarker(center);

    // 區段框先用旋轉矩形佔位，待實際分區資料載入後改沿分區界線描繪
    const sectionBoundary = getSectionBoundary(center);
    let sectionLayer: L.Polygon | L.GeoJSON = L.polygon(sectionBoundary, {
      color: "#1E4FD8",
      weight: 2.5,
      fill: false,
    }).addTo(map);

    // 點擊分區色塊時沿該色塊自己的路徑描邊高亮（而非瀏覽器對 SVG path 預設畫的外接矩形 focus outline）
    let selectedZoneLayer: L.Path | null = null;
    const zoneDefaultStyle = { color: "#9CA3AF", weight: 0.5 };
    const zoneSelectedStyle = { color: "#1E4FD8", weight: 2.5 };

    loadZoningGeoJson(center)
      .then(({ geojson, source }) => {
        const usedColors = new Set<string>();
        L.geoJSON(geojson, {
          style: (feature) => {
            const color = zoneColor(feature?.properties?.ZONE);
            if (color) usedColors.add(color);
            return {
              ...zoneDefaultStyle,
              fillColor: color ?? "#FFFFFF",
              fillOpacity: color ? 0.6 : 0,
            };
          },
          onEachFeature: (feature, layer) => {
            if (feature.properties?.ZONE)
              layer.bindTooltip(feature.properties.ZONE);
            layer.on("click", () => {
              selectedZoneLayer?.setStyle(zoneDefaultStyle);
              (layer as L.Path).setStyle(zoneSelectedStyle);
              (layer as L.Path).bringToFront();
              selectedZoneLayer = layer as L.Path;
            });
          },
        }).addTo(map);
        setUsedLegend(
          ZONING_LEGEND.filter((item) => usedColors.has(item.color)),
        );
        setZoningSource(source);

        const sectionFeature = findZoneFeatureAt(geojson, center);
        if (sectionFeature) {
          map.removeLayer(sectionLayer);
          sectionLayer = L.geoJSON(sectionFeature, {
            style: { color: "#1E4FD8", weight: 2.5, fill: false },
          }).addTo(map);
          map.fitBounds(
            unifiedSectionBounds(center, sectionFeature, [
              comparable,
              result.comparisonForm.cases[1]?.latLng,
              result.comparisonForm.cases[2]?.latLng,
            ]),
            {
              paddingTopLeft: [120, 100],
              paddingBottomRight: [60, 60],
            },
          );
        }
      })
      .catch(() => setZoningError(true));

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
    L.circleMarker(comparable, {
      radius: 4,
      color: "#1E4FD8",
      fillColor: "#1E4FD8",
      fillOpacity: 1,
    }).addTo(map);
    if (result.comparisonForm.cases[0]?.caseNo) {
      L.marker(comparable, {
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

    map.fitBounds(
      unifiedSectionBounds(center, null, [
        comparable,
        result.comparisonForm.cases[1]?.latLng,
        result.comparisonForm.cases[2]?.latLng,
      ]),
      {
        paddingTopLeft: [120, 100],
        paddingBottomRight: [60, 60],
      },
    );

    return () => {
      map.off('move', updateMapState);
      map.off('zoom', updateMapState);
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
            {result.meta.district}土地徵收市價查估地價使用分區圖
          </div>
        </div>
        <div className="absolute top-9 left-2 z-[1000] bg-white border border-[#D9DCE0] rounded-[4px] px-2 py-1 text-[10px] text-[#1A1A1A] flex items-center gap-2 shadow-sm">
          <span className="font-semibold">比例尺：1:1800</span>
          <span className="inline-block w-4 h-3 border-2 border-[#1E4FD8]" />
          <span>區段範圍</span>
        </div>
        {zoningError && (
          <div className="absolute bottom-2 left-2 z-[1000] bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] text-[10px] px-2 py-1 rounded-[4px]">
            使用分區資料載入失敗
          </div>
        )}
        <div ref={mapNodeRef} className="w-full h-full" />
      </div>

      <div className="w-56 h-full overflow-y-auto space-y-3 shrink-0">
        <div className="bg-white border border-[#D9DCE0] rounded-[4px] p-3">
          <div className="text-[12px] font-semibold text-[#6B7280] mb-2 pb-1.5 border-b border-[#D9DCE0]">
            地圖座標
          </div>
          <div className="text-[11px] text-[#374151] space-y-1.5 font-mono">
            <div>
              <div className="text-[10px] text-[#6B7280]">中心點</div>
              <div>{mapCenter.lat.toFixed(6)}</div>
              <div>{mapCenter.lng.toFixed(6)}</div>
            </div>
            <div>
              <div className="text-[10px] text-[#6B7280]">縮放級別</div>
              <div>{mapZoom}</div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#D9DCE0] rounded-[4px] p-3">
          <div className="text-[12px] font-semibold text-[#6B7280] mb-2 pb-1.5 border-b border-[#D9DCE0]">
            圖例
          </div>
          <div className="space-y-1.5">
            {usedLegend.map((item) => (
              <div key={item.label} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-[2px] shrink-0 border border-[rgba(0,0,0,0.1)]"
                  style={{ backgroundColor: item.color }}
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
          <div className="text-[11px] text-[#374151] leading-relaxed">
            {ZONING_ATTRIBUTION}
          </div>
          {zoningSource && (
            <div className="text-[10px] text-[#9CA3AF] mt-1.5">
              查詢方式：
              {zoningSource === "api"
                ? "AWS Lambda 依座標篩選"
                : "本地全市檔案（API 未設定或連不上，前端篩選）"}
            </div>
          )}
        </div>

        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-[4px] p-3 text-[11px] text-[#92400E] leading-relaxed">
          <span className="font-semibold">注意：</span>
          分區色塊為政府公開資料實際範圍，未列於圖例的分區（如道路用地）維持留白。個別地號界線待地籍圖資API串接後補上。
        </div>
      </div>
    </>
  );
}
