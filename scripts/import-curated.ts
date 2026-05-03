// Reads data/curated-cities.json + data/curated-translations.json,
// computes timezone metadata via Intl, and emits data/seed.sql.
//
// This is the offline counterpart to import-geonames.ts — same output
// format, same primary keys (real GeoNames IDs), so when GeoNames comes
// back online we can swap to that script and the seed will replace these
// rows cleanly via INSERT OR REPLACE.
//
// Run:    npm run data:import:curated
// Apply:  npm run db:seed:local

import { readFile, writeFile, mkdir } from 'node:fs/promises';

const CITIES_FILE = 'data/curated-cities.json';
const TRANSLATIONS_FILE = 'data/curated-translations.json';
const OUT_FILE = 'data/seed.sql';

// ---------------------------------------------------------------------------
// Country metadata (ISO-3166-1 α2 → English name + continent)
// Populated for every country code referenced in curated-cities.json.
// ---------------------------------------------------------------------------

const COUNTRIES: Record<string, { name: string; continent: string }> = {
  AE: { name: 'United Arab Emirates', continent: 'Asia' },
  AF: { name: 'Afghanistan', continent: 'Asia' },
  AL: { name: 'Albania', continent: 'Europe' },
  AM: { name: 'Armenia', continent: 'Asia' },
  AO: { name: 'Angola', continent: 'Africa' },
  AR: { name: 'Argentina', continent: 'South America' },
  AT: { name: 'Austria', continent: 'Europe' },
  AU: { name: 'Australia', continent: 'Oceania' },
  AZ: { name: 'Azerbaijan', continent: 'Asia' },
  BA: { name: 'Bosnia and Herzegovina', continent: 'Europe' },
  BD: { name: 'Bangladesh', continent: 'Asia' },
  BE: { name: 'Belgium', continent: 'Europe' },
  BG: { name: 'Bulgaria', continent: 'Europe' },
  BH: { name: 'Bahrain', continent: 'Asia' },
  BO: { name: 'Bolivia', continent: 'South America' },
  BR: { name: 'Brazil', continent: 'South America' },
  BY: { name: 'Belarus', continent: 'Europe' },
  CA: { name: 'Canada', continent: 'North America' },
  CD: { name: 'DR Congo', continent: 'Africa' },
  CH: { name: 'Switzerland', continent: 'Europe' },
  CL: { name: 'Chile', continent: 'South America' },
  CN: { name: 'China', continent: 'Asia' },
  CO: { name: 'Colombia', continent: 'South America' },
  CR: { name: 'Costa Rica', continent: 'North America' },
  CU: { name: 'Cuba', continent: 'North America' },
  CZ: { name: 'Czechia', continent: 'Europe' },
  DE: { name: 'Germany', continent: 'Europe' },
  DK: { name: 'Denmark', continent: 'Europe' },
  DO: { name: 'Dominican Republic', continent: 'North America' },
  DZ: { name: 'Algeria', continent: 'Africa' },
  EC: { name: 'Ecuador', continent: 'South America' },
  EE: { name: 'Estonia', continent: 'Europe' },
  EG: { name: 'Egypt', continent: 'Africa' },
  ES: { name: 'Spain', continent: 'Europe' },
  ET: { name: 'Ethiopia', continent: 'Africa' },
  FI: { name: 'Finland', continent: 'Europe' },
  FJ: { name: 'Fiji', continent: 'Oceania' },
  FR: { name: 'France', continent: 'Europe' },
  GB: { name: 'United Kingdom', continent: 'Europe' },
  GE: { name: 'Georgia', continent: 'Asia' },
  GH: { name: 'Ghana', continent: 'Africa' },
  GR: { name: 'Greece', continent: 'Europe' },
  HK: { name: 'Hong Kong', continent: 'Asia' },
  HR: { name: 'Croatia', continent: 'Europe' },
  HU: { name: 'Hungary', continent: 'Europe' },
  ID: { name: 'Indonesia', continent: 'Asia' },
  IE: { name: 'Ireland', continent: 'Europe' },
  IL: { name: 'Israel', continent: 'Asia' },
  IN: { name: 'India', continent: 'Asia' },
  IQ: { name: 'Iraq', continent: 'Asia' },
  IR: { name: 'Iran', continent: 'Asia' },
  IS: { name: 'Iceland', continent: 'Europe' },
  IT: { name: 'Italy', continent: 'Europe' },
  JO: { name: 'Jordan', continent: 'Asia' },
  JP: { name: 'Japan', continent: 'Asia' },
  KE: { name: 'Kenya', continent: 'Africa' },
  KH: { name: 'Cambodia', continent: 'Asia' },
  KP: { name: 'North Korea', continent: 'Asia' },
  KR: { name: 'South Korea', continent: 'Asia' },
  KW: { name: 'Kuwait', continent: 'Asia' },
  KZ: { name: 'Kazakhstan', continent: 'Asia' },
  LA: { name: 'Laos', continent: 'Asia' },
  LB: { name: 'Lebanon', continent: 'Asia' },
  LK: { name: 'Sri Lanka', continent: 'Asia' },
  LT: { name: 'Lithuania', continent: 'Europe' },
  LU: { name: 'Luxembourg', continent: 'Europe' },
  LV: { name: 'Latvia', continent: 'Europe' },
  LY: { name: 'Libya', continent: 'Africa' },
  MA: { name: 'Morocco', continent: 'Africa' },
  MD: { name: 'Moldova', continent: 'Europe' },
  MG: { name: 'Madagascar', continent: 'Africa' },
  MK: { name: 'North Macedonia', continent: 'Europe' },
  MM: { name: 'Myanmar', continent: 'Asia' },
  MN: { name: 'Mongolia', continent: 'Asia' },
  MO: { name: 'Macau', continent: 'Asia' },
  MX: { name: 'Mexico', continent: 'North America' },
  MY: { name: 'Malaysia', continent: 'Asia' },
  MZ: { name: 'Mozambique', continent: 'Africa' },
  NG: { name: 'Nigeria', continent: 'Africa' },
  NL: { name: 'Netherlands', continent: 'Europe' },
  NO: { name: 'Norway', continent: 'Europe' },
  NP: { name: 'Nepal', continent: 'Asia' },
  NZ: { name: 'New Zealand', continent: 'Oceania' },
  OM: { name: 'Oman', continent: 'Asia' },
  PA: { name: 'Panama', continent: 'North America' },
  PE: { name: 'Peru', continent: 'South America' },
  PG: { name: 'Papua New Guinea', continent: 'Oceania' },
  PH: { name: 'Philippines', continent: 'Asia' },
  PK: { name: 'Pakistan', continent: 'Asia' },
  PL: { name: 'Poland', continent: 'Europe' },
  PR: { name: 'Puerto Rico', continent: 'North America' },
  PT: { name: 'Portugal', continent: 'Europe' },
  PY: { name: 'Paraguay', continent: 'South America' },
  QA: { name: 'Qatar', continent: 'Asia' },
  RO: { name: 'Romania', continent: 'Europe' },
  RS: { name: 'Serbia', continent: 'Europe' },
  RU: { name: 'Russia', continent: 'Europe' },
  RW: { name: 'Rwanda', continent: 'Africa' },
  SA: { name: 'Saudi Arabia', continent: 'Asia' },
  SD: { name: 'Sudan', continent: 'Africa' },
  SE: { name: 'Sweden', continent: 'Europe' },
  SG: { name: 'Singapore', continent: 'Asia' },
  SI: { name: 'Slovenia', continent: 'Europe' },
  SK: { name: 'Slovakia', continent: 'Europe' },
  SN: { name: 'Senegal', continent: 'Africa' },
  SY: { name: 'Syria', continent: 'Asia' },
  TH: { name: 'Thailand', continent: 'Asia' },
  TN: { name: 'Tunisia', continent: 'Africa' },
  TR: { name: 'Türkiye', continent: 'Asia' },
  TW: { name: 'Taiwan', continent: 'Asia' },
  TZ: { name: 'Tanzania', continent: 'Africa' },
  UA: { name: 'Ukraine', continent: 'Europe' },
  UG: { name: 'Uganda', continent: 'Africa' },
  US: { name: 'United States', continent: 'North America' },
  UY: { name: 'Uruguay', continent: 'South America' },
  UZ: { name: 'Uzbekistan', continent: 'Asia' },
  VE: { name: 'Venezuela', continent: 'South America' },
  VN: { name: 'Vietnam', continent: 'Asia' },
  ZA: { name: 'South Africa', continent: 'Africa' },
  ZM: { name: 'Zambia', continent: 'Africa' },
  ZW: { name: 'Zimbabwe', continent: 'Africa' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CuratedCity {
  id: number;
  name: string;
  ascii?: string;
  cc: string;
  a1?: string;
  pop: number;
  lat: number;
  lon: number;
  tz: string;
  cap: boolean;
}

interface CitiesFile {
  version: string;
  source: string;
  cities: CuratedCity[];
}

type LangMap = Partial<Record<'es' | 'pt' | 'de' | 'nl' | 'zh-CN', string>>;
interface TranslationsFile {
  version: string;
  source: string;
  translations: Record<string, LangMap>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function offsetMin(tz: string, date: Date): number {
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const local = new Date(date.toLocaleString('en-US', { timeZone: tz }));
  return Math.round((local.getTime() - utc.getTime()) / 60000);
}

function abbrFor(tz: string, date: Date): string {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    });
    const part = fmt.formatToParts(date).find((p) => p.type === 'timeZoneName');
    return part?.value ?? '';
  } catch {
    return '';
  }
}

interface TzMeta {
  stdOffsetMin: number;
  observesDst: boolean;
  abbrStandard: string;
  abbrDst: string | null;
}

function timezoneMeta(tz: string): TzMeta {
  const winter = new Date('2025-01-15T12:00:00Z');
  const summer = new Date('2025-07-15T12:00:00Z');
  const winOff = offsetMin(tz, winter);
  const sumOff = offsetMin(tz, summer);
  const observesDst = winOff !== sumOff;
  return {
    stdOffsetMin: winOff,
    observesDst,
    abbrStandard: abbrFor(tz, winter),
    abbrDst: observesDst ? abbrFor(tz, summer) : null,
  };
}

function q(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('▸ Reading curated dataset…');
  const citiesData: CitiesFile = JSON.parse(await readFile(CITIES_FILE, 'utf8'));
  const translationsData: TranslationsFile = JSON.parse(
    await readFile(TRANSLATIONS_FILE, 'utf8'),
  );

  const cities = citiesData.cities;
  console.log(`  ${cities.length} cities`);
  console.log(`  ${Object.keys(translationsData.translations).length} cities with translations`);

  // Validate slugs (no duplicates)
  const slugs = new Map<string, CuratedCity>();
  for (const c of cities) {
    const s = slugify(c.ascii ?? c.name);
    const clash = slugs.get(s);
    if (clash) {
      throw new Error(
        `Slug collision: "${s}" — ${c.name} (${c.cc}) vs ${clash.name} (${clash.cc}). ` +
          `Add disambiguation in curated-cities.json.`,
      );
    }
    slugs.set(s, c);
  }

  // Validate country codes
  for (const c of cities) {
    if (!COUNTRIES[c.cc]) {
      throw new Error(`Unknown country code "${c.cc}" for ${c.name}. Add to COUNTRIES in import-curated.ts.`);
    }
  }

  // Sort by score (population + 1M capital bonus) descending — defines prerender priority
  const ranked = [...cities].sort((a, b) => {
    const sa = a.pop + (a.cap ? 1_000_000 : 0);
    const sb = b.pop + (b.cap ? 1_000_000 : 0);
    return sb - sa;
  });

  const usedCountries = new Set(cities.map((c) => c.cc));
  const usedTimezones = new Set(cities.map((c) => c.tz));

  // -------------------------------------------------------------------------
  // Emit SQL
  // -------------------------------------------------------------------------
  const lines: string[] = [];
  lines.push('-- Auto-generated by scripts/import-curated.ts. Do not edit by hand.');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Source: ${citiesData.source}`);
  lines.push('');
  // Note: D1 disallows explicit BEGIN/COMMIT — Wrangler runs each statement
  // through D1's HTTP API which uses an internal transaction per request.
  lines.push('PRAGMA defer_foreign_keys = TRUE;');
  lines.push('');

  // Wipe city + translations tables to keep things idempotent across re-runs
  // (handles cities removed from the curated set between runs).
  lines.push('-- Reset tables that this seed fully owns -----------------------------');
  lines.push('DELETE FROM city_translations;');
  lines.push('DELETE FROM cities;');
  lines.push('');

  lines.push('-- Countries -----------------------------------------------------------');
  for (const code of [...usedCountries].sort()) {
    const c = COUNTRIES[code]!;
    lines.push(
      `INSERT OR REPLACE INTO countries (code, name_en, continent) VALUES (${q(code)}, ${q(c.name)}, ${q(c.continent)});`,
    );
  }
  lines.push('');

  lines.push('-- Timezones -----------------------------------------------------------');
  for (const tz of [...usedTimezones].sort()) {
    const m = timezoneMeta(tz);
    lines.push(
      `INSERT OR REPLACE INTO timezones (id, abbr_standard, abbr_dst, utc_offset_std_min, observes_dst) VALUES (${q(tz)}, ${q(m.abbrStandard)}, ${q(m.abbrDst)}, ${m.stdOffsetMin}, ${m.observesDst ? 1 : 0});`,
    );
  }
  lines.push('');

  lines.push('-- Cities --------------------------------------------------------------');
  // priority counts down so highest-ranked city has the largest priority value
  let priority = ranked.length;
  for (const c of ranked) {
    const ascii = c.ascii ?? c.name;
    const slug = slugify(ascii);
    lines.push(
      `INSERT INTO cities (id, slug, name_en, ascii_name, country_code, admin1_code, population, latitude, longitude, timezone_id, is_disambiguated, prerender_priority) VALUES (${c.id}, ${q(slug)}, ${q(c.name)}, ${q(ascii)}, ${q(c.cc)}, ${q(c.a1 ?? null)}, ${c.pop}, ${c.lat}, ${c.lon}, ${q(c.tz)}, 0, ${priority--});`,
    );
  }
  lines.push('');

  lines.push('-- City translations --------------------------------------------------');
  let translationRows = 0;
  for (const c of cities) {
    const trans = translationsData.translations[String(c.id)];
    if (!trans) continue;
    for (const [lang, name] of Object.entries(trans)) {
      if (!name) continue;
      lines.push(
        `INSERT INTO city_translations (city_id, lang, name) VALUES (${c.id}, ${q(lang)}, ${q(name)});`,
      );
      translationRows += 1;
    }
  }
  lines.push('');

  lines.push('');

  await mkdir('data', { recursive: true });
  await writeFile(OUT_FILE, lines.join('\n'), 'utf8');

  console.log('');
  console.log(`✓ Wrote ${OUT_FILE} (${(lines.join('\n').length / 1024).toFixed(1)} KB)`);
  console.log(`  cities:       ${cities.length}`);
  console.log(`  countries:    ${usedCountries.size}`);
  console.log(`  timezones:    ${usedTimezones.size}`);
  console.log(`  translations: ${translationRows}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
