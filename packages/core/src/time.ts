export interface LocalParts {
  /** "YYYY-MM-DD" in the given zone. */
  date: string;
  /** Minutes since local midnight. */
  minutes: number;
  /** "HH:MM" in the given zone. */
  hhmm: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(now: Date, timeZone: string): LocalParts {
  const parts = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hhmm = `${parts.hour}:${parts.minute}`;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: parseHHMM(hhmm),
    hhmm,
  };
}

/** Parses "HH:MM" (24h) into minutes since midnight. Throws on malformed input. */
export function parseHHMM(value: string): number {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) throw new Error(`Invalid time "${value}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function isHHMM(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

export function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Adds whole days to a "YYYY-MM-DD" date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Returns the dates from (today - count + 1) to today, oldest first. */
export function lastNDates(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(today, i - count + 1));
}

/** Weekday name for a "YYYY-MM-DD" date, e.g. "Sunday". */
export function weekdayName(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
}
