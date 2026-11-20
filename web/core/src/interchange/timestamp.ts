// Interchange timestamps (data-model.md 6.1): RFC 3339, UTC, literal Z, optional fraction of 1 to 9
// digits. Writers emit exactly three fraction digits. Stored instants have millisecond precision.

/** What reading a timestamp string gave. */
export type TimestampReading =
  | {
      readonly ok: true;
      /** Milliseconds since 1970-01-01T00:00:00Z, digits beyond the third fraction digit cut off. */
      readonly ms: number;
      /** The same instant as writers emit it: exactly three fraction digits. */
      readonly canonical: string;
      /** True when digits beyond the millisecond were not zero, so `canonical` is a little earlier. */
      readonly lossy: boolean;
    }
  | {
      readonly ok: false;
      /**
       * "pattern": not the schema's shape. "calendar": the shape is right, the instant does not
       * exist (R1).
       */
      readonly reason: "pattern" | "calendar";
    };

// The schema's pattern for definitions.timestamp. Only applied to strings of at most 30 characters.
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?Z$/u;
const LONGEST_TIMESTAMP = 30;

const MS_PER_DAY = 86_400_000;
/** 0000-01-01T00:00:00.000Z and 9999-12-31T23:59:59.999Z: the range the four-digit year can express. */
const MIN_MS = -62_167_219_200_000;
const MAX_MS = 253_402_300_799_999;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/** Days from 1970-01-01 to the given date of the proleptic Gregorian calendar. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const monthFromMarch = (month + 9) % 12;
  const dayOfYear = Math.floor((153 * monthFromMarch + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

/** True when the string has the shape the schema asks of a timestamp. Says nothing about R1. */
export function hasTimestampShape(text: string): boolean {
  return text.length <= LONGEST_TIMESTAMP && TIMESTAMP_PATTERN.test(text);
}

/**
 * Read a timestamp. The engine's own date parser is not used, because it accepts dates such as
 * 30 February.
 * Open points in data-model.md 6.1 and R1: hour 24 and second 60 are refused here (no stored
 * millisecond value can hold them), and digits beyond the millisecond are cut off, not rounded.
 */
export function parseTimestamp(text: string): TimestampReading {
  if (!hasTimestampShape(text)) return { ok: false, reason: "pattern" };
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(5, 7));
  const day = Number(text.slice(8, 10));
  const hour = Number(text.slice(11, 13));
  const minute = Number(text.slice(14, 16));
  const second = Number(text.slice(17, 19));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, reason: "calendar" };
  }
  if (hour > 23 || minute > 59 || second > 59) return { ok: false, reason: "calendar" };
  // Characters 20 up to the final Z are the fraction digits, when there is a fraction.
  const fraction = text.length > 20 ? text.slice(20, -1) : "";
  const millisecond = Number(fraction.slice(0, 3).padEnd(3, "0"));
  const lossy = /[1-9]/u.test(fraction.slice(3));
  const ms =
    daysFromCivil(year, month, day) * MS_PER_DAY +
    hour * 3_600_000 +
    minute * 60_000 +
    second * 1000 +
    millisecond;
  const canonical = `${text.slice(0, 19)}.${String(millisecond).padStart(3, "0")}Z`;
  return { ok: true, ms, canonical, lossy };
}

/** Write an instant as writers must: three fraction digits. Null when it is outside years 0000 to 9999. */
export function formatTimestamp(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return null;
  return new Date(ms).toISOString();
}

/** The interchange text of a stored date, or null when the date is invalid or out of range. */
export function dateToTimestamp(date: Date): string | null {
  return formatTimestamp(date.getTime());
}
