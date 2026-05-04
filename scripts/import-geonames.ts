// One-shot import: downloads GeoNames dumps, generates `data/seed.sql`.
// Run:    npm run data:import           (defaults: TOP_N=1000)
//         TOP_N=2000 npm run data:import (override for Phase 2 expansion)
// Apply:  npm run db:seed:local

import { execFileSync } from 'node:child_process';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RAW_DIR = 'data/raw';
const OUT_FILE = 'data/seed.sql';
const TOP_N = Number.parseInt(process.env.TOP_N ?? '1000', 10);
const CAPITAL_BONUS = 1_000_000;
const POP_FLOOR = 15_000; // matches cities15000.zip cutoff
const CURATED_TRANSLATIONS_FILE = 'data/curated-translations.json';
// Countries where admin1 (state/province code) is meaningful for slug
// disambiguation — i.e., people actually search by it. Outside this set we
// just append the country code, since admin1 codes are mostly opaque digits.
const ADMIN1_DISAMBIG_COUNTRIES = new Set(['US', 'CA', 'AU', 'BR', 'IN', 'MX', 'RU']);

// Map GeoNames language codes (often loose) to our 5 non-English locales.
// English names live on `cities.name_en` directly, so 'en' is not here.
const LANG_ACCEPT: Record<string, string[]> = {
  es: ['es'],
  pt: ['pt', 'pt-br', 'pt-pt'],
  de: ['de'],
  nl: ['nl'],
  'zh-CN': ['zh-cn', 'zh-hans', 'zh', 'cmn'],
};
const LANG_LOOKUP = new Map<string, string>();
for (const [target, accepts] of Object.entries(LANG_ACCEPT)) {
  for (const a of accepts) LANG_LOOKUP.set(a.toLowerCase(), target);
}

const SOURCES = {
  cities: {
    // cities15000.txt = ~25k cities ≥ 15k pop — small download, plenty of
    // headroom for top-1000 ranking. Bump to cities5000 / cities500 for
    // Phase 2+ when scaling past 5k cities.
    url: 'https://download.geonames.org/export/dump/cities15000.zip',
    zip: 'cities15000.zip',
    txt: 'cities15000.txt',
  },
  altNames: {
    url: 'https://download.geonames.org/export/dump/alternateNamesV2.zip',
    zip: 'alternateNamesV2.zip',
    txt: 'alternateNamesV2.txt',
  },
  countries: {
    url: 'https://download.geonames.org/export/dump/countryInfo.txt',
    zip: null,
    txt: 'countryInfo.txt',
  },
} as const;

const CONTINENTS: Record<string, string> = {
  AF: 'Africa',
  AN: 'Antarctica',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  OC: 'Oceania',
  SA: 'South America',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CityRow {
  id: number;
  name: string;
  ascii: string;
  countryCode: string;
  admin1: string;
  population: number;
  lat: number;
  lon: number;
  timezone: string;
  featureCode: string;
}

interface RankedCity extends CityRow {
  slug: string;
  score: number;
}

interface CountryInfo {
  name: string;
  continent: string;
}

// ---------------------------------------------------------------------------
// Download + extract
// ---------------------------------------------------------------------------

async function ensureDownload(name: keyof typeof SOURCES): Promise<string> {
  const src = SOURCES[name];
  const txtPath = join(RAW_DIR, src.txt);
  if (existsSync(txtPath)) return txtPath;

  const dest = src.zip ? join(RAW_DIR, src.zip) : txtPath;
  console.log(`  ⤓ ${src.url}`);
  const res = await fetch(src.url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${src.url}`);
  }
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));

  if (src.zip) {
    console.log(`    extracting ${src.zip}`);
    // execFileSync — no shell, args passed as array directly to binary
    execFileSync('unzip', ['-o', '-q', src.zip], { cwd: RAW_DIR });
  }
  return txtPath;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

async function parseCities(path: string): Promise<CityRow[]> {
  const rows: CityRow[] = [];
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const f = line.split('\t');
    if (f.length < 19) continue;
    const population = Number.parseInt(f[14] ?? '0', 10);
    if (!Number.isFinite(population) || population < POP_FLOOR) continue;
    rows.push({
      id: Number.parseInt(f[0]!, 10),
      name: f[1]!,
      ascii: f[2]!,
      countryCode: f[8]!,
      admin1: f[10] ?? '',
      population,
      lat: Number.parseFloat(f[4]!),
      lon: Number.parseFloat(f[5]!),
      timezone: f[17]!,
      featureCode: f[7] ?? '',
    });
  }
  return rows;
}

async function parseTranslations(
  path: string,
  cityIds: Set<number>,
): Promise<Map<number, Map<string, string>>> {
  // Format: alternateNameId, geonameid, isolanguage, alternate name,
  //         isPreferredName, isShortName, isColloquial, isHistoric, from, to
  type Candidate = { name: string; rank: number };
  const tmp = new Map<number, Map<string, Candidate>>();

  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const f = line.split('\t');
    if (f.length < 8) continue;
    const geoId = Number.parseInt(f[1] ?? '0', 10);
    if (!cityIds.has(geoId)) continue;
    const lang = LANG_LOOKUP.get((f[2] ?? '').toLowerCase());
    if (!lang) continue;
    if (f[7] === '1') continue; // historic
    const name = f[3] ?? '';
    if (!name) continue;
    const isPreferred = f[4] === '1';
    const isShort = f[5] === '1';
    const rank = isPreferred ? 0 : isShort ? 1 : 2;

    let cityMap = tmp.get(geoId);
    if (!cityMap) {
      cityMap = new Map();
      tmp.set(geoId, cityMap);
    }
    const existing = cityMap.get(lang);
    if (!existing || rank < existing.rank) {
      cityMap.set(lang, { name, rank });
    }
  }

  const result = new Map<number, Map<string, string>>();
  for (const [id, m] of tmp) {
    const flat = new Map<string, string>();
    for (const [lang, cand] of m) flat.set(lang, cand.name);
    result.set(id, flat);
  }
  return result;
}

async function parseCountries(path: string): Promise<Map<string, CountryInfo>> {
  const result = new Map<string, CountryInfo>();
  const rl = createInterface({
    input: createReadStream(path),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (line.startsWith('#') || !line.trim()) continue;
    const f = line.split('\t');
    const code = f[0];
    const name = f[4];
    const continent = f[8];
    if (!code || !name) continue;
    result.set(code, { name, continent: continent ?? '' });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ranking + slugs
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface DisambiguatedCity extends RankedCity {
  isDisambiguated: boolean;
}

function rank(rows: CityRow[]): DisambiguatedCity[] {
  const scored: DisambiguatedCity[] = rows.map((r) => ({
    ...r,
    slug: '',
    score: r.population + (r.featureCode === 'PPLC' ? CAPITAL_BONUS : 0),
    isDisambiguated: false,
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);

  // Slug allocation: highest-scored city for a given base slug wins the
  // bare form ("paris"); subsequent cities get a country-/admin-suffixed
  // variant ("paris-tx-us"). If even that collides, append the GeoNames
  // ID — guaranteed unique.
  const seen = new Map<string, DisambiguatedCity>();
  for (const c of top) {
    const base = slugify(c.ascii);
    if (!base) throw new Error(`Empty slug for ${c.name} (id ${c.id})`);

    if (!seen.has(base)) {
      c.slug = base;
      seen.set(base, c);
      continue;
    }

    // Collision — try the disambiguated form.
    const cc = c.countryCode.toLowerCase();
    const a1 = c.admin1 ? slugify(c.admin1) : '';
    const candidates: string[] = [];
    if (ADMIN1_DISAMBIG_COUNTRIES.has(c.countryCode) && a1) {
      candidates.push(`${base}-${a1}-${cc}`);
    }
    candidates.push(`${base}-${cc}`);
    candidates.push(`${base}-${c.id}`); // last-resort uniqueness

    let assigned = '';
    for (const candidate of candidates) {
      if (!seen.has(candidate)) {
        assigned = candidate;
        break;
      }
    }
    if (!assigned) {
      throw new Error(
        `Could not disambiguate slug for ${c.name} (id ${c.id}, ${c.countryCode})`,
      );
    }
    c.slug = assigned;
    c.isDisambiguated = true;
    seen.set(assigned, c);
  }
  return top;
}

interface CuratedTranslationsFile {
  translations: Record<string, Partial<Record<'es' | 'pt' | 'de' | 'nl' | 'zh-CN', string>>>;
}

/**
 * Layer hand-curated translations on top of GeoNames altNames. Curated wins
 * for every city/lang pair where the user has provided a value — GeoNames'
 * crowd-sourced altNames have wide variance in quality.
 */
async function loadCuratedTranslations(): Promise<Map<number, Map<string, string>>> {
  if (!existsSync(CURATED_TRANSLATIONS_FILE)) return new Map();
  const data: CuratedTranslationsFile = JSON.parse(
    await readFile(CURATED_TRANSLATIONS_FILE, 'utf8'),
  );
  const result = new Map<number, Map<string, string>>();
  for (const [idStr, langMap] of Object.entries(data.translations)) {
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id)) continue;
    const m = new Map<string, string>();
    for (const [lang, name] of Object.entries(langMap)) {
      if (name) m.set(lang, name);
    }
    if (m.size > 0) result.set(id, m);
  }
  return result;
}

function mergeTranslations(
  geonames: Map<number, Map<string, string>>,
  curated: Map<number, Map<string, string>>,
): Map<number, Map<string, string>> {
  const merged = new Map<number, Map<string, string>>();
  // Start from GeoNames as the base
  for (const [id, m] of geonames) merged.set(id, new Map(m));
  // Overlay curated (curated wins)
  for (const [id, m] of curated) {
    let target = merged.get(id);
    if (!target) {
      target = new Map();
      merged.set(id, target);
    }
    for (const [lang, name] of m) target.set(lang, name);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Timezone metadata via Intl
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SQL emit
// ---------------------------------------------------------------------------

function q(s: string | null | undefined): string {
  if (s === null || s === undefined) return 'NULL';
  return `'${s.replace(/'/g, "''")}'`;
}

function emitSeed(
  cities: DisambiguatedCity[],
  translations: Map<number, Map<string, string>>,
  countries: Map<string, CountryInfo>,
): string {
  const usedCountries = new Set(cities.map((c) => c.countryCode));
  const usedTimezones = new Set(cities.map((c) => c.timezone));

  const lines: string[] = [];
  lines.push('-- Auto-generated by scripts/import-geonames.ts. Do not edit by hand.');
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('');
  // Note: D1 disallows explicit BEGIN/COMMIT — Wrangler runs each statement
  // through D1's HTTP API which uses an internal transaction per request.
  lines.push('PRAGMA defer_foreign_keys = TRUE;');
  lines.push('');

  // Wipe city + translations tables to keep things idempotent across re-runs
  // (handles cities removed between phases, e.g. when Phase 2 reshuffles
  // priorities and a city falls out of the top-N). Countries / timezones
  // are additive — never delete, since FK references from cities matter.
  lines.push('-- Reset tables that this seed fully owns -----------------------------');
  lines.push('DELETE FROM city_translations;');
  lines.push('DELETE FROM cities;');
  lines.push('');

  lines.push('-- Countries -----------------------------------------------------------');
  for (const code of [...usedCountries].sort()) {
    const c = countries.get(code);
    if (!c) {
      console.warn(`! missing country info for ${code}`);
      continue;
    }
    const continent = CONTINENTS[c.continent] ?? c.continent;
    lines.push(
      `INSERT OR REPLACE INTO countries (code, name_en, continent) VALUES (${q(code)}, ${q(c.name)}, ${q(continent)});`,
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
  let priority = cities.length;
  for (const c of cities) {
    lines.push(
      `INSERT OR REPLACE INTO cities (id, slug, name_en, ascii_name, country_code, admin1_code, population, latitude, longitude, timezone_id, is_disambiguated, prerender_priority) VALUES (${c.id}, ${q(c.slug)}, ${q(c.name)}, ${q(c.ascii)}, ${q(c.countryCode)}, ${q(c.admin1 || null)}, ${c.population}, ${c.lat}, ${c.lon}, ${q(c.timezone)}, ${c.isDisambiguated ? 1 : 0}, ${priority--});`,
    );
  }
  lines.push('');

  lines.push('-- City translations --------------------------------------------------');
  for (const c of cities) {
    const trans = translations.get(c.id);
    if (!trans) continue;
    for (const [lang, name] of trans) {
      lines.push(
        `INSERT OR REPLACE INTO city_translations (city_id, lang, name) VALUES (${c.id}, ${q(lang)}, ${q(name)});`,
      );
    }
  }
  lines.push('');

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  console.log('▸ Ensuring downloads…');
  const citiesPath = await ensureDownload('cities');
  const altNamesPath = await ensureDownload('altNames');
  const countriesPath = await ensureDownload('countries');

  console.log('▸ Parsing cities…');
  const allRows = await parseCities(citiesPath);
  console.log(`  found ${allRows.length.toLocaleString()} cities ≥ ${POP_FLOOR.toLocaleString()} pop`);

  console.log(`▸ Ranking + slugging top ${TOP_N}…`);
  const top = rank(allRows);
  const cityIds = new Set(top.map((c) => c.id));
  const minPop = top.at(-1)?.population ?? 0;
  console.log(`  pop floor in top ${TOP_N}: ${minPop.toLocaleString()}`);

  console.log('▸ Parsing alternate names (slow — ~400MB scan)…');
  const geonamesTranslations = await parseTranslations(altNamesPath, cityIds);
  const geoTotal = [...geonamesTranslations.values()].reduce((acc, m) => acc + m.size, 0);
  console.log(`  GeoNames: ${geonamesTranslations.size}/${top.length} cities, ${geoTotal} entries`);

  console.log('▸ Loading curated translations (if present)…');
  const curatedTranslations = await loadCuratedTranslations();
  const curatedTotal = [...curatedTranslations.values()].reduce((acc, m) => acc + m.size, 0);
  console.log(`  Curated: ${curatedTranslations.size} cities, ${curatedTotal} entries (overlay; wins on conflict)`);

  const translations = mergeTranslations(geonamesTranslations, curatedTranslations);
  // Count only translations for cities actually in the seed — curated entries
  // for cities outside the top-N would silently fail FK on insert.
  let totalT = 0;
  for (const c of top) totalT += translations.get(c.id)?.size ?? 0;
  const disambiguatedCount = top.filter((c) => c.isDisambiguated).length;

  console.log('▸ Parsing countries…');
  const countries = await parseCountries(countriesPath);

  console.log('▸ Emitting seed.sql…');
  const out = emitSeed(top, translations, countries);
  await mkdir('data', { recursive: true });
  await writeFile(OUT_FILE, out, 'utf8');

  console.log('');
  console.log(`✓ Wrote ${OUT_FILE} (${(out.length / 1024).toFixed(1)} KB)`);
  console.log(`  cities:         ${top.length}`);
  console.log(`  disambiguated:  ${disambiguatedCount}`);
  console.log(`  countries:      ${new Set(top.map((c) => c.countryCode)).size}`);
  console.log(`  timezones:      ${new Set(top.map((c) => c.timezone)).size}`);
  console.log(`  translations:   ${totalT} (merged: ${geoTotal} GeoNames + ${curatedTotal} curated)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
