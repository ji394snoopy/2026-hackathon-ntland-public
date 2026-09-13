import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { NLSC_ATTRIBUTION, NLSC_EMAP_URL, type LatLng } from "../lib/officialMap"

// 新北市 29 區概略行政中心座標，僅供選區後縮小地圖範圍用；非精確地籍座標
const NTPC_DISTRICTS: { name: string; center: LatLng }[] = [
  { name: "板橋區", center: { lat: 25.0128, lng: 121.4626 } },
  { name: "三重區", center: { lat: 25.0616, lng: 121.4869 } },
  { name: "中和區", center: { lat: 24.9995, lng: 121.4995 } },
  { name: "永和區", center: { lat: 25.0078, lng: 121.5163 } },
  { name: "新莊區", center: { lat: 25.0359, lng: 121.4326 } },
  { name: "新店區", center: { lat: 24.9679, lng: 121.5416 } },
  { name: "樹林區", center: { lat: 24.9904, lng: 121.4204 } },
  { name: "鶯歌區", center: { lat: 24.9544, lng: 121.3535 } },
  { name: "三峽區", center: { lat: 24.9342, lng: 121.3688 } },
  { name: "淡水區", center: { lat: 25.1657, lng: 121.4416 } },
  { name: "汐止區", center: { lat: 25.0637, lng: 121.6586 } },
  { name: "瑞芳區", center: { lat: 25.1088, lng: 121.8055 } },
  { name: "土城區", center: { lat: 24.9723, lng: 121.4435 } },
  { name: "蘆洲區", center: { lat: 25.0847, lng: 121.4735 } },
  { name: "五股區", center: { lat: 25.0837, lng: 121.4374 } },
  { name: "泰山區", center: { lat: 25.0587, lng: 121.4304 } },
  { name: "林口區", center: { lat: 25.0776, lng: 121.3916 } },
  { name: "深坑區", center: { lat: 25.0021, lng: 121.6154 } },
  { name: "石碇區", center: { lat: 24.9922, lng: 121.6547 } },
  { name: "坪林區", center: { lat: 24.9375, lng: 121.7106 } },
  { name: "三芝區", center: { lat: 25.2606, lng: 121.4998 } },
  { name: "石門區", center: { lat: 25.2903, lng: 121.5684 } },
  { name: "八里區", center: { lat: 25.1494, lng: 121.3986 } },
  { name: "平溪區", center: { lat: 25.0257, lng: 121.7387 } },
  { name: "雙溪區", center: { lat: 25.0339, lng: 121.8663 } },
  { name: "貢寮區", center: { lat: 25.0219, lng: 121.9163 } },
  { name: "金山區", center: { lat: 25.2219, lng: 121.6357 } },
  { name: "萬里區", center: { lat: 25.1793, lng: 121.6893 } },
  { name: "烏來區", center: { lat: 24.8672, lng: 121.5507 } },
]

function pinIcon() {
  return L.divIcon({
    className: "",
    html: `<div style="width:26px;height:26px;transform:translateY(-6px);">
      <svg viewBox="0 0 24 24" width="26" height="26">
        <path d="M12 2C7.6 2 4 5.6 4 10c0 5.5 7 11.5 7.3 11.8.4.3 1 .3 1.4 0C13 21.5 20 15.5 20 10c0-4.4-3.6-8-8-8z" fill="#E4292F" stroke="white" stroke-width="1.5"/>
        <circle cx="12" cy="10" r="3" fill="white"/>
      </svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 26],
  })
}

export default function LocationPicker({
  value,
  onChange,
  disabled,
}: {
  value: LatLng | null
  onChange: (loc: LatLng) => void
  disabled?: boolean
}) {
  const [district, setDistrict] = useState(NTPC_DISTRICTS[0].name)
  const mapNodeRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!mapNodeRef.current || mapRef.current) return

    const initial = value ?? NTPC_DISTRICTS[0].center
    const map = L.map(mapNodeRef.current, { zoomControl: true }).setView(
      [initial.lat, initial.lng],
      15,
    )
    mapRef.current = map

    L.tileLayer(NLSC_EMAP_URL, {
      attribution: NLSC_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map)

    const placeMarker = (lat: number, lng: number) => {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
      } else {
        markerRef.current = L.marker([lat, lng], {
          icon: pinIcon(),
          draggable: true,
        }).addTo(map)
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current!.getLatLng()
          onChangeRef.current({ lat: pos.lat, lng: pos.lng })
        })
      }
    }

    if (value) placeMarker(value.lat, value.lng)

    map.on("click", (e: L.LeafletMouseEvent) => {
      placeMarker(e.latlng.lat, e.latlng.lng)
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng })
    })

    return () => {
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDistrictChange = (name: string) => {
    setDistrict(name)
    const found = NTPC_DISTRICTS.find((d) => d.name === name)
    if (found) mapRef.current?.setView([found.center.lat, found.center.lng], 15)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-[#6B7280] shrink-0">鄉鎮市區</label>
        <select
          value={district}
          onChange={(e) => handleDistrictChange(e.target.value)}
          disabled={disabled}
          className="border border-[#D9DCE0] rounded-[4px] px-2 py-1 text-sm bg-white text-[#1A1A1A] focus:outline-none focus:border-[#12457B] disabled:bg-[#F5F6F7]"
        >
          {NTPC_DISTRICTS.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-[#12457B] font-mono ml-auto">
          {value ? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : "尚未選點"}
        </span>
      </div>
      <div
        ref={mapNodeRef}
        className={`w-full h-64 border border-[#D9DCE0] rounded-[4px] ${disabled ? "pointer-events-none opacity-60" : ""}`}
      />
      <p className="text-[10px] text-[#9CA3AF]">
        選擇鄉鎮市區縮小範圍後，於地圖上點擊標出比準地正確位置（標記可拖曳微調）
      </p>
    </div>
  )
}
