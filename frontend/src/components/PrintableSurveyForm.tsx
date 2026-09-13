import type { ProduceResult, SurveyField } from "../types";

// 完全比照官方紙本表1版式的輸出用元件（供 html2canvas 擷取列印/PDF）。
// 版面骨架（欄序、權重數字、選項清單）為表1固定格式；顯示值一律取自 result.survey（JSON 狀態）。

const KAI_FONT =
  "'標楷體-繁', 'DFKai-SB', 'BiauKai', 'Kaiti TC', 'STKaiti', 'Kaiti SC', '標楷體', 'KaiTi', serif";

const BORDER = "border-[#8A8F98]";
const CELL = `border ${BORDER}`; // 不預設 vertical-align：各欄位自行決定置中或靠上
const VAL = "text-[12px] leading-[17px]"; // 一般填寫值文字
const SUB = "text-[11px] leading-[15px]"; // 子選項/名稱列文字
const COLW = "grid-cols-[134px_62px_112px]"; // 多選項列固定欄寬：標籤／本區段內／本區段外(距M)，供跨列對齊

// 每張表固定 5 欄：分類欄／權重代碼／最大影響範圍／標籤欄／值欄（值欄不設寬，吃剩餘空間）
// 用 colgroup 而非各列儲存格的 w-[] class 來定欄寬，避免 table-layout:fixed 只採第一列儲存格寬度時，
// 兩個權重欄因故被判定為不同寬度
function ColGroup() {
  return (
    <colgroup>
      <col style={{ width: "20px" }} />
      <col style={{ width: "16px" }} />
      <col style={{ width: "16px" }} />
      <col style={{ width: "152px" }} />
      <col />
    </colgroup>
  );
}

function parseLoc(raw: string): { inside: boolean | null; distance: string } {
  if (!raw) return { inside: null, distance: "" };
  const idx = raw.search(/本區段(內|外)/);
  if (idx < 0) return { inside: null, distance: "" };
  const inside = raw.slice(idx).startsWith("本區段內");
  const distMatch = raw.match(/距\s*(\d+)\s*M/);
  return { inside, distance: distMatch ? distMatch[1] : "" };
}

function parseName(raw: string): { name: string; qty: string } {
  if (!raw) return { name: "", qty: "" };
  if (raw === "無") return { name: "無", qty: "" };
  const idx = raw.search(/本區段(內|外)/);
  let head = idx >= 0 ? raw.slice(0, idx) : raw;
  head = head.replace(/[，,]\s*$/, "");
  const qtyMatch = head.match(/^(.*?)[，,]\s*數量[:：]?\s*(\d+)\s*$/);
  if (qtyMatch) return { name: qtyMatch[1], qty: qtyMatch[2] };
  return { name: head, qty: "" };
}

// 官方版式為左右並排兩格窄欄（非上下堆疊）：如 1 | 2、1 | 5
function WeightCell({
  w,
  rowSpan,
}: {
  w?: [number, number];
  rowSpan?: number;
}) {
  return (
    <>
      <td
        className={`${CELL} align-middle p-0 bg-[#F0F1F3] text-[11px] leading-[15px] text-[#4B5563] text-center`}
        rowSpan={rowSpan}
      >
        {w?.[0] ?? ""}
      </td>
      <td
        className={`${CELL} align-middle p-0 bg-[#F0F1F3] text-[11px] leading-[15px] text-[#4B5563] text-center`}
        rowSpan={rowSpan}
      >
        {w?.[1] ?? ""}
      </td>
    </>
  );
}

function CategoryCell({ label, rowSpan }: { label: string; rowSpan: number }) {
  return (
    <td
      className={`${CELL} align-middle bg-[#F0F1F3] p-0 text-center`}
      rowSpan={rowSpan}
    >
      <div className="text-[12px] font-bold leading-[15px] py-[4px] tracking-widest [writing-mode:vertical-rl] inline-block">
        {label}
      </div>
    </td>
  );
}

function Circle({ checked }: { checked: boolean | null }) {
  return <span>{checked ? "●" : "○"}</span>;
}

function LocLine({
  inside,
  distance,
}: {
  inside: boolean | null;
  distance: string;
}) {
  return (
    <div className={`${SUB} whitespace-nowrap`}>
      <Circle checked={inside === true} />
      本區段內　
      <Circle checked={inside === false} />
      本區段外(距
      <span className="inline-block w-[34px] text-center">{distance}</span>M)
    </div>
  );
}

function NameLine({ name, qty }: { name: string; qty?: string }) {
  return (
    <div className={SUB}>
      名稱：{name}
      {qty !== undefined && <span className="ml-3">數量：{qty}</span>}
    </div>
  );
}

// 單筆「名稱＋本區段內外＋距離」欄位（無獨立勾選框），如觀光遊憩設施、停車場地等
function PoiCell({ raw, showQty }: { raw: string; showQty?: boolean }) {
  const { name, qty } = parseName(raw);
  const { inside, distance } = parseLoc(raw);
  return (
    <td className={`${CELL} align-top px-[10px] py-[6px]`}>
      <NameLine name={name} qty={showQty ? qty : undefined} />
      <LocLine inside={inside} distance={distance} />
    </td>
  );
}

type PoiEntry = {
  name: string;
  metersToCenter: number;
  inside: boolean;
  // 到比準地的距離（值裡附掛「（距比準地XM）」時才有）。本表的基準是「距區段中心」，
  // 這個是表4 個別因素的基準，附帶列出供對照，見 api/types.ts FacilityItem.metersToPoint
  metersToPoint?: number;
};

// 附掛在基準形後面的第二個距離。先摘掉再判讀前半，既有的「，本區段內」／「，距NNNM」
// 兩種形狀就不必各自多處理一次
const POINT_SUFFIX_RE = /（距比準地(\d+)M）$/;

// 「名稱，距XM」或「名稱，本區段內」多筆用「；」分隔的原始字串，拆回逐筆結構；
// 空字串／"無" 視為查無資料。inside 只有在原始字串明確寫出「本區段內」時才是 true，
// 其餘（含 pointInPolygon 判斷失敗、邊界未解析）一律當本區段外處理，不臆測
function parseMultiEntries(raw: string): PoiEntry[] {
  if (!raw || raw === "無") return [];
  return raw
    .split("；")
    .filter(Boolean)
    .map((entry) => {
      const suffix = entry.match(POINT_SUFFIX_RE);
      const head = suffix ? entry.slice(0, -suffix[0].length) : entry;
      const toPoint = suffix ? { metersToPoint: Number(suffix[1]) } : {};
      if (head.endsWith("，本區段內")) {
        return {
          name: head.slice(0, -"，本區段內".length),
          metersToCenter: 0,
          inside: true,
          ...toPoint,
        };
      }
      const m = head.match(/^(.*)，距(\d+)M$/);
      return m
        ? {
            name: m[1],
            metersToCenter: Number(m[2]),
            inside: false,
            ...toPoint,
          }
        : { name: head, metersToCenter: 0, inside: false, ...toPoint };
    });
}

// 「（距比準地XM）」：本表的距離基準是區段中心，這個第二個距離用淡字附掛在後面，不搶主數字；
// 自己 nowrap 但與前面的內外欄可斷行——官方版式的格寬固定，擠成一個 nowrap 行會溢出格子
function PointDistanceNote({ meters }: { meters?: number }) {
  if (meters == null) return null;
  return (
    <span className={`${SUB} whitespace-nowrap text-[#6B7280]`}>
      （距比準地{meters}M）
    </span>
  );
}

// 單筆「名稱＋本區段內外」欄位，資料來自 deriveFacilityField 的即時查詢結果（如金融機構）；
// 沿用 parseMultiEntries 的內外判讀邏輯（inside 僅在原始字串明確寫出「本區段內」時為 true，
// 其餘一律當本區段外處理），只是版式跟 PoiCell 一樣為單筆無獨立勾選框
function BoundaryPoiCell({ raw }: { raw: string }) {
  const entry = parseMultiEntries(raw)[0];
  return (
    <td className={`${CELL} align-top px-[10px] py-[6px]`}>
      <NameLine name={entry?.name ?? "無"} />
      <LocLine
        inside={entry ? entry.inside : null}
        distance={entry && !entry.inside ? String(entry.metersToCenter) : ""}
      />
      <PointDistanceNote meters={entry?.metersToPoint} />
    </td>
  );
}

// 純文字欄位
function TextCell({ text }: { text: string }) {
  return (
    <td className={`${CELL} align-middle px-[10px] py-[6px] ${VAL}`}>
      {text || <span className="inline-block w-full">&nbsp;</span>}
    </td>
  );
}

function LabelCell({ label, rowSpan }: { label: string; rowSpan?: number }) {
  return (
    <td
      className={`${CELL} align-middle bg-[#F7F8F9] px-[10px] py-[6px] ${VAL}`}
      rowSpan={rowSpan}
    >
      {label}
    </td>
  );
}

// 「○選項 名稱：xxx 本區段內外」型子清單（如殯葬、廢棄物處理、環境污染）；
// 半徑內查得多筆同類設施時（如多座公墓），逐筆列出而非只顯示最近一筆
function CheckboxPoiList({
  options,
}: {
  options: { label: string; raw: string }[];
}) {
  return (
    <td className={`${CELL} align-top px-[10px] py-[6px]`}>
      {options.map((o) => {
        const entries = parseMultiEntries(o.raw);
        const checked = entries.length > 0;
        return (
          <div
            key={o.label}
            className="flex items-start gap-2 mb-[3px] last:mb-0"
          >
            <div className={`${SUB} w-[78px] shrink-0`}>
              <Circle checked={checked} />
              {o.label}
            </div>
            <div>
              {entries.length === 0 ? (
                <NameLine name="無" />
              ) : (
                entries.map((e, i) => (
                  <div key={i} className={SUB}>
                    <span className="whitespace-nowrap">
                      名稱：{e.name}
                      <Circle checked={e.inside} />
                      本區段內
                      <Circle checked={!e.inside} />
                      本區段外(距
                      <span className="inline-block w-[26px] text-center">
                        {e.inside ? "" : e.metersToCenter}
                      </span>
                      M)
                    </span>
                    <PointDistanceNote meters={e.metersToPoint} />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </td>
  );
}

// 「○選項名稱 本區段內外」型子清單，選項本身即名稱（如大型車站、市場，這幾項有多個固定選項要並列）
function CheckboxOptionList({
  options,
}: {
  options: {
    label: string;
    checked: boolean;
    inside: boolean | null;
    distance: string;
    metersToPoint?: number; // 見 PointDistanceNote：值裡附掛第二個距離時才有
  }[];
}) {
  return (
    <td className={`${CELL} align-top px-[10px] py-[6px]`}>
      {options.map((o) => (
        <div
          key={o.label}
          className={`grid ${COLW} items-baseline gap-x-1 ${SUB}`}
        >
          <span>
            <Circle checked={o.checked} />
            {o.label}
          </span>
          <span>
            <Circle checked={o.inside === true} />
            本區段內
          </span>
          <span>
            <Circle checked={o.inside === false} />
            本區段外(距
            <span className="inline-block w-[26px] text-center">
              {o.distance}
            </span>
            M)
            <PointDistanceNote meters={o.metersToPoint} />
          </span>
        </div>
      ))}
    </td>
  );
}

// 複選欄位（如建築基地改良/農地改良）value 以「、」串接已勾選項目
function splitMulti(value?: string): string[] {
  return (value ?? "")
    .split("、")
    .map((v) => v.trim())
    .filter(Boolean);
}

function TagChecklist({
  options,
  selected,
  mark = "□",
}: {
  options: string[];
  selected: string[];
  mark?: "□" | "○";
}) {
  return (
    <td className={`${CELL} align-top px-[10px] py-[6px]`}>
      <div className={`flex flex-wrap gap-x-3 gap-y-[3px] ${SUB}`}>
        {options.map((o) => (
          <span key={o} className="whitespace-nowrap">
            {selected.includes(o) ? (mark === "□" ? "■" : "●") : mark}
            {o}
            {o === "其他" && "＿＿＿"}
          </span>
        ))}
      </div>
    </td>
  );
}

export default function PrintableSurveyForm({
  result,
}: {
  result: ProduceResult;
}) {
  const byKey = new Map(result.survey.map((f) => [f.key, f]));
  const get = (key: string): string => byKey.get(key)?.value ?? "";
  const field = (key: string): SurveyField | undefined => byKey.get(key);

  // 大型車站的四格（高鐵／火車／客運／捷運）一律由 survey 值決定：查到站就印它的名稱並圈選，
  // 查無（值為空或以「無」開頭）才印該格的 placeholder。站名不寫死，否則換一個區段就會印出
  // 別區的站名（火車站／客運站的點位來源見 facilities/taxonomy.ts 的 railway_station /
  // bus_station）。內外與距離沿用 parseMultiEntries 的判讀，與其他設施欄位同一套。
  const stationOption = (key: string, placeholder: string) => {
    const raw = get(key);
    const entry = parseMultiEntries(raw)[0];
    const exists = !!entry?.name && !entry.name.startsWith("無");
    if (!exists) {
      return { label: placeholder, checked: false, inside: null, distance: "" };
    }
    // 值裡沒有任何內外／距離資訊時不宣稱內外，也不印「距 0 M」——那會是一句不實的勘查記載
    const hasLoc = /本區段/.test(raw) || /距\s*\d+\s*M/.test(raw);
    return {
      label: entry.name,
      checked: true,
      inside: hasLoc ? entry.inside : null,
      distance: hasLoc && !entry.inside ? String(entry.metersToCenter) : "",
      metersToPoint: entry.metersToPoint,
    };
  };

  const busStopRaw = get("bus_stop");
  const busStopEntries = parseMultiEntries(busStopRaw);
  const busDensity = busStopRaw.includes("密集程度：")
    ? busStopRaw.split("密集程度：")[1]
    : "";

  const mainRoadMatch = get("main_road").match(/^(.*?)，寬度(\d+)M$/);
  const mainRoadName = mainRoadMatch ? mainRoadMatch[1] : get("main_road");
  const mainRoadWidth = mainRoadMatch ? mainRoadMatch[2] : "";

  const roadAvgWidthMatch = get("road_avg_width").match(/^(\d+)M$/);
  const roadAvgWidthValue = roadAvgWidthMatch
    ? roadAvgWidthMatch[1]
    : get("road_avg_width");

  const marketRaw = get("market");
  const marketLoc = parseLoc(marketRaw);
  const marketName = parseName(marketRaw).name;
  const hasMarket = !!marketName && marketName !== "無";

  const siteImprovement = field("site_improvement");
  const farmlandImprovement = field("farmland_improvement");
  const landUse = field("land_use_status");

  return (
    <div
      id="print-root"
      className="w-[1180px] bg-white text-[#1A1A1A] p-[48px]"
      style={{ fontFamily: KAI_FONT }}
    >
      <div className="mb-[10px]">
        <div className="text-[22px] font-bold tracking-wide">
          表1　地價區段勘查表
        </div>
        <div className="text-[14px] mt-[3px]">{result.meta.district}</div>
      </div>

      <table className={`w-full border-collapse ${CELL} mb-[6px]`}>
        <tbody>
          <tr>
            <td
              className={`${CELL} align-middle bg-[#F0F1F3] px-[10px] py-[8px] text-[13px] font-semibold w-[40px] text-center`}
            >
              年<br />期
            </td>
            <td
              className={`${CELL} align-middle px-[10px] py-[8px] text-[14px] w-[100px]`}
            >
              {result.meta.yearPeriod}
            </td>
            <td
              className={`${CELL} align-middle bg-[#F0F1F3] px-[10px] py-[8px] text-[13px] font-semibold w-[68px] text-center`}
            >
              區段編號
            </td>
            <td
              className={`${CELL} align-middle px-[10px] py-[8px] text-[14px] font-mono w-[100px]`}
            >
              {result.meta.sectionId}
            </td>
            <td
              className={`${CELL} align-middle bg-[#F0F1F3] px-[10px] py-[8px] text-[11px] font-semibold w-[76px] text-center`}
            >
              區段範圍
              <div className="font-normal text-[9.5px] text-[#6B7280] leading-tight mt-[3px]">
                （公共設施保留地請填明毗鄰非保留地區段號）
              </div>
            </td>
            <td
              className={`${CELL} align-middle px-[10px] py-[8px] text-[12px] leading-[17px]`}
            >
              {result.meta.range}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="flex gap-[4px]">
        {/* ───────────────────────── 左半 ───────────────────────── */}
        <table className={`flex-1 table-fixed border-collapse ${CELL}`}>
          <ColGroup />
          <tbody>
            {/* 土地使用管制 */}
            <tr>
              <CategoryCell label="土地使用管制" rowSpan={6} />
              <WeightCell w={[1, 2]} />
              <LabelCell label="都市計畫(內外)" />
              <TextCell text={get("urban_plan")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="使用分區(使用地類別)" />
              <TextCell text={get("zone_type")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="建蔽率" />
              <TextCell text={get("coverage_ratio")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="容積率" />
              <TextCell text={get("plot_ratio")} />
            </tr>
            <tr>
              <WeightCell w={[1, 2]} />
              <LabelCell label="有無禁止建築" />
              <TextCell text={get("no_build_ban")} />
            </tr>
            <tr>
              <WeightCell w={[1, 2]} />
              <LabelCell label="有無限制建築(整體開發、面積限制、高度限制)" />
              <TextCell text={get("build_restriction")} />
            </tr>

            {/* 交通運輸 */}
            <tr>
              <CategoryCell label="交通運輸" rowSpan={9} />
              <WeightCell w={[3, 5]} />
              <LabelCell label="主要道路" />
              <td className={`${CELL} align-middle p-0`}>
                <div className="flex">
                  <div
                    className={`flex-[3] border-r ${BORDER} px-[10px] py-[6px] ${VAL}`}
                  >
                    名稱：{mainRoadName}
                  </div>
                  <div
                    className={`flex-[2] px-[10px] py-[6px] ${VAL} whitespace-nowrap`}
                  >
                    寬度：{mainRoadWidth} M
                  </div>
                </div>
              </td>
            </tr>
            <tr>
              <WeightCell w={[3, 5]} />
              <LabelCell label="區段內道路平均寬度" />
              <td className={`${CELL} align-middle px-[10px] py-[6px] ${VAL}`}>
                {roadAvgWidthValue}
                <span className="inline-block w-[64px]" />M
              </td>
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="大型車站" />
              <CheckboxOptionList
                options={[
                  stationOption("hsr_station", "無高鐵站"),
                  stationOption("train_station", "無火車站"),
                  stationOption("bus_terminal", "無客運站"),
                  stationOption("mrt_station", "無捷運站"),
                ]}
              />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="站牌" />
              <td className={`${CELL} align-top px-[10px] py-[6px]`}>
                {busStopEntries.length === 0 ? (
                  <NameLine name="無" />
                ) : (
                  <>
                    {busStopEntries.length > 1 && (
                      <div className={`${SUB} text-[#6B7280] mb-[2px]`}>
                        共{busStopEntries.length}筆
                      </div>
                    )}
                    {busStopEntries.map((e, i) => (
                      <div key={i} className="mb-[3px] last:mb-0">
                        <NameLine name={e.name} />
                        <LocLine
                          inside={e.inside}
                          distance={e.inside ? "" : String(e.metersToCenter)}
                        />
                        <PointDistanceNote meters={e.metersToPoint} />
                      </div>
                    ))}
                  </>
                )}
                <div className={`${SUB} whitespace-nowrap mt-[3px]`}>
                  密集程度：
                  <Circle checked={busDensity === "非常密集"} />
                  非常密集
                  <Circle checked={busDensity === "密集"} />
                  密集
                  <Circle checked={busDensity === "不密集"} />
                  不密集
                </div>
              </td>
            </tr>
            <tr>
              <WeightCell w={[5, 5]} />
              <LabelCell label="交流道" />
              <PoiCell raw={get("interchange")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="接近聚落程度" />
              <TextCell text={get("approach_settlement")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="接近運銷中心程度" />
              <TextCell text={get("approach_distribution_center")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="接近消費市場程度" />
              <TextCell text={get("approach_market")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="區段內道路規劃及闢建程度" />
              <TextCell text={get("road_development")} />
            </tr>

            {/* 自然條件 */}
            <tr>
              <CategoryCell label="自然條件" rowSpan={7} />
              <WeightCell />
              <LabelCell label="日　照" />
              <TextCell text={get("sunlight")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="景　觀" />
              <TextCell text={get("view")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="傾斜度" />
              <TextCell text={get("slope")} />
            </tr>
            <tr>
              <WeightCell w={[2, 5]} />
              <LabelCell label="保（排）水之良否" />
              <TextCell text={get("drainage")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="地　勢" />
              <TextCell text={get("terrain")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="風　勢" />
              <TextCell text={get("wind")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="土　質" />
              <TextCell text={get("soil")} />
            </tr>

            {/* 土地改良 */}
            <tr>
              <CategoryCell label="土地改良" rowSpan={2} />
              <WeightCell />
              <LabelCell label="建築基地改良" />
              <TagChecklist
                options={siteImprovement?.options ?? []}
                selected={splitMulti(siteImprovement?.value)}
                mark="□"
              />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="農地改良" />
              <TagChecklist
                options={farmlandImprovement?.options ?? []}
                selected={splitMulti(farmlandImprovement?.value)}
                mark="□"
              />
            </tr>

            {/* 公共建設（下半：學校／市場／公園） */}
            <tr>
              <CategoryCell label="公共建設" rowSpan={3} />
              <WeightCell w={[1, 5]} />
              <LabelCell label="學　校" />
              <BoundaryPoiCell raw={get("school")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="市　場" />
              <CheckboxOptionList
                options={[
                  {
                    label: hasMarket ? marketName : "傳統市場",
                    checked: hasMarket,
                    inside: marketLoc.inside,
                    distance: marketLoc.distance,
                  },
                  {
                    label: "超級市場",
                    checked: false,
                    inside: null,
                    distance: "",
                  },
                  {
                    label: "超大型購物中心",
                    checked: false,
                    inside: null,
                    distance: "",
                  },
                ]}
              />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="公園廣場徒步區" />
              <BoundaryPoiCell raw={get("park")} />
            </tr>
          </tbody>
        </table>

        {/* ───────────────────────── 右半 ───────────────────────── */}
        <table className={`flex-1 table-fixed border-collapse ${CELL}`}>
          <ColGroup />
          <tbody>
            {/* 公共建設（上半） */}
            <tr>
              <CategoryCell label="公共建設" rowSpan={6} />
              <WeightCell w={[1, 5]} />
              <LabelCell label="觀光遊憩設施" />
              <PoiCell raw={get("tourism_facility")} />
            </tr>
            <tr>
              <WeightCell w={[2, 5]} />
              <LabelCell label="停車場地" />
              <BoundaryPoiCell raw={get("parking")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="接近服務性設施的程度" />
              <PoiCell raw={get("service_facility")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="電力資源" />
              <TextCell text={get("power_resource")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="產業用水及設施" />
              <TextCell text={get("industrial_water")} />
            </tr>
            <tr>
              <WeightCell />
              <LabelCell label="污廢水及廢棄物處理設施" />
              <PoiCell raw={get("sewage_facility")} />
            </tr>

            {/* 特殊設施 */}
            <tr>
              <CategoryCell label="特殊設施" rowSpan={3} />
              <WeightCell w={[5, 5]} />
              <LabelCell label="電業氣體燃料" />
              <td className={`${CELL} align-top px-[10px] py-[6px]`}>
                <div className="mb-[6px]">
                  <div className={`${SUB} text-[#6B7280]`}>
                    變電所或高壓鐵塔
                  </div>
                  <PoiInline raw={get("substation")} />
                </div>
                <div>
                  <div className={`${SUB} text-[#6B7280]`}>瓦斯槽或儲油槽</div>
                  <PoiInline raw={get("gas_tank")} />
                </div>
              </td>
            </tr>
            <tr>
              <WeightCell w={[5, 5]} />
              <LabelCell label="殯　葬" />
              <CheckboxPoiList
                options={[
                  { label: "墓　地", raw: get("cemetery") },
                  { label: "殯儀館", raw: get("funeral_home") },
                  { label: "火葬場", raw: get("crematorium") },
                  { label: "納骨塔", raw: get("columbarium") },
                ]}
              />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="廢棄物處理" />
              <CheckboxPoiList
                options={[
                  { label: "污水處理場", raw: get("sewage_plant") },
                  { label: "垃圾場或掩埋場", raw: get("landfill") },
                  { label: "焚化爐", raw: get("incinerator") },
                ]}
              />
            </tr>

            {/* 環境污染 */}
            <tr>
              <CategoryCell label="環境污染" rowSpan={1} />
              <WeightCell w={[1, 5]} />
              <LabelCell label="環境污染" />
              <CheckboxPoiList
                options={[
                  { label: "水污染", raw: get("water_pollution") },
                  { label: "噪音污染", raw: get("noise_pollution") },
                  { label: "廢氣污染", raw: get("air_pollution") },
                  { label: "廢棄物污染", raw: get("waste_pollution") },
                  { label: "其他污染", raw: get("other_pollution") },
                ]}
              />
            </tr>

            {/* 工商活動 */}
            <tr>
              <CategoryCell label="工商活動" rowSpan={6} />
              <WeightCell w={[5, 5]} />
              <LabelCell label="百貨公司" />
              <PoiCell raw={get("department_store")} showQty />
            </tr>
            <tr>
              <WeightCell w={[2, 5]} />
              <LabelCell label="金融機構" />
              <BoundaryPoiCell raw={get("financial_institution")} />
            </tr>
            <tr>
              <WeightCell w={[5, 5]} />
              <LabelCell label="娛樂設施" />
              <PoiCell raw={get("entertainment")} showQty />
            </tr>
            <tr>
              <WeightCell w={[3, 5]} />
              <LabelCell label="大型展示中心或觀光飯店" />
              <PoiCell raw={get("exhibition_hotel")} showQty />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="顧客之通行量" />
              <TextCell text={get("customer_flow")} />
            </tr>
            <tr>
              <WeightCell w={[1, 5]} />
              <LabelCell label="店鋪之毗連狀態" />
              <TextCell text={get("shop_adjacency")} />
            </tr>

            {/* 其他影響因素：房屋建築現況／土地利用現況 */}
            <tr>
              <CategoryCell label="其他影響因素" rowSpan={1} />
              <WeightCell />
              <td className={`${CELL} p-0`} colSpan={2}>
                <table className="w-full border-collapse">
                  <tbody>
                    <tr>
                      <td
                        className={`${CELL} align-middle border-l-0 border-t-0 w-[86px] bg-[#F7F8F9] px-[10px] py-[6px] ${SUB}`}
                        rowSpan={2}
                      >
                        房屋建築現況
                      </td>
                      <td
                        className={`${CELL} align-middle border-l-0 border-t-0 w-[72px] bg-[#FBFBFC] px-[10px] py-[6px] ${SUB}`}
                      >
                        建築密度
                      </td>
                      <td
                        className={`${CELL} align-middle border-t-0 px-[10px] py-[6px] ${VAL}`}
                      >
                        {get("building_density")}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className={`${CELL} align-middle border-l-0 border-t-0 bg-[#FBFBFC] px-[10px] py-[6px] ${SUB}`}
                      >
                        建築型態
                      </td>
                      <td
                        className={`${CELL} align-middle border-t-0 px-[10px] py-[6px] ${VAL}`}
                      >
                        {get("building_type")}
                      </td>
                    </tr>
                    <tr>
                      <td
                        className={`${CELL} align-middle border-l-0 border-t-0 bg-[#F7F8F9] px-[10px] py-[6px] ${SUB}`}
                      >
                        土地利用現況
                      </td>
                      <td
                        className={`${CELL} align-top border-t-0 px-[10px] py-[8px]`}
                        colSpan={2}
                      >
                        <div
                          className={`grid grid-cols-4 gap-x-3 gap-y-[3px] ${SUB}`}
                        >
                          {(() => {
                            const selected = splitMulti(landUse?.value);
                            return (landUse?.options ?? []).map((o) => (
                              <span key={o} className="whitespace-nowrap">
                                {selected.includes(o) ? "●" : "○"}
                                {o}
                                {o === "其他" && "＿＿＿"}
                              </span>
                            ));
                          })()}
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-[16px] pt-[10px] border-t border-[#C7CBD1] flex flex-wrap items-center gap-x-8 gap-y-[6px] text-[13px]">
        <span>勘查日期：{result.meta.surveyDate}</span>
        <span>承辦員：＿＿＿＿＿＿</span>
        <span>課(股)長：＿＿＿＿＿＿</span>
        <span>主任（局、處長）：＿＿＿＿＿＿</span>
      </div>
      <div className="mt-[8px] text-[13px]">不動產估價師：＿＿＿＿＿＿</div>
    </div>
  );
}

function PoiInline({ raw }: { raw: string }) {
  const { name } = parseName(raw);
  const { inside, distance } = parseLoc(raw);
  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className={SUB}>名稱：{name}</span>
      <LocLine inside={inside} distance={distance} />
    </div>
  );
}
