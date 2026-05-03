import type { APIRoute } from 'astro';
import { getDb } from '../../lib/db';
import {
  getDailySalt,
  hashIp,
  writeSearch,
  capString,
} from '../../lib/analytics';

interface SearchHit {
  slug: string;
  name_en: string;
  ascii_name: string;
  country: string;
  timezone_id: string;
}

const MIN_QUERY = 2;
const LIMIT = 8;

export const prerender = false;

export const GET: APIRoute = async ({ url, request, clientAddress }) => {
  const raw = (url.searchParams.get('q') ?? '').trim();
  if (raw.length < MIN_QUERY) {
    return json([], 60);
  }

  // Cap query length so an attacker can't burn cache slots with random strings.
  const q = raw.slice(0, 50).toLowerCase();
  const prefix = q + '%';
  const contains = '%' + q + '%';

  const db = getDb();

  // Log the search query to Analytics Engine (privacy-preserving — query
  // string + visitor_hash, never the raw IP). Fire-and-forget; failure is
  // silent so analytics never blocks search results.
  void (async () => {
    try {
      const country = capString(request.headers.get('cf-ipcountry') ?? 'XX', 4);
      const ip =
        request.headers.get('cf-connecting-ip') ?? clientAddress ?? '0.0.0.0';
      const salt = await getDailySalt(db);
      const visitorHash = await hashIp(ip, salt);
      writeSearch({
        query: q,
        lang: 'en',
        country,
        visitorHash,
      });
    } catch {
      /* swallow */
    }
  })();
  // Strategy: prefix matches first (priority by population), then "contains"
  // matches as fallback. UNION ALL keeps the natural ordering.
  const res = await db
    .prepare(
      `SELECT slug, name_en, ascii_name, country, timezone_id
       FROM (
         SELECT c.slug, c.name_en, c.ascii_name,
                co.name_en AS country, c.timezone_id,
                0 AS rank,
                c.prerender_priority AS pri
           FROM cities c
           JOIN countries co ON co.code = c.country_code
          WHERE LOWER(c.ascii_name) LIKE ?1 OR LOWER(c.name_en) LIKE ?1
         UNION ALL
         SELECT c.slug, c.name_en, c.ascii_name,
                co.name_en AS country, c.timezone_id,
                1 AS rank,
                c.prerender_priority AS pri
           FROM cities c
           JOIN countries co ON co.code = c.country_code
          WHERE (LOWER(c.ascii_name) LIKE ?2 OR LOWER(c.name_en) LIKE ?2)
            AND NOT (LOWER(c.ascii_name) LIKE ?1 OR LOWER(c.name_en) LIKE ?1)
       )
       ORDER BY rank ASC, pri DESC
       LIMIT ?3`,
    )
    .bind(prefix, contains, LIMIT)
    .all<SearchHit>();

  return json(res.results ?? [], 300);
};

function json(body: unknown, sMaxage: number): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, s-maxage=${sMaxage}, stale-while-revalidate=86400`,
    },
  });
}
