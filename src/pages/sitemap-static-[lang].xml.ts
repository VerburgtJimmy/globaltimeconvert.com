import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { isValidLocale, pathFor, type Locale } from '../lib/i18n';
import { ANCHOR_TIMES, formatTimePrefix } from '../lib/time-slugs';

// Static + city-clock URLs + anchor-time-city URLs for one locale.
// ~229 base + (224 cities × 9 anchor times) = ~2,245 URLs per locale.
// Well under the 50,000-URL chunk limit.
//
// Privacy and Terms are EN-only (legal copy, deferred per Phase 5 scope).

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
  for (const c of cities.results ?? []) {
    lines.push(
      urlEntry(base + pathFor(`/time-in-${c.slug}`, lang as Locale), today, '0.9', 'daily'),
    );
    for (const time of ANCHOR_TIMES) {
      const tslug = formatTimePrefix(time, lang as Locale);
      lines.push(
        urlEntry(
          base + pathFor(`/${tslug}-${c.slug}`, lang as Locale),
          today,
          '0.7',
          'daily',
        ),
      );
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
