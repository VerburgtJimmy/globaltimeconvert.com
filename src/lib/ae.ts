/// <reference types="@cloudflare/workers-types" />

// Workers Analytics Engine SQL client (PLAN §7 / §8).
//
// We query Cloudflare's AE SQL API directly from the /admin pages instead of
// running a nightly rollup cron. Tradeoffs:
//   + No cron complexity, no D1 rollup tables to maintain.
//   + Results are always fresh (within the 5-minute KV cache below).
//   + Cheap — AE bills $0.01 per million data points read.
//   - Each /admin page hit makes an external API call (cached, but still).
//
// Auth: bearer token with the "Account Analytics" scope. See PLAN.md §11
// for setup steps.

import { env } from 'cloudflare:workers';

const DATASET = 'globaltimeconvert_events';
const CACHE_TTL_SECONDS = 300; // 5 min — admin reload can refresh by appending ?nc=1
const CACHE_PREFIX = 'admin:ae:';

export interface AeRow {
  [column: string]: string | number;
}

export interface AeResult {
  rows: AeRow[];
  total: number;
  /** True if the result was served from KV. */
  cached: boolean;
}

interface AeApiResponse {
  meta: Array<{ name: string; type: string }>;
  /**
   * Workers Analytics Engine returns each row as an object keyed by
   * column name (`{path: "...", pageviews: 42}`). Older / docs-described
   * variants return arrays-of-arrays; we handle both defensively below.
   */
  data: Array<Record<string, unknown> | unknown[]>;
  rows: number;
}

/**
 * Run an AE SQL query. Pass a stable `cacheKey` to opt into KV caching.
 * Returns empty rows when CF credentials are missing (dev fallback).
 */
export async function aeQuery(sql: string, cacheKey?: string): Promise<AeResult> {
  const accountId = env.CF_ACCOUNT_ID;
  const token = env.CF_API_TOKEN;

  if (!accountId || !token) {
    // Dev / unconfigured. Render the dashboard with empty data instead of
    // erroring — much friendlier when first wiring up the project.
    return { rows: [], total: 0, cached: false };
  }

  const kv = env.OG_CACHE; // re-using the OG KV namespace; tiny payloads, no contention
  const fullKey = cacheKey ? CACHE_PREFIX + cacheKey : null;

  if (fullKey && kv) {
    const cached = await kv.get(fullKey, 'json');
    if (cached) return { ...(cached as Omit<AeResult, 'cached'>), cached: true };
  }

  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
    },
  );

  if (!r.ok) {
    throw new Error(`AE query failed: ${r.status} ${await r.text()}`);
  }

  const data = (await r.json()) as AeApiResponse;
  const rawRows = data.data ?? [];
  const meta = data.meta ?? [];
  const rows: AeRow[] = rawRows.map((row) => {
    // AE typically returns each row as an object keyed by column name.
    // Some legacy / docs-described responses return array-of-arrays — zip
    // with the meta column names if so.
    if (Array.isArray(row)) {
      const obj: AeRow = {};
      meta.forEach((col, i) => {
        obj[col.name] = row[i] as string | number;
      });
      return obj;
    }
    return row as AeRow;
  });

  const result: Omit<AeResult, 'cached'> = { rows, total: data.rows };
  if (fullKey && kv) {
    try {
      await kv.put(fullKey, JSON.stringify(result), {
        expirationTtl: CACHE_TTL_SECONDS,
      });
    } catch {
      /* swallow — cache writes shouldn't break responses */
    }
  }

  return { ...result, cached: false };
}

// ---------------------------------------------------------------------------
// AE schema reminder (writers in lib/analytics.ts):
//   blob1 = event_type ('page' | 'search')
//   blob2 = path | query
//   blob3 = lang
//   blob4 = country
//   blob5 = referrer_domain (page only)
//   blob6 = utm_source       (page only)
//   blob7 = utm_medium       (page only)
//   blob8 = utm_campaign     (page only)
//   blob9 = visitor_hash     (page only)
//   blob5 = visitor_hash     (search only — fewer fields)
// ---------------------------------------------------------------------------

const PAGE_DATASET_FROM = `FROM ${DATASET}`;

/** Total pageviews + distinct visitors over the last N days. */
export function totalsLastDays(days: number): Promise<AeResult> {
  const sql = `
    SELECT
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT blob9) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'page'
  `;
  return aeQuery(sql, `totals:${days}d`);
}

/** Pageviews + distinct visitors today (UTC). */
export function totalsToday(): Promise<AeResult> {
  const sql = `
    SELECT
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT blob9) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > toStartOfDay(NOW())
      AND blob1 = 'page'
  `;
  return aeQuery(sql, `totals:today`);
}

/** Daily series for the sparkline / chart on the overview. */
export function dailySeries(days: number): Promise<AeResult> {
  const sql = `
    SELECT
      formatDateTime(toStartOfDay(timestamp), '%F') AS day,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT blob9) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'page'
    GROUP BY day
    ORDER BY day ASC
  `;
  return aeQuery(sql, `series:${days}d`);
}

export function topPages(days = 7, limit = 20): Promise<AeResult> {
  const sql = `
    SELECT
      blob2 AS path,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT blob9) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'page'
    GROUP BY blob2
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
  return aeQuery(sql, `top-pages:${days}d:${limit}`);
}

export function topSearches(days = 7, limit = 20): Promise<AeResult> {
  const sql = `
    SELECT
      blob2 AS query,
      SUM(_sample_interval) AS searches,
      COUNT(DISTINCT blob5) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'search'
    GROUP BY blob2
    ORDER BY searches DESC
    LIMIT ${limit}
  `;
  return aeQuery(sql, `top-searches:${days}d:${limit}`);
}

export function topReferrers(days = 7, limit = 20): Promise<AeResult> {
  const sql = `
    SELECT
      blob5 AS referrer,
      SUM(_sample_interval) AS pageviews
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'page'
      AND blob5 != ''
    GROUP BY blob5
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
  return aeQuery(sql, `top-referrers:${days}d:${limit}`);
}

export function topCountries(days = 7, limit = 20): Promise<AeResult> {
  const sql = `
    SELECT
      blob4 AS country,
      SUM(_sample_interval) AS pageviews,
      COUNT(DISTINCT blob9) AS visitors
    ${PAGE_DATASET_FROM}
    WHERE timestamp > NOW() - INTERVAL '${days}' DAY
      AND blob1 = 'page'
    GROUP BY blob4
    ORDER BY pageviews DESC
    LIMIT ${limit}
  `;
  return aeQuery(sql, `top-countries:${days}d:${limit}`);
}

/** Helper: get a numeric column from a single-row result, or 0. */
export function pickNumber(result: AeResult, key: string): number {
  const v = result.rows[0]?.[key];
  return typeof v === 'number' ? v : Number(v ?? 0);
}
