import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { isValidLocale, pathFor, type Locale } from '../lib/i18n';
import { PAIRS_URL_LIMIT } from '../lib/sitemap';

// One chunk of directional city-pair URLs for one locale.
// Sharded because: 1000 cities → 999,000 directional pairs per locale,
// far over the sitemap-spec 50k-URL/file limit.
//
// Routing: /sitemap-pairs-{lang}-{chunk}.xml, chunk is 0-indexed.
// Each chunk emits exactly PAIRS_URL_LIMIT pairs (the tail chunk may be shorter).
// The pair order is deterministic (DB priority desc, then slug asc) so the
// same chunk index always returns the same slice across requests.

interface SlugRow {
  slug: string;
}

export const prerender = false;


export const GET: APIRoute = async ({ site, params }) => {
  const lang = params.lang;
  const chunkStr = params.chunk;
  if (!isValidLocale(lang)) {
    return new Response('Not found', { status: 404 });
  }
  const chunk = Number.parseInt(chunkStr ?? '', 10);
  if (!Number.isInteger(chunk) || chunk < 0) {
    return new Response('Not found', { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const base = new URL('/', site!).toString().replace(/\/$/, '');

  const db = getDb();
  const cities = await db
    .prepare('SELECT slug FROM cities ORDER BY prerender_priority DESC, slug ASC')
    .all<SlugRow>();
  const slugs = (cities.results ?? []).map((c) => c.slug);
  const totalPairs = slugs.length * Math.max(slugs.length - 1, 0);
  const totalChunks = Math.ceil(totalPairs / PAIRS_URL_LIMIT);
  if (chunk >= totalChunks) {
    return new Response('Not found', { status: 404 });
  }

  const start = chunk * PAIRS_URL_LIMIT;
  const end = start + PAIRS_URL_LIMIT;

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  let idx = 0;
  outer: for (const a of slugs) {
    for (const b of slugs) {
      if (a === b) continue;
      if (idx >= start && idx < end) {
        lines.push(
          urlEntry(base + pathFor(`/${a}-to-${b}`, lang as Locale), today, '0.7', 'daily'),
        );
      }
      idx += 1;
      if (idx >= end) break outer;
    }
  }
  lines.push('</urlset>');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};

function urlEntry(
  loc: string,
  lastmod: string,
  priority: string,
  changefreq: string,
): string {
  return (
    `  <url><loc>${loc}</loc>` +
    `<lastmod>${lastmod}</lastmod>` +
    `<changefreq>${changefreq}</changefreq>` +
    `<priority>${priority}</priority></url>`
  );
}
