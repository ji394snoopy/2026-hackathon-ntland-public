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

export type PinValue = {
  address: string;
  lat: number | null;
  lng: number | null;
};

// 新北市金山區大略中心，作為尚未搜尋地址時的預設地圖範圍
const DEFAULT_CENTER: [number, number] = [25.2214, 121.6367];

// 從既有地址拆出「縣市／行政區／其餘部分（路、門牌）」，找不到已知縣市時預設新北市
function splitAddress(
  address: string,
  districts: CityDistricts,
): { city: string; district: string; rest: string } {
  const city = TAIWAN_CITIES.find((c) => address.startsWith(c)) ?? "新北市";
  const afterCity = address.startsWith(city)
    ? address.slice(city.length)
    : address;
  const district =
    (districts[city] ?? []).find((d) => afterCity.startsWith(d)) ?? "";
  return {
    city,
    district,
    rest: district ? afterCity.slice(district.length) : afterCity,
  };
}

export default function AddressPinMap({
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
  value: PinValue;
  onChange: (value: PinValue) => void;
  disabled?: boolean;
  // 讓外部（如比準地）帶動這張地圖的視角，只移動視角、不落圖釘；已自行標記過的圖不會被覆蓋
  focusHint?: { lat: number; lng: number } | null;
}) {
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const disabledRef = useRef(disabled);
  valueRef.current = value;
  onChangeRef.current = onChange;
  disabledRef.current = disabled;

  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [section, setSection] = useState("");
  const [sectionLoading, setSectionLoading] = useState(false);
  const [cityDistricts, setCityDistricts] = useState<CityDistricts>({});
  const [city, setCity] = useState(() => splitAddress(value.address, {}).city);
  const [district, setDistrict] = useState("");
  const [addressRest, setAddressRest] = useState(
    () => splitAddress(value.address, {}).rest,
  );

  useEffect(() => {
    let cancelled = false;
    loadCityDistricts().then((data) => {
      if (cancelled) return;
      setCityDistricts(data);
      // 資料載入前若地址已含行政區文字，會落在 addressRest 裡；資料到位後補拆一次
      const split = splitAddress(valueRef.current.address, data);
      if (split.district) {
        setDistrict(split.district);
        setAddressRest(split.rest);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 只移動地圖視角、不落圖釘也不改 lat/lng；讓使用者選完縣市/行政區能先看到大致範圍，再自行點選精確位置
  async function flyToArea(query: string, zoom: number) {
    if (!query.trim()) return;
    try {
      const params = new URLSearchParams({
        format: "json",
        q: query,
        countrycodes: "tw",
        limit: "1",
      });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
      );
      const results: { lat: string; lon: string }[] = await res.json();
      if (!results?.length) return;
      mapRef.current?.flyTo(
        [parseFloat(results[0].lat), parseFloat(results[0].lon)],
        zoom,
      );
    } catch {
      // 定位失敗不影響使用者繼續選縣市/行政區，靜默即可
    }
  }

  function updateCity(nextCity: string) {
    setCity(nextCity);
    setDistrict("");
    onChange({ ...value, address: nextCity + addressRest });
    flyToArea(nextCity, 12);
  }

  function updateDistrict(nextDistrict: string) {
    setDistrict(nextDistrict);
    onChange({ ...value, address: city + nextDistrict + addressRest });
    flyToArea(city + nextDistrict, 14);
  }

  function updateAddressRest(nextRest: string) {
    setAddressRest(nextRest);
    onChange({ ...value, address: city + district + nextRest });
  }

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return;

    const initial =
      value.lat != null && value.lng != null
        ? [value.lat, value.lng]
        : DEFAULT_CENTER;
    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      initial as [number, number],
      value.lat != null ? 18 : 15,
    );
    mapRef.current = map;

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: NLSC_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);
    L.tileLayer(NLSC_LANDSECT_URL, { maxZoom: 19, opacity: 0.9 }).addTo(map);

    map.on("click", (e: L.LeafletMouseEvent) => {
      if (disabledRef.current) return;
      placeMarker(e.latlng.lat, e.latlng.lng);
      onChangeRef.current({
        ...valueRef.current,
        lat: e.latlng.lat,
        lng: e.latlng.lng,
      });
    });

    if (value.lat != null && value.lng != null) {
      placeMarker(value.lat, value.lng);
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusHint || !mapRef.current) return;
    // 這張圖自己已經標記過位置就不要被比準地帶著跑，避免打斷使用者微調
    if (valueRef.current.lat != null && valueRef.current.lng != null) return;
    mapRef.current.flyTo([focusHint.lat, focusHint.lng], 17);
    // 依實際經緯度值而非物件參照觸發，避免父層每次重新渲染都建立新物件、造成重複 flyTo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusHint?.lat, focusHint?.lng]);

  function placeMarker(lat: number, lng: number) {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = L.marker([lat, lng], {
        icon: pinIcon(color, glyph),
        draggable: !disabledRef.current,
      });
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onChangeRef.current({
          ...valueRef.current,
          lat: pos.lat,
          lng: pos.lng,
        });
        fetchSection(pos.lat, pos.lng);
      });
      marker.addTo(map);
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([lat, lng]);
    }
    fetchSection(lat, lng);
  }

  // 內政部國土測繪中心公開 API，座標反查段小段（免申請、免金鑰）；只到段小段，實際地號仍需人工核對
  async function fetchSection(lat: number, lng: number) {
    setSectionLoading(true);
    try {
      const res = await fetch(
        `https://api.nlsc.gov.tw/other/TownVillagePointQuery/${lng}/${lat}/4326`,
      );
      const xml = new DOMParser().parseFromString(
        await res.text(),
        "application/xml",
      );
      const townName = xml.querySelector("townName")?.textContent ?? "";
      const sectName = xml.querySelector("sectName")?.textContent ?? "";
      setSection(sectName ? `${townName}${sectName}` : "");
    } catch {
      setSection("");
    } finally {
      setSectionLoading(false);
    }
  }

  async function handleSearch() {
    if ((!district && !addressRest.trim()) || searching) return;
    setSearching(true);
    setSearchError("");
    try {
      const params = new URLSearchParams({
        format: "json",
        q: value.address.trim(),
        countrycodes: "tw",
        limit: "1",
      });
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params}`,
      );
      const results: { lat: string; lon: string }[] = await res.json();
      if (!results?.length) {
        setSearchError(
          "查無此地址，請嘗試更完整的地址，或直接在地圖上點選標記",
        );
        return;
      }
      const lat = parseFloat(results[0].lat);
      const lng = parseFloat(results[0].lon);
      mapRef.current?.flyTo([lat, lng], 18);
      placeMarker(lat, lng);
      onChange({ ...value, lat, lng });
    } catch {
      setSearchError("地址查詢失敗，請直接在地圖上點選標記");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-[#6B7280]">{label}</label>
      <div className="flex flex-wrap gap-2">
        <select
          value={city}
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
          value={district}
          onChange={(e) => updateDistrict(e.target.value)}
          disabled={disabled}
          className="border border-[#D9DCE0] rounded-[4px] px-2 py-1.5 text-sm bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] disabled:bg-[#F5F6F7] shrink-0"
        >
          <option value="">請選擇行政區</option>
          {(cityDistricts[city] ?? []).map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={addressRest}
          onChange={(e) => updateAddressRest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSearch();
            }
          }}
          disabled={disabled}
          placeholder="輸入路、門牌以縮小地圖範圍，如：金包里街..."
          className="flex-1 min-w-[140px] border border-[#D9DCE0] rounded-[4px] px-2.5 py-1.5 text-sm bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] disabled:bg-[#F5F6F7]"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={disabled || searching || (!district && !addressRest.trim())}
          className="px-3 py-1.5 text-xs border border-[#D9DCE0] rounded-[4px] text-[#12457B] hover:border-[#12457B] disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {searching ? "查詢中..." : "定位地址"}
        </button>
      </div>
      {searchError && (
        <div className="text-[10px] text-[#C0392B]">{searchError}</div>
      )}
      <div
        ref={mapNodeRef}
        className="h-[220px] w-full rounded-[4px] border border-[#D9DCE0]"
      />
      <div className="text-[10px] text-[#6B7280]">
        {value.lat != null && value.lng != null
          ? `已標記座標：${value.lat.toFixed(6)}, ${value.lng.toFixed(6)}（可拖曳圖釘或點擊地圖調整）`
          : "尚未標記位置，請於地圖上點擊以標記精確位置"}
      </div>
      {value.lat != null && value.lng != null && (
        <div className="text-[10px] text-[#6B7280]">
          {sectionLoading
            ? "查詢段小段中..."
            : section
              ? `段小段：${section}（自動查詢僅供參考，實際地號請人工核對）`
              : "查無段小段資訊，請人工核對地號"}
        </div>
      )}
    </div>
  );
}
