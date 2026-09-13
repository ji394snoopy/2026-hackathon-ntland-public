# facilities API — 範例輸入 / 輸出

這裡放幾個代表性座標的請求範例與**預期回傳形狀**。實際數字會隨 OSM 快照重匯、NLSC
即時 API 內容而變動，所以下面的筆數是「當前資料集下的參考值」，不是硬性斷言（腳本
`tests/run-facilities-tests.mjs` 只斷言結構與「非空 / 分類存在」這類穩定條件）。

## 輸入模型

前端傳其中一種，後端 `parseArea()` 統一處理：

| 模式 | 輸入 | 距離基準 |
|---|---|---|
| radius（1 點 + 半徑） | `{ lon, lat, radius? }`（半徑公尺，預設 500，上限 20000） | 中心點 |
| polygon（4 點） | `{ polygon: <GeoJSON Polygon> }` 或 `poly=lon,lat;...` | 多邊形 centroid |

- GET：欄位放 query string（`?lon=&lat=&radius=` 或 `?poly=lon,lat;lon,lat;...`）
- POST：JSON body（`{ "lon":..,"lat":..,"radius":.. }`、`{ "center":[lon,lat],"radius":.. }`
  或 `{ "polygon": {...} }`）

範例檔：

| 檔 | 模式 | 座標 |
|---|---|---|
| `banqiao-radius.request.json` | radius | 板橋車站 121.4627,25.0111 / 500m |
| `banqiao-polygon.request.json` | polygon | 板橋方框（約 1.5km） |
| `jinshan-radius.request.json` | radius | 金山 demo 121.636,25.221 / 800m |

## 回傳形狀

所有成功回傳（HTTP 200）都是這個形狀：

```jsonc
{
  "area": {
    "kind": "radius",                       // "radius" | "polygon"
    "center": { "lon": 121.4627, "lat": 25.0111 },
    "radiusMeters": 500                     // 只有 radius 模式才有
  },
  "facilities": [
    {
      "kind": "捷運站",                      // 中文類別標籤
      "name": "臺北捷運板橋站-出入口2",
      "lon": 121.4636,
      "lat": 25.0129,
      "metersToCenter": 234
    },
    {
      "kind": "金融機構",
      "category": "bank",                    // OSM POI 才有：穩定分類鍵
      "name": "臺灣新光商業銀行",
      "lon": 121.4634,
      "lat": 25.0119,
      "metersToCenter": 98
    }
  ],
  "doorplate": {
    "count": 9173,                           // 範圍內門牌總數
    "nearest": [                             // 最近 5 筆
      { "address": "中山路一段１３９之２號二樓", "lon": 121.46, "lat": 25.011, "metersToCenter": 5 }
    ]
  }
}
```

重點：

- `facilities` 是三個來源合流：
  1. **PostGIS 站點表**（捷運站 / 高鐵站 / 公車站）— 無 `category`。
  2. **OSM POI**（`pois` 表）— **帶 `category`**（`bank`/`park`/`parking`/`substation`…），
     `kind` 是對應的中文（見 `query.ts` 的 `POI_KIND_ZH`）。
  3. **NLSC 即時 API**（殯葬 / 加油站 / 醫療 / 文教）— 帶 `category`
     （`cemetery`/`fuel`/`medical`/`education`）。網路失敗或 `includeNlsc:false` 時為空。
- `doorplate` 永遠是 `{ count, nearest[] }`（最多 5 筆最近門牌），不逐筆回傳 ~2M 門牌。

錯誤回傳（HTTP 400 / 502）：

```jsonc
{ "error": "Provide either a polygon (polygon/poly) or a center + radius ..." }  // 400 輸入無效
{ "error": "query failed: ..." }                                                  // 502 DB 查詢失敗
```

## 參考輸出（當前資料集）

### 板橋車站 radius 500m（`banqiao-radius`）

`area.kind = "radius"`、`radiusMeters = 500`、門牌約 9,173 筆。各類設施筆數參考：

| kind | 來源 | 參考筆數 | 最近一筆範例 |
|---|---|---|---|
| 公車站 | PostGIS | ~223 | 民權路口 83m |
| 捷運站 | PostGIS | ~9 | 臺北捷運板橋站-出入口2 234m |
| 高鐵站 | PostGIS | 1 | 臺灣高鐵板橋車站 394m |
| 金融機構 `bank` | OSM | ~26 | 臺灣新光商業銀行 98m |
| 百貨公司 `department_store` | OSM | ~4 | 麗寶 157m（遠東/誠品…） |
| 觀光飯店 `hotel` | OSM | ~9 | 台北新板希爾頓酒店 36m |
| 娛樂設施 `entertainment` | OSM | ~2 | 秀泰影城(板橋) 138m |
| 公園 `park` | OSM | ~12 | 公兒二公園 37m |
| 停車場 `parking` | OSM | ~9 | 新北市政府公務停車場 234m |
| 變電所 `substation` | OSM | 1 | 新民變電所 145m |
| 醫療設施 `medical` | NLSC | ~17 | （即時，隨網路變動） |
| 文教設施 `education` | NLSC | ~32 | （即時，隨網路變動） |
| 加油站 `fuel` | NLSC | 1 | 台灣中油加油站板橋民族路站 251m |

### 金山 demo radius 800m（`jinshan-radius`）

`area.kind = "radius"`、`radiusMeters = 800`、門牌約 5,522 筆。設施較稀：

- 公車站 ~214（金山區公所 153m）
- 金融機構 `bank` ~4（金山地區農會 186m）
- 觀光飯店 ~2、市場 ~2、公園 ~4、停車場 ~30、高壓電塔 1
- NLSC：文教 ~9、醫療 ~5、加油站 ~2、殯葬 ~2
- 最近門牌：忠孝一路１０７號 51m

### 板橋方框 polygon（`banqiao-polygon`）

`area.kind = "polygon"`、**無 `radiusMeters`**、`center` 為方框 centroid。回傳形狀與
radius 相同，只是設施是「落在多邊形內」而非「半徑內」。
