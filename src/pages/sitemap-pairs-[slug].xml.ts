import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { isValidLocale, pathFor, type Locale } from '../lib/i18n';
import { PAIRS_URL_LIMIT } from '../lib/sitemap';

// One chunk of directional city-pair URLs for one locale.
// Sharded because at 2,500 cities → ~6.25M directional pairs per locale,
// far over the sitemap-spec 50k-URL/file limit.
//
// Routing: /sitemap-pairs-{lang}-{chunk}.xml — chunk is 0-indexed. Each
// chunk emits exactly PAIRS_URL_LIMIT pairs (the tail chunk may be
// shorter). Pair order is deterministic (DB priority desc, then slug asc)
// so the same chunk index always returns the same slice across requests.
//
// Implementation note: we use a single [slug] param and parse it manually
// rather than [lang]-[chunk] separately, because the "zh-CN" locale itself
// contains a hyphen — Astro's two-param matcher couldn't unambiguously
// split "zh-CN-0" and was returning lang="zh", chunk="CN-0", which 404'd
// in the integer check. Splitting on the *last* dash here gives the right
// (lang, chunk) pair for every supported locale.

interface SlugRow {
  slug: string;
}

export const prerender = false;

export const GET: APIRoute = async ({ site, params }) => {
  const rawSlug = params.slug ?? '';
  const lastDash = rawSlug.lastIndexOf('-');
  if (lastDash <= 0 || lastDash === rawSlug.length - 1) {
    return new Response('Not found', { status: 404 });
  }
  const lang = rawSlug.slice(0, lastDash);
  const chunkStr = rawSlug.slice(lastDash + 1);
  if (!isValidLocale(lang)) {
    return new Response('Not found', { status: 404 });
  }
  const chunk = Number.parseInt(chunkStr, 10);
  // Strict integer check — `String(chunk) === chunkStr` rejects things
  // like "0.5", "01", or "0abc" that parseInt would silently accept.
  if (!Number.isInteger(chunk) || chunk < 0 || String(chunk) !== chunkStr) {
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
