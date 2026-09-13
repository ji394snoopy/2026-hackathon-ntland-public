// Open-Meteo's Archive API (ERA5 reanalysis) can lag a few days behind real time and
// revise its most recent days as later passes ingest more data, so the window ends a
// buffer before "today" rather than on it.
const ARCHIVE_LAG_BUFFER_DAYS = 7;
const WINDOW_DAYS = 365;

interface DateRange {
  startDate: string;
  endDate: string;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pastYearRange(today: Date): DateRange {
  const end = new Date(today);
  end.setUTCDate(end.getUTCDate() - ARCHIVE_LAG_BUFFER_DAYS);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS - 1));
  return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
}

export { pastYearRange, toIsoDate };
export type { DateRange };
