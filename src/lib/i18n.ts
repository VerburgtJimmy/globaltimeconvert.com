// Locale loader + helpers (DESIGN §0 multi-locale; PLAN §5 i18n).
//
// Adding a 7th language is purely additive:
//   1. Drop the JSON next to en.json (e.g. fr.json).
//   2. Import + add to LOCALES below.
//   3. Add the locale code to Astro's i18n.locales in astro.config.mjs.
// No other code touches.

import en from '../content/i18n/en.json';
import es from '../content/i18n/es.json';
import pt from '../content/i18n/pt.json';
import de from '../content/i18n/de.json';
import nl from '../content/i18n/nl.json';
import zhCN from '../content/i18n/zh-CN.json';

export const LOCALES = {
  en,
  es,
  pt,
  de,
  nl,
  'zh-CN': zhCN,
} as const;

export type Locale = keyof typeof LOCALES;
export const DEFAULT_LOCALE: Locale = 'en';
export const SUPPORTED_LOCALES = Object.keys(LOCALES) as Locale[];

export function isValidLocale(s: string | undefined): s is Locale {
  return !!s && (SUPPORTED_LOCALES as readonly string[]).includes(s);
}

type Dict = typeof en;
type Vars = Record<string, string | number>;

/** Look up a dotted key in the locale dict, with `{var}` interpolation. */
export function t(key: string, lang: Locale = DEFAULT_LOCALE, vars: Vars = {}): string {
  const dict = (LOCALES[lang] ?? LOCALES[DEFAULT_LOCALE]) as Dict;
  const raw = dottedGet(dict, key);
  // Fall back to English if the locale dict is missing this key.
  const fallbackRaw =
    typeof raw === 'string' ? raw : dottedGet(LOCALES.en as Dict, key);
  const str = typeof fallbackRaw === 'string' ? fallbackRaw : key;
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.split(`{${k}}`).join(String(v)),
    str,
  );
}

function dottedGet(obj: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (acc, k) =>
      acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined,
    obj,
  );
}

/** Build a locale-prefixed path. English (default) returns the path unchanged. */
export function pathFor(path: string, lang: Locale): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (lang === DEFAULT_LOCALE) return p;
  return `/${lang}${p}`;
}

/** Strip the locale prefix from a URL path. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const m = pathname.match(/^\/([a-z]{2}(?:-[A-Z]{2})?)(?=\/|$)(\/.*)?$/);
  if (m && isValidLocale(m[1])) {
    return { locale: m[1] as Locale, path: m[2] ?? '/' };
  }
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

/**
 * Render a localized "13 hours ahead of" / "in the same timezone as" phrase
 * from a structured diff result.
 */
export function diffPhrase(
  diff: { same: boolean; ahead: boolean; hours: number },
  lang: Locale,
): string {
  if (diff.same) return t('templates.page.cityPair.diffSame', lang);
  const key = diff.ahead
    ? 'templates.page.cityPair.diffAhead'
    : 'templates.page.cityPair.diffBehind';
  return t(key, lang, { n: diff.hours });
}
