import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { isValidLocale, pathFor, type Locale } from '../lib/i18n';
import { ANCHOR_TIMES, formatTimePrefix } from '../lib/time-slugs';

// Static + city-clock URLs + anchor-time-city URLs + a curated slice of
// anchor-time-pair URLs (top origins × top destinations) for one locale.
//
// At 1,000 cities: 5 base + 1,000 city-clock + 9,000 anchor-time-city
// + 100 origins × 12 destinations × 9 anchor times ≈ 10,800 anchor-time-pair
// = ~21k URLs per locale. Well under the 50,000-URL chunk limit.
//
// We don't enumerate all 1,000 × 12 × 9 ≈ 108k anchor-time-pair URLs in the
// sitemap (would overflow). Instead the top-100 origins seed Google's crawl,
// and the rest are reachable via the in-page links (TimeCityPage compare rows
// link to /9am-{city}-to-{other}). Google follows those naturally.
//
// Privacy and Terms are EN-only (legal copy, deferred per Phase 5 scope).
const TOP_ORIGIN_COUNT = 100;
const TOP_DESTINATION_COUNT = 12;

interface SlugRow {
  slug: string;
}

export const prerender = false;

export const GET: APIRoute = async ({ site, params }) => {
  const lang = params.lang;
  if (!isValidLocale(lang)) {
    return new Response('Not found', { status: 404 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const base = new URL('/', site!).toString().replace(/\/$/, '');

  const db = getDb();
  const cities = await db
    .prepare('SELECT slug FROM cities ORDER BY prerender_priority DESC')
    .all<SlugRow>();
  const slugs = (cities.results ?? []).map((c) => c.slug);
  const topOrigins = slugs.slice(0, TOP_ORIGIN_COUNT);
  const topDestinations = slugs.slice(0, TOP_DESTINATION_COUNT);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlEntry(base + pathFor('/', lang), today, '1.0', 'daily'),
    urlEntry(base + pathFor('/about', lang), today, '0.6', 'monthly'),
    urlEntry(base + pathFor('/donate', lang), today, '0.5', 'monthly'),
  ];
  if (lang === 'en') {
    lines.push(urlEntry(`${base}/privacy`, today, '0.4', 'yearly'));
    lines.push(urlEntry(`${base}/terms`, today, '0.4', 'yearly'));
  }
  // City clocks + anchor-time-city pages.
  for (const slug of slugs) {
    lines.push(
      urlEntry(base + pathFor(`/time-in-${slug}`, lang as Locale), today, '0.9', 'daily'),
    );
    for (const time of ANCHOR_TIMES) {
      const tslug = formatTimePrefix(time, lang as Locale);
      lines.push(
        urlEntry(
          base + pathFor(`/${tslug}-${slug}`, lang as Locale),
          today,
          '0.7',
          'daily',
        ),
      );
    }
  }
  // Anchor-time-pair pages: top-100 origins × top-12 destinations × 9 anchor
  // times. Skip self-pairs.
  for (const origin of topOrigins) {
    for (const time of ANCHOR_TIMES) {
      const tslug = formatTimePrefix(time, lang as Locale);
      for (const dest of topDestinations) {
        if (origin === dest) continue;
        lines.push(
          urlEntry(
            base + pathFor(`/${tslug}-${origin}-to-${dest}`, lang as Locale),
            today,
            '0.6',
            'daily',
          ),
        );
      }
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
