/// <reference types="@cloudflare/workers-types" />

// Privacy-first analytics layer (PLAN §7).
//
//   - No cookies, no localStorage, no fingerprinting.
//   - We never persist the visitor IP. We hash it with a daily-rotating salt
//     so we can count distinct visitors per day; the salt itself is purged
//     after 7 days, making prior-day visitor hashes unrecoverable.
//   - All events go to Workers Analytics Engine (binding ANALYTICS); the
//     /admin dashboard rolls them up into the analytics_*_daily tables.
//   - Geo is country-only, sourced from Cloudflare's `CF-IPCountry` header
//     (already region-anonymised at the edge).

import { env } from 'cloudflare:workers';

const HASH_BYTES = 16; // 128-bit truncated SHA-256 — plenty for collision resistance within a day.
const SALT_LIFETIME_DAYS = 7;

/** "YYYY-MM-DD" in UTC. */
export function utcDateKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Look up today's hashing salt. Creates one if missing (lazy rotation —
 * no cron needed). Opportunistically purges salts older than 7 days.
 */
export async function getDailySalt(db: D1Database): Promise<string> {
  const today = utcDateKey();

  const row = await db
    .prepare('SELECT salt FROM analytics_salts WHERE date = ?')
    .bind(today)
    .first<{ salt: string }>();
  if (row?.salt) return row.salt;

  // Generate a fresh 256-bit salt using the platform CSPRNG.
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const salt = bufferToHex(buf);

  // INSERT OR IGNORE keeps us race-safe — if two beacons arrive in the same
  // millisecond on different colos, only the first row sticks.
  await db
    .prepare('INSERT OR IGNORE INTO analytics_salts (date, salt) VALUES (?, ?)')
    .bind(today, salt)
    .run();

  // Re-read to handle the race where another isolate wrote first.
  const winner = await db
    .prepare('SELECT salt FROM analytics_salts WHERE date = ?')
    .bind(today)
    .first<{ salt: string }>();

  // Opportunistic prune (1% of cache-misses) — keeps the table bounded.
  if (Math.random() < 0.01) {
    const cutoff = utcDateKey(
      new Date(Date.now() - SALT_LIFETIME_DAYS * 86_400_000),
    );
    await db
      .prepare('DELETE FROM analytics_salts WHERE date < ?')
      .bind(cutoff)
      .run();
  }

  return winner?.salt ?? salt;
}

/** SHA-256(ip + salt) → first 16 bytes as hex. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${ip}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(new Uint8Array(digest).slice(0, HASH_BYTES));
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Analytics Engine writers.
//
// AE schema convention (one dataset, mixed events tagged by blob1):
//   blobs:    [event_type, ...event-specific fields]
//   indexes:  one of the high-cardinality fields (per AE limits)
//   doubles:  numeric metrics (currently unused; reserved for timing)
// ---------------------------------------------------------------------------

export interface BeaconEvent {
  path: string;
  lang: string;
  country: string;
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  visitorHash: string;
}

export interface SearchEvent {
  query: string;
  lang: string;
  country: string;
  visitorHash: string;
}

export function writePageview(e: BeaconEvent): void {
  const ds = env.ANALYTICS;
  if (!ds) return; // gracefully no-op in environments without the binding
  ds.writeDataPoint({
    blobs: [
      'page',
      e.path,
      e.lang,
      e.country,
      e.referrer,
      e.utmSource,
      e.utmMedium,
      e.utmCampaign,
      e.visitorHash,
    ],
    doubles: [],
    indexes: [e.path],
  });
}

export function writeSearch(e: SearchEvent): void {
  const ds = env.ANALYTICS;
  if (!ds) return;
  ds.writeDataPoint({
    blobs: ['search', e.query, e.lang, e.country, e.visitorHash],
    doubles: [],
    indexes: [e.query],
  });
}

/** Trim and lowercase a referrer URL down to its host. Empty string if invalid. */
export function refDomain(referrer: string | null | undefined): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Cap a free-form string for AE storage. AE's blob limit is 5,120 bytes; we cap shorter. */
export function capString(s: string | null | undefined, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max);
}
