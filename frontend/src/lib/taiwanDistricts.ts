// 縣市／行政區清單與快取，供 AddressPinMap、BoundaryRangeMap 等地點標記元件共用

export const TAIWAN_CITIES = [
  "新北市",
  "臺北市",
  "桃園市",
  "臺中市",
  "臺南市",
  "高雄市",
  "基隆市",
  "新竹市",
  "新竹縣",
  "苗栗縣",
  "彰化縣",
  "南投縣",
  "雲林縣",
  "嘉義市",
  "嘉義縣",
  "屏東縣",
  "宜蘭縣",
  "花蓮縣",
  "臺東縣",
  "澎湖縣",
  "金門縣",
  "連江縣",
];

export type CityDistricts = Record<string, string[]>;

const CITY_DISTRICT_URL =
  "https://d19kcbryrmhley.cloudfront.net/common/tw-city-district.json";

let cityDistrictsPromise: Promise<CityDistricts> | null = null;
// 縣市/行政區清單只需抓一次，同頁多個地點標記元件（比準地＋多筆比較標的）共用同一份快取
export function loadCityDistricts(): Promise<CityDistricts> {
  if (!cityDistrictsPromise) {
    cityDistrictsPromise = fetch(CITY_DISTRICT_URL).then((res) => res.json());
  }
  return cityDistrictsPromise;
}
