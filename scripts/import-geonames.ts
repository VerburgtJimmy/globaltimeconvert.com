// One-shot import: downloads GeoNames dumps, generates `data/seed.sql`.
// Run:    npm run data:import
// Apply:  npm run db:seed:local

import { execFileSync } from 'node:child_process';
import { existsSync, createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RAW_DIR = 'data/raw';
const OUT_FILE = 'data/seed.sql';
const TOP_N = 200;
const CAPITAL_BONUS = 1_000_000;
const POP_FLOOR = 50_000;

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
    url: 'https://download.geonames.org/export/dump/cities500.zip',
    zip: 'cities500.zip',
    txt: 'cities500.txt',
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

function rank(rows: CityRow[]): RankedCity[] {
  const scored: RankedCity[] = rows.map((r) => ({
    ...r,
    slug: '',
    score: r.population + (r.featureCode === 'PPLC' ? CAPITAL_BONUS : 0),
  }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, TOP_N);

  const seen = new Map<string, RankedCity>();
  for (const c of top) {
    const s = slugify(c.ascii);
    if (!s) throw new Error(`Empty slug for ${c.name} (id ${c.id})`);
    const clash = seen.get(s);
    if (clash) {
      throw new Error(
        `Slug collision in top ${TOP_N}: "${s}" — ${c.name} (${c.countryCode}) vs ${clash.name} (${clash.countryCode}). ` +
          `Add disambiguation logic before re-running.`,
      );
    }
    seen.set(s, c);
    c.slug = s;
  }
  return top;
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
  cities: RankedCity[],
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
  let priority = TOP_N;
  for (const c of cities) {
    lines.push(
      `INSERT OR REPLACE INTO cities (id, slug, name_en, ascii_name, country_code, admin1_code, population, latitude, longitude, timezone_id, is_disambiguated, prerender_priority) VALUES (${c.id}, ${q(c.slug)}, ${q(c.name)}, ${q(c.ascii)}, ${q(c.countryCode)}, ${q(c.admin1 || null)}, ${c.population}, ${c.lat}, ${c.lon}, ${q(c.timezone)}, 0, ${priority--});`,
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
  const translations = await parseTranslations(altNamesPath, cityIds);
  const totalT = [...translations.values()].reduce((acc, m) => acc + m.size, 0);
  console.log(`  ${translations.size}/${top.length} cities with at least one translation, ${totalT} total`);

  console.log('▸ Parsing countries…');
  const countries = await parseCountries(countriesPath);

  console.log('▸ Emitting seed.sql…');
  const out = emitSeed(top, translations, countries);
  await mkdir('data', { recursive: true });
  await writeFile(OUT_FILE, out, 'utf8');

  console.log('');
  console.log(`✓ Wrote ${OUT_FILE} (${(out.length / 1024).toFixed(1)} KB)`);
  console.log(`  cities:       ${top.length}`);
  console.log(`  countries:    ${new Set(top.map((c) => c.countryCode)).size}`);
  console.log(`  timezones:    ${new Set(top.map((c) => c.timezone)).size}`);
  console.log(`  translations: ${totalT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
