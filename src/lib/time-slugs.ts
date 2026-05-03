// Time-prefix slug parser (Phase 6 — specific-time pages).
//
// Two canonical slug formats, locale-bound:
//   12h (en):    9am, 9-30am, 12pm, 12-30pm, 12am   ← english root
//   24h (else):  09-00, 09-30, 14-30, 00-30          ← /es/, /pt/, /de/, /nl/, /zh-CN/
//
// We accept BOTH formats on every locale and 302-redirect to the locale's
// canonical form, so /9am-tokyo and /09-00-tokyo both work but only the
// canonical one is indexed.

import type { Locale } from './i18n';

export interface TimeOfDay {
  hour: number; // 0-23
  minute: number; // 0 or 30 (we snap to 30-min granularity, matching the slider)
}

export type TimeFormat = '12h' | '24h';

export interface ParsedTimePrefix {
  time: TimeOfDay;
  /** Format that was matched in the input. */
  format: TimeFormat;
  /** Slug remaining after the time prefix and its trailing hyphen. */
  rest: string;
}

// 12-hour: optional `-MM` minutes between hour and `am`/`pm`.
//   1am, 12am, 9am, 9-30am, 12-30pm
const RE_12H = /^(?<h>1[0-2]|[1-9])(?:-(?<m>00|30))?(?<ampm>am|pm)/;

// 24-hour: HH-MM is required; both halves zero-padded.
//   00-00, 09-30, 14-30, 23-30
const RE_24H = /^(?<h>[01][0-9]|2[0-3])-(?<m>00|30)/;

/**
 * Try to peel a time prefix off the start of `slug`. Returns null when no
 * known time format is detected — the caller can then treat the whole slug
 * as a city or city-pair.
 */
export function parseTimePrefix(slug: string): ParsedTimePrefix | null {
  // Try 12h first (more specific — must end with am/pm).
  const m12 = slug.match(RE_12H);
  if (m12 && m12.groups) {
    const h12 = Number.parseInt(m12.groups.h!, 10);
    const minute = Number.parseInt(m12.groups.m ?? '0', 10);
    const ampm = m12.groups.ampm!;
    let hour = h12;
    if (ampm === 'pm' && h12 !== 12) hour += 12;
    if (ampm === 'am' && h12 === 12) hour = 0;
    const after = slug.slice(m12[0].length);
    if (!after.startsWith('-')) return null;
    const rest = after.slice(1);
    if (!rest) return null;
    return { time: { hour, minute }, format: '12h', rest };
  }

  // Try 24h.
  const m24 = slug.match(RE_24H);
  if (m24 && m24.groups) {
    const hour = Number.parseInt(m24.groups.h!, 10);
    const minute = Number.parseInt(m24.groups.m!, 10);
    const after = slug.slice(m24[0].length);
    if (!after.startsWith('-')) return null;
    const rest = after.slice(1);
    if (!rest) return null;
    return { time: { hour, minute }, format: '24h', rest };
  }

  return null;
}

/** The canonical slug format for a given locale. */
export function canonicalFormat(lang: Locale): TimeFormat {
  return lang === 'en' ? '12h' : '24h';
}

/** Build the canonical time prefix string for a locale. */
export function formatTimePrefix(time: TimeOfDay, lang: Locale): string {
  if (canonicalFormat(lang) === '12h') return format12h(time);
  return format24h(time);
}

/** "9am" / "9-30am" / "12pm" / "12am" — never zero-pads the hour. */
export function format12h(t: TimeOfDay): string {
  const h12 = t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour;
  const ampm = t.hour < 12 ? 'am' : 'pm';
  if (t.minute === 0) return `${h12}${ampm}`;
  return `${h12}-${String(t.minute).padStart(2, '0')}${ampm}`;
}

/** "09-00" / "09-30" / "14-30" / "00-30" — always HH-MM. */
export function format24h(t: TimeOfDay): string {
  return `${String(t.hour).padStart(2, '0')}-${String(t.minute).padStart(2, '0')}`;
}

/** Display string for the time, formatted by locale convention. */
export function displayTime(t: TimeOfDay, lang: Locale): string {
  if (lang === 'en') {
    const h12 = t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour;
    const ampm = t.hour < 12 ? 'AM' : 'PM';
    if (t.minute === 0) return `${h12} ${ampm}`;
    return `${h12}:${String(t.minute).padStart(2, '0')} ${ampm}`;
  }
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

/** The 9 anchor times we prerender per city. */
export const ANCHOR_TIMES: TimeOfDay[] = [
  { hour: 8, minute: 0 },
  { hour: 9, minute: 0 },
  { hour: 10, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 15, minute: 0 },
  { hour: 17, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 21, minute: 0 },
];

/** Validates a TimeOfDay is in our supported 30-min granularity. */
export function isValidTimeOfDay(t: TimeOfDay): boolean {
  if (!Number.isInteger(t.hour) || !Number.isInteger(t.minute)) return false;
  if (t.hour < 0 || t.hour > 23) return false;
  if (t.minute !== 0 && t.minute !== 30) return false;
  return true;
}
