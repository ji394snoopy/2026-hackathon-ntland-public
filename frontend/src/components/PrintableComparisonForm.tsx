import type { ComparisonCase, ProduceResult } from "../types";

// 完全比照官方紙本表4版式的輸出用元件（供 html2canvas 擷取列印/PDF）。
// 版面骨架（欄序、項次、標籤）為表4固定格式；顯示值一律取自 result.comparisonForm（JSON 狀態）。
//
// 欄位模型（10 欄，寬度需與 ColGroup 完全對應，任何列的 colSpan 加總都必須＝當列實際欄數，
// 否則 table-layout:fixed 會讓 colgroup 寬度與實際欄位錯位，導致文字重疊）：
//   col0 個別因素調整／比較價格／備註欄（跨列大分類，20px）
//   col1 1~6 之細分類（20px，0基本資料區塊借用做第二欄標籤）
//   col2 項次＋標籤（130px）
//   col3 比準地條件（190px）
//   col4 比較標的1條件（190px）　col5 比較標的1差異率（70px）
//   col6 比較標的2條件（190px）　col7 比較標的2差異率（70px）
//   col8 比較標的3條件（190px）　col9 比較標的3差異率（70px）

const KAI_FONT =
  "'標楷體-繁', 'DFKai-SB', 'BiauKai', 'Kaiti TC', 'STKaiti', 'Kaiti SC', '標楷體', 'KaiTi', serif";

const BORDER = "border-[#8A8F98]";
const CELL = `border ${BORDER}`; // 不預設 vertical-align：各欄位自行決定置中或靠上
const VAL = "text-[12px] leading-[16px]";
const SUB = "text-[11px] leading-[14px]";
const HEAD_BG = "bg-[#FFFDE7]"; // 比準地／比較標的欄頭底色
const CAT_BG = "bg-[#F0F1F3]";

function ColGroup() {
  return (
    <colgroup>
      <col style={{ width: "20px" }} />
      <col style={{ width: "20px" }} />
      <col style={{ width: "130px" }} />
      <col style={{ width: "190px" }} />
      <col style={{ width: "190px" }} />
      <col style={{ width: "70px" }} />
      <col style={{ width: "190px" }} />
      <col style={{ width: "70px" }} />
      <col style={{ width: "190px" }} />
      <col style={{ width: "70px" }} />
    </colgroup>
  );
}

function VerticalLabel({ label, rowSpan }: { label: string; rowSpan: number }) {
  return (
    <td
      className={`${CELL} align-middle ${CAT_BG} p-0 text-center`}
      rowSpan={rowSpan}
    >
      <div className="text-[12px] font-bold leading-[15px] py-[4px] tracking-widest [writing-mode:vertical-rl] inline-block">
        {label}
      </div>
    </td>
  );
}

function ItemLabel({ text }: { text: string }) {
  return (
    <td className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] ${SUB}`}>
      {text}
    </td>
  );
}

function Cond({ text, dim }: { text: string; dim?: boolean }) {
  return (
    <td
      className={`${CELL} align-middle px-[8px] py-[4px] ${VAL} text-center ${dim ? "text-[#B7BDC6]" : ""}`}
    >
      {text || " "}
    </td>
  );
}

// 用 inline-block + 內聯寬度而非 CSS grid／巢狀 table：同一列出現兩份相同版面結構時，
// html2canvas 對 grid／巢狀 table 的版面量測會互相干擾，造成第二份文字重疊或換行錯亂；
// 純 inline-block 定寬 span 是 html2canvas 對一般文字方塊最穩定的擷取路徑
function Triple({
  name,
  value,
  unit = "M",
}: {
  name: string;
  value: string;
  unit?: string;
}) {
  return (
    <td
      className={`${CELL} align-middle px-[6px] py-[4px] whitespace-nowrap ${SUB}`}
    >
      {value ? `${name}(${value} ${unit})` : name}
    </td>
  );
}

function Rate({ value }: { value: number | null }) {
  return (
    <td
      className={`${CELL} align-middle px-[6px] py-[4px] ${VAL} font-mono text-center`}
    >
      {value === null ? "-" : `${value.toFixed(2)}%`}
    </td>
  );
}

// 個別因素調整每一列的「比較標的N條件＋差異率」一對欄位，1~3筆比較標的各自一份，
// 不共用同一個差異率數字（見上方 rateOf 說明）
function CondRate({ text, rate }: { text: string; rate: number | null }) {
  return (
    <>
      <Cond text={text} />
      <Rate value={rate} />
    </>
  );
}

function TripleRate({
  name,
  value,
  unit,
  rate,
}: {
  name: string;
  value: string;
  unit?: string;
  rate: number | null;
}) {
  return (
    <>
      <Triple name={name} value={value} unit={unit} />
      <Rate value={rate} />
    </>
  );
}

function Blank({
  colSpan = 1,
  cat = false,
}: {
  colSpan?: number;
  cat?: boolean;
}) {
  return (
    <td
      className={`${CELL} align-middle px-[6px] py-[4px] ${cat ? CAT_BG : ""}`}
      colSpan={colSpan}
    >
      &nbsp;
    </td>
  );
}

export default function PrintableComparisonForm({
  result,
}: {
  result: ProduceResult;
}) {
  const { comparisonForm: f } = result;
  const b = f.benchmark;
  const c: ComparisonCase | undefined = f.cases[0];
  const c2: ComparisonCase | undefined = f.cases[1];
  const c3: ComparisonCase | undefined = f.cases[2];
  // 逐列取出各比較標的自己的差異率：跟 compare[0]/[1]/[2] 索引對齊 f.cases，不是共用同一個數字
  const rateOf = (key: string, caseIndex: number): number | null =>
    result.comparison.find((row) => row.key === key)?.compare[caseIndex]
      ?.rate ?? null;
  // null(需人工複核)視為0、不列入合計，跟 lib/pricing.ts recomputeChain 算法一致
  const individualTotalOf = (caseIndex: number): number =>
    result.comparison.reduce(
      (sum, row) => sum + (row.compare[caseIndex]?.rate ?? 0),
      0,
    );

  return (
    <div
      id="print-root-comparison"
      className="w-[1140px] bg-white text-[#1A1A1A] p-[40px]"
      style={{ fontFamily: KAI_FONT }}
    >
      <div className="flex items-baseline justify-between mb-[8px]">
        <div className="text-[20px] font-bold tracking-wide">
          表4　比較法調查估價表
        </div>
        <div className="text-[13px]">估價基準日：{f.appraisalBaseDate}</div>
        <div className="text-[13px]">案號：{f.caseCode}</div>
      </div>

      <table className={`w-full table-fixed border-collapse ${CELL}`}>
        <ColGroup />
        <tbody>
          {/* ── 表頭：調整項目／比準地／比較標的1~3（col0-2 + col3 + (col4,5) + (col6,7) + (col8,9) = 10） ── */}
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} text-center font-bold ${VAL}`}
              colSpan={3}
              rowSpan={2}
            >
              調整項目
            </td>
            <td
              className={`${CELL} align-middle ${HEAD_BG} px-[8px] py-[4px] text-center ${SUB}`}
            >
              比準地：宗地流水號　{f.benchmarkParcelNo}
            </td>
            <td
              className={`${CELL} align-middle ${HEAD_BG} px-[8px] py-[4px] text-center font-semibold ${VAL}`}
            >
              比較標的1
            </td>
            <td
              className={`${CELL} align-middle ${HEAD_BG} px-[8px] py-[4px] text-center font-semibold ${VAL}`}
            >
              比較標的2
            </td>
            <td
              className={`${CELL} align-middle ${HEAD_BG} px-[8px] py-[4px] text-center font-semibold ${VAL}`}
            >
              比較標的3
            </td>
          </tr>
          <tr>
            {/* col0-2 由上列 rowSpan 覆蓋 */}
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              條件
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              條件
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              差異率
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              條件
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              差異率
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              條件
            </td>
            <td
              className={`${CELL} align-middle text-center ${SUB} font-semibold`}
            >
              差異率
            </td>
          </tr>

          {/* ── 0基本資料 ─────────────────────────────────────────── */}
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] text-center ${SUB}`}
              colSpan={3}
            >
              0基本資料
            </td>
            <Cond text={b.location} />
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center ${VAL}`}
              colSpan={2}
            >
              {c?.location ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center ${VAL}`}
              colSpan={2}
            >
              {c2?.location ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center ${VAL}`}
              colSpan={2}
            >
              {c3?.location ?? ""}
            </td>
          </tr>
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] text-center ${SUB}`}
              colSpan={3}
            >
              土地正常單價
            </td>
            <Blank />
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c ? c.normalPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c2 ? c2.normalPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c3 ? c3.normalPrice.toLocaleString() : ""}
            </td>
          </tr>
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[6px] py-[4px] text-center ${SUB}`}
            >
              交易日期
            </td>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[6px] py-[4px] text-center ${SUB}`}
              colSpan={2}
            >
              調整百分率
            </td>
            <Blank />
            <Cond text={c?.tradeDate ?? ""} />
            <Cond text={c ? `${c.dateAdjRate.toFixed(2)}%` : ""} />
            <Cond text={c2?.tradeDate ?? ""} />
            <Cond text={c2 ? `${c2.dateAdjRate.toFixed(2)}%` : ""} />
            <Cond text={c3?.tradeDate ?? ""} />
            <Cond text={c3 ? `${c3.dateAdjRate.toFixed(2)}%` : ""} />
          </tr>
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] text-center ${SUB}`}
              colSpan={3}
            >
              調整至估價基準日單價(元/M²)
            </td>
            <Blank />
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c ? c.adjustedPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c2 ? c2.adjustedPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono ${VAL}`}
              colSpan={2}
            >
              {c3 ? c3.adjustedPrice.toLocaleString() : ""}
            </td>
          </tr>
          <tr>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[6px] py-[4px] text-center ${SUB}`}
            >
              地價區段
            </td>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[6px] py-[4px] text-center ${SUB}`}
              colSpan={2}
            >
              區域因素調整百分率
            </td>
            <Cond text={b.sectionId} />
            <Cond text={c?.sectionId ?? ""} />
            <Cond text={c ? `${c.regionalAdjRate.toFixed(2)}%` : ""} />
            <Cond text={c2?.sectionId ?? ""} />
            <Cond text={c2 ? `${c2.regionalAdjRate.toFixed(2)}%` : ""} />
            <Cond text={c3?.sectionId ?? ""} />
            <Cond text={c3 ? `${c3.regionalAdjRate.toFixed(2)}%` : ""} />
          </tr>

          {/* ── 個別因素調整：1宗地條件 ────────────────────────────── */}
          <tr>
            <VerticalLabel label="個別因素調整" rowSpan={20} />
            <VerticalLabel label="1宗地條件" rowSpan={6} />
            <ItemLabel text="7面積(M²)" />
            <Cond text={b.area} />
            <CondRate text={c?.area ?? ""} rate={rateOf("area", 0)} />
            <CondRate text={c2?.area ?? ""} rate={rateOf("area", 1)} />
            <CondRate text={c3?.area ?? ""} rate={rateOf("area", 2)} />
          </tr>
          <tr>
            <ItemLabel text="8寬度(M)" />
            <Cond text={b.width} />
            <CondRate text={c?.width ?? ""} rate={rateOf("width", 0)} />
            <CondRate text={c2?.width ?? ""} rate={rateOf("width", 1)} />
            <CondRate text={c3?.width ?? ""} rate={rateOf("width", 2)} />
          </tr>
          <tr>
            <ItemLabel text="9深度(M)" />
            <Cond text={b.depth} />
            <CondRate text={c?.depth ?? ""} rate={rateOf("depth", 0)} />
            <CondRate text={c2?.depth ?? ""} rate={rateOf("depth", 1)} />
            <CondRate text={c3?.depth ?? ""} rate={rateOf("depth", 2)} />
          </tr>
          <tr>
            <ItemLabel text="10形狀" />
            <Cond text={b.shape} />
            <CondRate text={c?.shape ?? ""} rate={rateOf("shape", 0)} />
            <CondRate text={c2?.shape ?? ""} rate={rateOf("shape", 1)} />
            <CondRate text={c3?.shape ?? ""} rate={rateOf("shape", 2)} />
          </tr>
          <tr>
            <ItemLabel text="11臨街情形" />
            <Cond text={b.frontage} />
            <CondRate text={c?.frontage ?? ""} rate={rateOf("frontage", 0)} />
            <CondRate text={c2?.frontage ?? ""} rate={rateOf("frontage", 1)} />
            <CondRate text={c3?.frontage ?? ""} rate={rateOf("frontage", 2)} />
          </tr>
          <tr>
            <ItemLabel text="12地勢" />
            <Cond text={b.terrain} />
            <CondRate text={c?.terrain ?? ""} rate={rateOf("terrain", 0)} />
            <CondRate text={c2?.terrain ?? ""} rate={rateOf("terrain", 1)} />
            <CondRate text={c3?.terrain ?? ""} rate={rateOf("terrain", 2)} />
          </tr>

          {/* ── 2道路條件 ─────────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="2道路條件" rowSpan={2} />
            <ItemLabel text="13道路種類" />
            <Cond text={b.roadType} />
            <CondRate text={c?.roadType ?? ""} rate={rateOf("roadType", 0)} />
            <CondRate text={c2?.roadType ?? ""} rate={rateOf("roadType", 1)} />
            <CondRate text={c3?.roadType ?? ""} rate={rateOf("roadType", 2)} />
          </tr>
          <tr>
            <ItemLabel text="14面前道路寬度" />
            <Triple name={b.roadName} value={b.roadWidth} />
            <TripleRate
              name={c?.roadName ?? ""}
              value={c?.roadWidth ?? ""}
              rate={rateOf("roadWidth", 0)}
            />
            <TripleRate
              name={c2?.roadName ?? ""}
              value={c2?.roadWidth ?? ""}
              rate={rateOf("roadWidth", 1)}
            />
            <TripleRate
              name={c3?.roadName ?? ""}
              value={c3?.roadWidth ?? ""}
              rate={rateOf("roadWidth", 2)}
            />
          </tr>

          {/* ── 3接近條件 ─────────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="3接近條件" rowSpan={5} />
            <ItemLabel text="15接近學校之程度" />
            <Triple name={b.schoolName} value={b.schoolDistance} />
            <TripleRate
              name={c?.schoolName ?? ""}
              value={c?.schoolDistance ?? ""}
              rate={rateOf("school", 0)}
            />
            <TripleRate
              name={c2?.schoolName ?? ""}
              value={c2?.schoolDistance ?? ""}
              rate={rateOf("school", 1)}
            />
            <TripleRate
              name={c3?.schoolName ?? ""}
              value={c3?.schoolDistance ?? ""}
              rate={rateOf("school", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="16接近市場之程度" />
            <Triple name={b.marketName} value={b.marketDistance} />
            <TripleRate
              name={c?.marketName ?? ""}
              value={c?.marketDistance ?? ""}
              rate={rateOf("market", 0)}
            />
            <TripleRate
              name={c2?.marketName ?? ""}
              value={c2?.marketDistance ?? ""}
              rate={rateOf("market", 1)}
            />
            <TripleRate
              name={c3?.marketName ?? ""}
              value={c3?.marketDistance ?? ""}
              rate={rateOf("market", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="17接近公園、廣場之程度" />
            <Triple name={b.parkName} value={b.parkDistance} />
            <TripleRate
              name={c?.parkName ?? ""}
              value={c?.parkDistance ?? ""}
              rate={rateOf("park", 0)}
            />
            <TripleRate
              name={c2?.parkName ?? ""}
              value={c2?.parkDistance ?? ""}
              rate={rateOf("park", 1)}
            />
            <TripleRate
              name={c3?.parkName ?? ""}
              value={c3?.parkDistance ?? ""}
              rate={rateOf("park", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="18接近車站之程度" />
            <Triple name={b.stationName} value={b.stationDistance} />
            <TripleRate
              name={c?.stationName ?? ""}
              value={c?.stationDistance ?? ""}
              rate={rateOf("station", 0)}
            />
            <TripleRate
              name={c2?.stationName ?? ""}
              value={c2?.stationDistance ?? ""}
              rate={rateOf("station", 1)}
            />
            <TripleRate
              name={c3?.stationName ?? ""}
              value={c3?.stationDistance ?? ""}
              rate={rateOf("station", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="19接近商圈之程度" />
            <Triple name={b.districtName} value={b.districtDistance} />
            <TripleRate
              name={c?.districtName ?? ""}
              value={c?.districtDistance ?? ""}
              rate={rateOf("district", 0)}
            />
            <TripleRate
              name={c2?.districtName ?? ""}
              value={c2?.districtDistance ?? ""}
              rate={rateOf("district", 1)}
            />
            <TripleRate
              name={c3?.districtName ?? ""}
              value={c3?.districtDistance ?? ""}
              rate={rateOf("district", 2)}
            />
          </tr>

          {/* ── 4周邊環境條件 ─────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="4周邊環境條件" rowSpan={2} />
            <ItemLabel text="20嫌惡設施(類型)" />
            <Triple name={b.disamenityName} value={b.disamenityDistance} />
            <TripleRate
              name={c?.disamenityName ?? ""}
              value={c?.disamenityDistance ?? ""}
              rate={rateOf("disamenity", 0)}
            />
            <TripleRate
              name={c2?.disamenityName ?? ""}
              value={c2?.disamenityDistance ?? ""}
              rate={rateOf("disamenity", 1)}
            />
            <TripleRate
              name={c3?.disamenityName ?? ""}
              value={c3?.disamenityDistance ?? ""}
              rate={rateOf("disamenity", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="21停車方便性" />
            <Cond text={b.parking} />
            <CondRate text={c?.parking ?? ""} rate={rateOf("parking", 0)} />
            <CondRate text={c2?.parking ?? ""} rate={rateOf("parking", 1)} />
            <CondRate text={c3?.parking ?? ""} rate={rateOf("parking", 2)} />
          </tr>

          {/* ── 5行政條件 ─────────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="5行政條件" rowSpan={4} />
            <ItemLabel text="22使用分區或編定用地" />
            <Cond text={b.zoning} />
            <CondRate text={c?.zoning ?? ""} rate={rateOf("zoning", 0)} />
            <CondRate text={c2?.zoning ?? ""} rate={rateOf("zoning", 1)} />
            <CondRate text={c3?.zoning ?? ""} rate={rateOf("zoning", 2)} />
          </tr>
          <tr>
            <ItemLabel text="23建蔽率(%)" />
            <Cond text={b.coverageRatio} />
            <CondRate
              text={c?.coverageRatio ?? ""}
              rate={rateOf("coverageRatio", 0)}
            />
            <CondRate
              text={c2?.coverageRatio ?? ""}
              rate={rateOf("coverageRatio", 1)}
            />
            <CondRate
              text={c3?.coverageRatio ?? ""}
              rate={rateOf("coverageRatio", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="24容積率(%)" />
            <Cond text={b.plotRatio} />
            <CondRate text={c?.plotRatio ?? ""} rate={rateOf("plotRatio", 0)} />
            <CondRate
              text={c2?.plotRatio ?? ""}
              rate={rateOf("plotRatio", 1)}
            />
            <CondRate
              text={c3?.plotRatio ?? ""}
              rate={rateOf("plotRatio", 2)}
            />
          </tr>
          <tr>
            <ItemLabel text="25有無禁限建" />
            <Cond text={b.buildRestriction} />
            <CondRate
              text={c?.buildRestriction ?? ""}
              rate={rateOf("buildRestriction", 0)}
            />
            <CondRate
              text={c2?.buildRestriction ?? ""}
              rate={rateOf("buildRestriction", 1)}
            />
            <CondRate
              text={c3?.buildRestriction ?? ""}
              rate={rateOf("buildRestriction", 2)}
            />
          </tr>

          {/* ── 6其他（col1 無 rowSpan 承接，需自行補一個分類欄位） ──── */}
          <tr>
            <Blank cat />
            <ItemLabel text="6其他" />
            <Cond text="–" dim />
            <Cond text="–" dim />
            <Rate value={null} />
            <Blank />
            <Blank />
            <Blank />
            <Blank />
          </tr>

          {/* ── 合計（不在「個別因素調整」rowSpan=20 範圍內，需自帶 col0） ── */}
          <tr className="bg-[#EEF2F7]">
            <td
              className={`${CELL} align-middle text-center font-bold ${VAL}`}
              colSpan={3}
            >
              合計
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono font-bold ${VAL}`}
              colSpan={2}
            >
              {individualTotalOf(0).toFixed(2)}%
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono font-bold ${VAL}`}
              colSpan={2}
            >
              {c2 ? `${individualTotalOf(1).toFixed(2)}%` : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono font-bold ${VAL}`}
              colSpan={2}
            >
              {c3 ? `${individualTotalOf(2).toFixed(2)}%` : ""}
            </td>
          </tr>

          {/* ── 比較價格 ──────────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="比較價格" rowSpan={3} />
            <Blank cat />
            <ItemLabel text="調整百分率絕對值加總" />
            <ItemLabel text="價格形成因素之相近程度" />
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c ? `${c.absRateSum.toFixed(2)}%` : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c?.priceSimilarity ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c2 ? `${c2.absRateSum.toFixed(2)}%` : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c2?.priceSimilarity ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c3 ? `${c3.absRateSum.toFixed(2)}%` : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c3?.priceSimilarity ?? ""}
            </td>
          </tr>
          <tr>
            <Blank cat />
            <ItemLabel text="試算價格" />
            <ItemLabel text="比較標的權重" />
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c ? c.trialPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c?.weight ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c2 ? c2.trialPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c2?.weight ?? ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center font-mono ${VAL}`}
            >
              {c3 ? c3.trialPrice.toLocaleString() : ""}
            </td>
            <td
              className={`${CELL} align-middle px-[6px] py-[4px] text-center ${VAL}`}
            >
              {c3?.weight ?? ""}
            </td>
          </tr>
          <tr className="bg-[#EEF2F7]">
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-semibold ${VAL}`}
              colSpan={2}
            >
              比準地比較價格
            </td>
            <td
              className={`${CELL} align-middle px-[8px] py-[4px] text-center font-mono font-bold text-[#12457B] ${VAL}`}
              colSpan={7}
            >
              {f.benchmarkComparedPrice.toLocaleString()}
            </td>
          </tr>

          {/* ── 備註欄 ────────────────────────────────────────────── */}
          <tr>
            <VerticalLabel label="備註欄" rowSpan={2} />
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] ${SUB}`}
              colSpan={2}
            >
              備註
            </td>
            <td
              className={`${CELL} align-top px-[10px] py-[6px] ${SUB} leading-relaxed`}
              colSpan={2}
              style={{ borderRight: `1px solid ${BORDER}` }}
            >
              {f.benchmarkRemark}
            </td>
            <td
              className={`${CELL} align-top px-[10px] py-[6px] ${SUB} leading-relaxed`}
              colSpan={5}
              style={{ borderLeft: `1px solid ${BORDER}` }}
            >
              {f.caseRemark}
            </td>
          </tr>
          <tr style={{ borderTop: `2px solid ${BORDER}` }}>
            <td
              className={`${CELL} align-middle ${CAT_BG} px-[8px] py-[4px] ${SUB}`}
              colSpan={2}
            >
              全案
            </td>
            <td
              className={`${CELL} align-top px-[10px] py-[6px] ${SUB} leading-relaxed`}
              colSpan={7}
            >
              {f.overallRemark}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-[14px] pt-[8px] border-t border-[#C7CBD1] flex flex-wrap items-center gap-x-8 gap-y-[6px] text-[13px]">
        <span>填寫日期：{f.fillDate}</span>
        <span>承辦員：＿＿＿＿＿＿</span>
        <span>課(股)長：＿＿＿＿＿＿</span>
        <span>主任（局、處長）：＿＿＿＿＿＿</span>
        <span className="ml-auto">不動產估價師：＿＿＿＿＿＿</span>
      </div>
    </div>
  );
}
