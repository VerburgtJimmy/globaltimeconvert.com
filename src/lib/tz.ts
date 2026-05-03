// Timezone math built on Intl.DateTimeFormat — zero deps, runs equally in
// Node, the browser, and Cloudflare Workers.

export interface FormattedTime {
  /** Hour in 24h form, 0-23. */
  hour: number;
  minute: number;
  second: number;
  /** ISO date in the target zone, e.g. "2026-05-03". */
  date: string;
  /** Localized weekday name, e.g. "Tuesday". */
  weekday: string;
  /** Time-zone abbreviation as Intl returns it, e.g. "EST", "JST", or "GMT+9". */
  abbr: string;
  /** Offset from UTC in minutes (positive = east of UTC). */
  offsetMin: number;
}

/** Compute the offset from UTC at `date` for the given IANA zone, in minutes. */
export function getOffsetMin(date: Date, tz: string): number {
  // toLocaleString yields a string parseable by Date back into a "wall clock"
  // value reinterpreted as local — the diff is the zone offset.
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

/** Difference (in minutes) between two zones at a given moment: to - from. */
export function diffMin(from: string, to: string, at: Date = new Date()): number {
  return getOffsetMin(at, to) - getOffsetMin(at, from);
}

/** Format an offset in minutes as "UTC+9" or "UTC-3:30". */
export function formatOffset(min: number): string {
  const sign = min >= 0 ? '+' : '-';
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return m === 0 ? `UTC${sign}${h}` : `UTC${sign}${h}:${String(m).padStart(2, '0')}`;
}

/** Render all UI fields for a moment in a target zone. */
export function formatInZone(
  date: Date,
  tz: string,
  locale: string = 'en-US',
): FormattedTime {
  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'long',
    timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    hour: Number.parseInt(get('hour'), 10),
    minute: Number.parseInt(get('minute'), 10),
    second: Number.parseInt(get('second'), 10),
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: get('weekday'),
    abbr: get('timeZoneName'),
    offsetMin: getOffsetMin(date, tz),
  };
}

/** "07:42" style 24-hour clock. */
export function formatHm(t: { hour: number; minute: number }): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

/** "07:42:13" style 24-hour clock with seconds. */
export function formatHms(t: FormattedTime): string {
  return `${formatHm(t)}:${String(t.second).padStart(2, '0')}`;
}

export interface DiffDescription {
  diffMin: number;
  /** True if `to` is ahead of `from`. */
  ahead: boolean;
  /** True if `to` is behind `from`. */
  behind: boolean;
  /** True if both zones have the same wall-clock offset right now. */
  same: boolean;
  hours: number;
  minutes: number;
  /** "13 hours behind" / "5h 30m ahead" / "in the same timezone". */
  phrase: string;
}

/** Describe a wall-clock difference for UI / templates. */
export function describeDiff(diffMinutes: number): DiffDescription {
  if (diffMinutes === 0) {
    return {
      diffMin: 0,
      ahead: false,
      behind: false,
      same: true,
      hours: 0,
      minutes: 0,
      phrase: 'in the same timezone',
    };
  }
  const ahead = diffMinutes > 0;
  const abs = Math.abs(diffMinutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const part =
    m === 0 ? `${h} hour${h === 1 ? '' : 's'}` : `${h}h ${m}m`;
  return {
    diffMin: diffMinutes,
    ahead,
    behind: !ahead,
    same: false,
    hours: h,
    minutes: m,
    phrase: `${part} ${ahead ? 'ahead' : 'behind'}`,
  };
}

/** Whether the given zone uses DST (compares Jan vs Jul offsets). */
export function observesDst(tz: string): boolean {
  const winter = new Date('2025-01-15T12:00:00Z');
  const summer = new Date('2025-07-15T12:00:00Z');
  return getOffsetMin(winter, tz) !== getOffsetMin(summer, tz);
}

/**
 * Build the UTC moment that has wall-clock `time` in `inTz` on today's date
 * (today's date evaluated in `inTz`, so DST and date rollovers Just Work).
 */
export function momentForWallTime(
  time: { hour: number; minute: number },
  inTz: string,
  reference: Date = new Date(),
): Date {
  const todayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: inTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [Y, M, D] = todayFmt.format(reference).split('-').map((s) => Number.parseInt(s, 10));
  const utcGuess = Date.UTC(Y!, (M ?? 1) - 1, D ?? 1, time.hour, time.minute, 0);
  // Naive UTC moment minus the zone's offset = real UTC moment.
  const offset = getOffsetMin(new Date(utcGuess), inTz);
  return new Date(utcGuess - offset * 60_000);
}
