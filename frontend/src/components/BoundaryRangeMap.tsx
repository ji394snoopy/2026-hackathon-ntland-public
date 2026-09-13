import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  NLSC_ATTRIBUTION,
  NLSC_EMAP_URL,
  NLSC_LANDSECT_URL,
  pinIcon,
} from "../lib/officialMap";
import {
  TAIWAN_CITIES,
  loadCityDistricts,
  type CityDistricts,
} from "../lib/taiwanDistricts";
import {
  parseBoundaryText,
  resolveBoundary,
  confidenceLabel,
  type ResolvedBoundary,
} from "../lib/boundaryRange";

export type BoundaryPinValue = {
  city: string;
  district: string;
  text: string; // 使用者輸入的「沿OO街以北...之OO區」四至描述原文
  zoneType: string | null; // 解析出的分區類別（如「第一種住宅區」）
  corners: { lat: number; lng: number }[] | null; // 四個角點，依 [西南, 東南, 東北, 西北] 排列
  lat: number | null; // 四角形心，作為送出 API 用的代表座標
  lng: number | null;
  // 對應 corners 四個角點中，哪幾個是「查無街道，暫用推算位置」需人工拖曳確認；
  // 缺省視為四個角點皆已解析（[false,false,false,false]）
  cornerPending?: boolean[];
};

export const emptyBoundaryPin = (): BoundaryPinValue => ({
  city: "新北市",
  district: "樹林區",
  text: "",
  zoneType: null,
  corners: null,
  lat: null,
  lng: null,
  cornerPending: undefined,
});

const DEFAULT_CENTER: [number, number] = [25.2214, 121.6367];
const DEFAULT_CENTER_LATLNG = { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] };
const EXAMPLE_TEXT =
  "沿樹人街以北、長壽街21巷以西、啟智街14巷以南及樹德街136巷以東之第一種住宅區";

const CORNER_LABELS: { key: "sw" | "se" | "ne" | "nw"; label: string }[] = [
  { key: "sw", label: "西南角" },
  { key: "se", label: "東南角" },
  { key: "ne", label: "東北角" },
  { key: "nw", label: "西北角" },
];

const CONFIDENCE_STYLE: Record<string, { label: string; color: string }> = {
  high: { label: "高信心", color: "#2E7D32" },
  medium: { label: "中等信心，建議人工核對", color: "#C2410C" },
  low: { label: "低信心（外推），建議人工核對", color: "#C0392B" },
};

export default function BoundaryRangeMap({
  label,
  glyph,
  color = "#12457B",
  value,
  onChange,
  disabled,
  focusHint,
}: {
  label: string;
  glyph: string;
  color?: string;
  value: BoundaryPinValue;
  onChange: (value: BoundaryPinValue) => void;
  disabled?: boolean;
  focusHint?: { lat: number; lng: number } | null;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);
  const cornerMarkersRef = useRef<(L.CircleMarker | L.Marker)[]>([]);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  const cornerPendingRef = useRef<boolean[]>([false, false, false, false]);
  valueRef.current = value;
  onChangeRef.current = onChange;
  disabledRef.current = disabled;

  const [cityDistricts, setCityDistricts] = useState<CityDistricts>({});
  const [text, setText] = useState(value.text);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resolved, setResolved] = useState<ResolvedBoundary | null>(null);
  const [cornerPending, setCornerPending] = useState<boolean[]>(
    () => value.cornerPending ?? [false, false, false, false],
  );
  cornerPendingRef.current = cornerPending;

  useEffect(() => {
    loadCityDistricts().then(setCityDistricts);
  }, []);

  function flyToArea(query: string, zoom: number) {
    if (!query.trim()) return;
    const params = new URLSearchParams({
      format: "json",
      q: query,
      countrycodes: "tw",
      limit: "1",
    });
    fetch(`https://nominatim.openstreetmap.org/search?${params}`)
      .then((res) => res.json())
      .then((results: { lat: string; lon: string }[]) => {
        if (!results?.length) return;
        mapRef.current?.flyTo(
          [parseFloat(results[0].lat), parseFloat(results[0].lon)],
          zoom,
        );
      })
      .catch(() => {
        // 定位失敗不影響使用者繼續操作，靜默即可
      });
  }

  function updateCity(nextCity: string) {
    onChange({ ...value, city: nextCity, district: "" });
    flyToArea(nextCity, 12);
  }

  function updateDistrict(nextDistrict: string) {
    onChange({ ...value, district: nextDistrict });
    flyToArea(value.city + nextDistrict, 14);
  }

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;
    const initial =
      value.lat != null && value.lng != null
        ? [value.lat, value.lng]
        : DEFAULT_CENTER;
    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      initial as [number, number],
      value.lat != null ? 17 : 15,
    );
    mapRef.current = map;

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: NLSC_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    L.tileLayer(NLSC_LANDSECT_URL, { maxZoom: 19, opacity: 0.9 }).addTo(map);

    if (value.lat != null && value.lng != null) {
      placeCenterMarker(value.lat, value.lng);
    } else if (value.district) {
      // 尚未解析範圍時，先把地圖視角帶到預設行政區，而不是停在跟目前資料無關的預設中心點
      flyToArea(value.city + value.district, 14);
    }
    if (value.corners?.length === 4) {
      drawPolygon(value.corners, value.cornerPending ?? [false, false, false, false]);
      if (value.cornerPending?.some(Boolean)) {
        setNotice(
          "部分街道查無資料，對應角點已改用紅色圖釘標示，請拖曳至正確位置",
        );
      }
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      polygonRef.current = null;
      cornerMarkersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusHint || !mapRef.current) return;
    if (valueRef.current.lat != null && valueRef.current.lng != null) return;
    mapRef.current.flyTo([focusHint.lat, focusHint.lng], 16);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHint?.lat, focusHint?.lng]);

  function placeCenterMarker(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], {
        icon: pinIcon(color, glyph),
        draggable: !disabledRef.current,
      });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onChangeRef.current({ ...valueRef.current, lat: pos.lat, lng: pos.lng });
      });
      marker.addTo(map);
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
  }

  function drawPolygon(
    corners: { lat: number; lng: number }[],
    pending: boolean[] = cornerPendingRef.current,
  ) {
    const map = mapRef.current;
    if (!map) return;
    const latLngs = corners.map((c) => [c.lat, c.lng] as [number, number]);

    if (polygonRef.current) {
      polygonRef.current.setLatLngs(latLngs);
    } else {
      polygonRef.current = L.polygon(latLngs, {
        color,
        weight: 2,
        fillOpacity: 0.08,
      }).addTo(map);
    }

    cornerMarkersRef.current.forEach((m) => m.remove());
    cornerMarkersRef.current = corners.map((c, i) => {
      if (pending[i]) {
        // 查無此角點對應街道，改用可拖曳圖釘，讓使用者手動標示正確位置
        const marker = L.marker([c.lat, c.lng], {
          icon: pinIcon("#C0392B", "?"),
          draggable: !disabledRef.current,
        });
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          updateCorner(i, pos.lat, pos.lng);
        });
        marker.addTo(map);
        return marker;
      }
      return L.circleMarker([c.lat, c.lng], {
        radius: 4,
        color,
        weight: 2,
        fillColor: "#fff",
        fillOpacity: 1,
      }).addTo(map);
    });

    map.fitBounds(latLngs, { padding: [24, 24] });
  }

  // 使用者手動拖曳「查無街道」角點到正確位置後：該角點視為已標示，重新計算形心與範圍
  function updateCorner(index: number, lat: number, lng: number) {
    const current = valueRef.current;
    if (!current.corners || current.corners.length !== 4) return;
    const corners = current.corners.map((c, i) =>
      i === index ? { lat, lng } : c,
    );
    const newPending = cornerPendingRef.current.map((p, i) =>
      i === index ? false : p,
    );
    const center = {
      lat: corners.reduce((sum, c) => sum + c.lat, 0) / 4,
      lng: corners.reduce((sum, c) => sum + c.lng, 0) / 4,
    };
    cornerPendingRef.current = newPending;
    setCornerPending(newPending);
    drawPolygon(corners, newPending);
    placeCenterMarker(center.lat, center.lng);
    onChangeRef.current({
      ...current,
      corners,
      lat: center.lat,
      lng: center.lng,
      cornerPending: newPending,
    });
    if (!newPending.some(Boolean)) setNotice("");
  }

  async function handleResolve() {
    if (resolving || disabled) return;
    setError("");
    setNotice("");
    setResolving(true);
    try {
      const parsed = parseBoundaryText(text);
      if (!parsed) {
        setError(
          "格式不符，請確認為「沿OO以北、OO以西、OO以南及OO以東之OO區」，且東西南北剛好各一條",
        );
        return;
      }
      const cityDistrict = value.city + value.district;
      const result = await resolveBoundary(parsed, cityDistrict);
      setResolved(result);

      // 查無街道的角點沒有座標可用；先用目前已解析的形心（或地圖目前視角）當暫時位置，
      // 標成待手動 pin，讓使用者知道要拖曳圖釘去正確位置
      const mapCenter = mapRef.current?.getCenter();
      const fallback =
        result.center ??
        (mapCenter ? { lat: mapCenter.lat, lng: mapCenter.lng } : DEFAULT_CENTER_LATLNG);

      const cornerList = [
        result.corners.sw,
        result.corners.se,
        result.corners.ne,
        result.corners.nw,
      ];
      const corners = cornerList.map((c) =>
        c.resolved ? { lat: c.lat, lng: c.lng } : fallback,
      );
      const pending = cornerList.map((c) => !c.resolved);
      const center = result.center ?? fallback;

      cornerPendingRef.current = pending;
      setCornerPending(pending);
      drawPolygon(corners, pending);
      placeCenterMarker(center.lat, center.lng);
      onChange({
        ...value,
        text,
        zoneType: result.zoneType,
        corners,
        lat: center.lat,
        lng: center.lng,
        cornerPending: pending,
      });

      if (pending.some(Boolean)) {
        setNotice(
          "部分街道查無資料，對應角點已改用紅色圖釘標示，請拖曳至正確位置",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失敗，請稍後再試");
    } finally {
      setResolving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-[#6B7280]">{label}</label>
      <div className="flex flex-wrap gap-2">
        <select
          value={value.city}
          onChange={(e) => updateCity(e.target.value)}
          disabled={disabled}
          className="border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-sm bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] disabled:bg-[#F5F6F7] shrink-0"
        >
          {TAIWAN_CITIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={value.district}
          onChange={(e) => updateDistrict(e.target.value)}
          disabled={disabled}
          className="border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-sm bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] disabled:bg-[#F5F6F7] shrink-0"
        >
          <option value="">請選擇行政區</option>
          {(cityDistricts[value.city] ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        rows={2}
        placeholder={EXAMPLE_TEXT}
        className="w-full border border-[#D9DCE0] rounded-[4px] px-2.5 py-1.5 text-sm bg-white text-[#1A1A1A] leading-relaxed resize-none focus:outline-none focus:border-[#12457B] focus:ring-1 focus:ring-[#12457B]/20 disabled:bg-[#F5F6F7]"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleResolve}
          disabled={disabled || resolving || !value.district || !text.trim()}
          className="px-3 py-1.5 text-xs border border-[#D9DCE0] rounded-[4px] text-[#12457B] hover:border-[#12457B] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {resolving ? "解析中..." : "解析範圍"}
        </button>
        {!value.district && (
          <span className="text-[10px] text-[#9CA3AF]">
            請先選擇行政區，再解析範圍
          </span>
        )}
      </div>
      {error && <div className="text-[10px] text-[#C0392B]">{error}</div>}
      {!error && notice && (
        <div className="text-[10px] text-[#C2410C]">{notice}</div>
      )}

      <div
        ref={mapNodeRef}
        className="h-[220px] w-full rounded-[4px] border border-[#D9DCE0]"
      />

      <div className="text-[10px] text-[#6B7280]">
        {value.lat != null && value.lng != null
          ? `代表座標（四角形心）：${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}（可拖曳圖釘微調，不影響已解析之四角範圍）`
          : "尚未解析範圍，請輸入四至文字後點擊「解析範圍」"}
      </div>
      {value.zoneType && (
        <div className="text-[10px] text-[#6B7280]">
          分區類別：{value.zoneType}
        </div>
      )}
      {resolved && (
        <div className="text-[10px] text-[#6B7280] space-y-0.5">
          {CORNER_LABELS.map(({ key, label: cornerLabel }) => {
            const corner = resolved.corners[key];
            if (!corner.resolved) {
              return (
                <div key={key}>
                  {cornerLabel}（{corner.streets[0]}×{corner.streets[1]}）：
                  <span style={{ color: "#C0392B" }}>{corner.reason}</span>
                </div>
              );
            }
            const conf = CONFIDENCE_STYLE[confidenceLabel(corner.overshootMeters)];
            return (
              <div key={key}>
                {cornerLabel}（{corner.streets[0]}×{corner.streets[1]}）：
                {corner.lat.toFixed(6)}, {corner.lng.toFixed(6)}
                {" — "}
                <span style={{ color: conf.color }}>{conf.label}</span>
                {corner.overshootMeters > 1 &&
                  `（偏移約 ${Math.round(corner.overshootMeters)} 公尺）`}
              </div>
            );
          })}
          <div className="text-[#9CA3AF]">
            以上角點依街道路網幾何自動推算，僅供地圖示意，正式界址仍應以都市計畫圖資為準
          </div>
        </div>
      )}
    </div>
  );
}
