/// <reference types="@cloudflare/workers-types" />

import { env } from 'cloudflare:workers';
import type { Locale } from './i18n';

export interface CityRow {
  id: number;
  slug: string;
  name_en: string;
  ascii_name: string;
  country_code: string;
  admin1_code: string | null;
  population: number;
  latitude: number;
  longitude: number;
  timezone_id: string;
  is_disambiguated: number;
  prerender_priority: number;
}

export interface CountryRow {
  code: string;
  name_en: string;
  continent: string;
}

export interface TimezoneRow {
  id: string;
  abbr_standard: string | null;
  abbr_dst: string | null;
  utc_offset_std_min: number;
  observes_dst: number;
}

export interface CityWithCountry extends CityRow {
  country_name: string;
  /**
   * Display name for the requested locale: localized translation when one
   * exists in `city_translations`, otherwise falls back to `name_en`.
   * Always equals `name_en` when caller passes lang='en' or omits lang.
   */
  display_name: string;
}

export function getDb(): D1Database {
  const db = env.DB;
  if (!db) {
    throw new Error(
      'D1 binding "DB" not available. Check wrangler.toml and that you are ' +
        'running through `astro dev` or `wrangler dev`.',
    );
  }
  return db;
}

/** Fetch a single city by slug, joined with its country name + locale display name. */
export async function getCityBySlug(
  db: D1Database,
  slug: string,
  lang: Locale = 'en',
): Promise<CityWithCountry | null> {
  return await db
    .prepare(
      `SELECT c.*, co.name_en AS country_name,
              COALESCE(ct.name, c.name_en) AS display_name
       FROM cities c
       JOIN countries co ON co.code = c.country_code
       LEFT JOIN city_translations ct ON ct.city_id = c.id AND ct.lang = ?1
       WHERE c.slug = ?2`,
    )
    .bind(lang, slug)
    .first<CityWithCountry>();
}

/** Top N cities ordered by prerender_priority (highest first). */
export async function getTopCities(
  db: D1Database,
  limit = 12,
  lang: Locale = 'en',
): Promise<CityWithCountry[]> {
  const res = await db
    .prepare(
      `SELECT c.*, co.name_en AS country_name,
              COALESCE(ct.name, c.name_en) AS display_name
       FROM cities c
       JOIN countries co ON co.code = c.country_code
       LEFT JOIN city_translations ct ON ct.city_id = c.id AND ct.lang = ?1
       ORDER BY c.prerender_priority DESC
       LIMIT ?2`,
    )
    .bind(lang, limit)
    .all<CityWithCountry>();
  return res.results ?? [];
}

/** Cities with a different timezone than `excludeCity`, ordered by priority. */
export async function getCitiesAcrossZones(
  db: D1Database,
  excludeCityId: number,
  limit = 20,
  lang: Locale = 'en',
): Promise<CityWithCountry[]> {
  const res = await db
    .prepare(
      `SELECT c.*, co.name_en AS country_name,
              COALESCE(ct.name, c.name_en) AS display_name
       FROM cities c
       JOIN countries co ON co.code = c.country_code
       LEFT JOIN city_translations ct ON ct.city_id = c.id AND ct.lang = ?1
       WHERE c.id != ?2
         AND c.timezone_id != (SELECT timezone_id FROM cities WHERE id = ?2)
       ORDER BY c.prerender_priority DESC
       LIMIT ?3`,
    )
    .bind(lang, excludeCityId, limit)
    .all<CityWithCountry>();
  return res.results ?? [];
}

/** All localized names for a city, keyed by language. */
export async function getCityTranslations(
  db: D1Database,
  cityId: number,
): Promise<Record<string, string>> {
  const res = await db
    .prepare('SELECT lang, name FROM city_translations WHERE city_id = ?')
    .bind(cityId)
    .all<{ lang: string; name: string }>();
  const out: Record<string, string> = {};
  for (const r of res.results ?? []) out[r.lang] = r.name;
  return out;
}
