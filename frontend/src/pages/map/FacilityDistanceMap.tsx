import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ProduceResult } from "../../types";
import type { FacilityItem, NearbyFacilitiesResponse } from "../../api/types";
import { fetchNearbyFacilities } from "../../api";
import {
  FACILITIES_QUERY_RADIUS_METERS,
  FACILITY_DEFAULT_STYLE,
  FACILITY_KIND_STYLE,
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  offsetLatLng,
  calloutIcon,
  getComparableCaseMarker,
  type LatLng,
} from "../../lib/officialMap";

// 官方填表規則：同一細項有多筆時只填影響最大者（最近一筆）——地圖標點跟表3/表4報表
// 對齊，同一 kind 只上圖最近那一筆，不要讓地圖上看起來有好幾間學校但報表只寫一間。
const MAX_MARKERS_PER_KIND = 1;

function poiIcon(color: string, glyph: string) {
  return L.divIcon({
    className: "",
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${color};opacity:0.9;display:flex;align-items:center;justify-content:center;color:white;font-size:10px;font-weight:700;font-family:sans-serif;box-shadow:0 1px 3px rgba(0,0,0,0.35)">${glyph}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function labelIcon(text: string, color: string) {
  return L.divIcon({
    className: "",
    html: `<div style="white-space:nowrap;font-size:9px;font-family:sans-serif;font-weight:700;color:${color};text-shadow:0 0 3px white,0 0 3px white,0 0 3px white">${text}</div>`,
    iconSize: [0, 0],
    iconAnchor: [-6, -6],
  });
}

// fetchNearbyFacilities() 已把大部分 kind 縮到只剩最近一筆，但「文教設施」這個 kind
// 被拆成國小/國中/高中/大學/幼兒園…多個細項，各自保留一筆，所以同一 kind 仍可能有
// 好幾筆（見 api/index.ts 的 facilityDetailType）。這裡再依 kind 統一裁到 maxPerKind，
// 確保地圖只標出跟報表同一筆「影響最大者」，不會地圖上一堆學校但報表只寫一間。
function pickMarkersPerKind(
  facilities: FacilityItem[],
  maxPerKind: number,
): FacilityItem[] {
  const byKind = new Map<string, FacilityItem[]>();
  for (const f of facilities) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  const picked: FacilityItem[] = [];
  for (const list of byKind.values()) {
    list.sort((a, b) => a.metersToCenter - b.metersToCenter);
    picked.push(...list.slice(0, maxPerKind));
  }
  return picked;
}

function addFacilityMarker(map: L.Map, f: FacilityItem) {
  const style = FACILITY_KIND_STYLE[f.kind] ?? FACILITY_DEFAULT_STYLE;
  const text = f.name ?? f.kind;
  // distanceType 只在 OSRM 步行距離查詢「實際成功」時才會標記（見 api/types.ts 的
  // FacilityItem.distanceType 說明），失敗回退直線距離的項目不會誤標成步行
  const distanceLabel =
    f.distanceType === "walking"
      ? `${f.metersToCenter}m 步行`
      : `${f.metersToCenter}m`;
  L.marker([f.lat, f.lon], { icon: poiIcon(style.color, style.glyph) })
    .bindPopup(`${text}｜${distanceLabel}`)
    .addTo(map);
  L.marker([f.lat, f.lon], {
    icon: labelIcon(`${text} ${distanceLabel}`, style.color),
  }).addTo(map);
}

// API 未設定或查詢失敗時的示意資料（沿用原本手動標示位置，確保現場斷線也能展示）
function addFallbackDemoMarkers(map: L.Map, center: LatLng) {
  const school = offsetLatLng(center, 150, 0);
  const cemetery = offsetLatLng(center, -60, -56);
  const market = offsetLatLng(center, 0, 80);
  const hospital = offsetLatLng(center, -100, 390);
  const busStop = offsetLatLng(center, 60, -140);

  L.marker([school.lat, school.lng], { icon: poiIcon("#2E7D32", "學") })
    .bindPopup("示意學校｜150m")
    .addTo(map);
  L.marker([school.lat, school.lng], {
    icon: labelIcon("示意學校 150m", "#1B5E20"),
  }).addTo(map);

  L.marker([cemetery.lat, cemetery.lng], { icon: poiIcon("#B7791F", "墓") })
    .bindPopup("示意公墓｜80m ⚠")
    .addTo(map);
  L.marker([cemetery.lat, cemetery.lng], {
    icon: labelIcon("示意公墓 80m ⚠", "#92400E"),
  }).addTo(map);

  L.marker([market.lat, market.lng], { icon: poiIcon("#455A64", "市") })
    .bindPopup("示意市場｜80m")
    .addTo(map);
  L.marker([market.lat, market.lng], {
    icon: labelIcon("示意市場 80m", "#263238"),
  }).addTo(map);

  L.marker([hospital.lat, hospital.lng], { icon: poiIcon("#C62828", "+") })
    .bindPopup("示意醫院｜400m")
    .addTo(map);
  L.marker([hospital.lat, hospital.lng], {
    icon: labelIcon("示意醫院 400m", "#37474F"),
  }).addTo(map);

  L.circleMarker([busStop.lat, busStop.lng], {
    radius: 6,
    color: "#12457B",
    fillColor: "#12457B",
    fillOpacity: 0.8,
  })
    .bindPopup("公車站｜150m")
    .addTo(map);
  L.marker([busStop.lat, busStop.lng], {
    icon: labelIcon("公車站 150m", "#12457B"),
  }).addTo(map);
}

const FALLBACK_LEGEND = [
  { color: "#2E7D32", label: "學校（150m）" },
  { color: "#455A64", label: "市場（80m）" },
  { color: "#C62828", label: "醫院（400m）" },
  { color: "#B7791F", label: "公墓（80m，嫌惡）" },
  { color: "#12457B", label: "公車站（150m）" },
];

export default function FacilityDistanceMap({
  result,
}: {
  result: ProduceResult;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const center = result.meta.location ?? { lat: 25.0375, lng: 121.5637 };
  const [facilitiesData, setFacilitiesData] =
    useState<NearbyFacilitiesResponse | null>(null);
  const [usedKinds, setUsedKinds] = useState<string[]>([]);
  const [source, setSource] = useState<"api" | "fallback" | null>(null);

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

    const benchmark = center;
    const sectionNe = offsetLatLng(center, 90, 200);
    const sectionSw = offsetLatLng(center, -90, -200);
    L.rectangle(
      [
        [sectionSw.lat, sectionSw.lng],
        [sectionNe.lat, sectionNe.lng],
      ],
      {
        color: "#12457B",
        weight: 2,
        dashArray: "7,3",
        fillColor: "#D0E4F5",
        fillOpacity: 0.35,
      },
    )
      .bindTooltip(`${result.meta.sectionId} ${result.meta.landUseType}`, {
        permanent: false,
      })
      .addTo(map);

    L.marker([benchmark.lat, benchmark.lng], { icon: poiIcon("#12457B", "準") })
      .bindPopup(`比準地｜${result.meta.benchmarkParcel}`)
      .addTo(map);
    L.marker([benchmark.lat, benchmark.lng], {
      icon: labelIcon(result.meta.benchmarkParcel, "#12457B"),
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

    fetchNearbyFacilities(center).then((data) => {
      if (data) {
        const markers = pickMarkersPerKind(
          data.facilities,
          MAX_MARKERS_PER_KIND,
        );
        markers.forEach((f) => addFacilityMarker(map, f));
        setFacilitiesData(data);
        setUsedKinds([...new Set(markers.map((f) => f.kind))]);
        setSource("api");
      } else {
        addFallbackDemoMarkers(map, center);
        setSource("fallback");
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, result.meta.sectionId]);

  const legend =
    source === "api"
      ? usedKinds.map((kind) => ({
          color: (FACILITY_KIND_STYLE[kind] ?? FACILITY_DEFAULT_STYLE).color,
          label: kind,
        }))
      : FALLBACK_LEGEND;

  return (
    <>
      <div className="flex-1 bg-white border border-[#D9DCE0] rounded-[4px] overflow-hidden relative min-h-0">
        <div className="absolute top-2 left-2 z-[1000] bg-white border border-[#D9DCE0] rounded-[4px] px-2 py-1 text-[10px] text-[#1A1A1A] font-semibold shadow-sm">
          {result.meta.district}｜{result.meta.sectionId}
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
                color: "#12457B",
                label: `地價區段 ${result.meta.sectionId}`,
                opacity: 0.4,
              },
              {
                color: "#12457B",
                label: `比準地（${result.meta.benchmarkParcel}）`,
                opacity: 0.85,
              },
              ...legend.map((item) => ({ ...item, opacity: 0.85 })),
            ].map((item, i) => (
              <div
                key={`${item.label}-${i}`}
                className="flex items-center gap-2"
              >
                <div
                  className="w-3 h-3 rounded-[2px] shrink-0"
                  style={{ backgroundColor: item.color, opacity: item.opacity }}
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
          {source === "api" && facilitiesData ? (
            <>
              <div className="text-[10px] text-[#9CA3AF] mb-1.5">
                周邊設施查詢 API｜半徑{" "}
                {facilitiesData.area.radiusMeters ??
                  FACILITIES_QUERY_RADIUS_METERS}
                m 內共 {facilitiesData.facilities.length} 筆
              </div>
              <div className="space-y-1.5">
                {Object.entries(facilitiesData.byCategory)
                  .filter(([, v]) => v.count > 0 && v.nearest)
                  .map(([category, v]) => (
                    <div key={category} className="text-[11px]">
                      <span className="text-[#1A1A1A] font-medium">
                        {category}
                      </span>
                      <span className="text-[#9CA3AF]">
                        ｜{v.nearest!.name ?? v.nearest!.kind}｜最近{" "}
                        {v.nearest!.metersToCenter}m
                        {v.nearest!.distanceType === "walking"
                          ? "（步行）"
                          : ""}
                        ｜共 {v.count} 筆
                      </span>
                    </div>
                  ))}
              </div>
              {facilitiesData.doorplate.nearest.length > 0 && (
                <div className="mt-2 pt-2 border-t border-[#D9DCE0]">
                  <div className="text-[10px] text-[#6B7280] mb-1">
                    最近門牌（供比對現場位置）
                  </div>
                  {facilitiesData.doorplate.nearest.slice(0, 3).map((d) => (
                    <div key={d.address} className="text-[10px] text-[#9CA3AF]">
                      {d.address}｜{d.metersToCenter}m
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-1.5">
              {[
                { f: "底圖圖台", s: "內政部國土測繪中心 EMAP", m: "WMTS" },
                { f: "學校距離", s: "示意資料", m: "直線距離" },
                { f: "公墓距離", s: "示意資料", m: "直線距離" },
                { f: "市場距離", s: "示意資料", m: "直線距離" },
                { f: "醫院距離", s: "示意資料", m: "步行距離" },
                { f: "公車站", s: "示意資料", m: "直線距離" },
              ].map((row) => (
                <div key={row.f} className="text-[11px]">
                  <span className="text-[#1A1A1A] font-medium">{row.f}</span>
                  <span className="text-[#9CA3AF]">
                    ｜{row.s}｜{row.m}
                  </span>
                </div>
              ))}
              <div className="text-[10px] text-[#9CA3AF] mt-1.5">
                周邊設施查詢 API 未設定，暫以示意資料顯示
              </div>
            </div>
          )}
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-[4px] p-3 text-[11px] text-amber-800 leading-relaxed">
          <span className="font-semibold">注意：</span>
          本圖為示意圖，供勘查表設施距離佐證。特殊設施（公墓）依規定採直線距離計算。
        </div>
      </div>
    </>
  );
}
