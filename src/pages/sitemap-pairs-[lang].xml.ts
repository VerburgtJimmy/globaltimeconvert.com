import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { isValidLocale, pathFor, type Locale } from '../lib/i18n';

// All directional city-pair URLs for one locale.
// 224 cities × 223 = 49,952 URLs per locale.

interface SlugRow {
  slug: string;
}

export const prerender = false;

const URL_LIMIT = 49_999;

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

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  let count = 0;
  outer: for (const a of slugs) {
    for (const b of slugs) {
      if (a === b) continue;
      lines.push(
        urlEntry(base + pathFor(`/${a}-to-${b}`, lang as Locale), today, '0.7', 'daily'),
      );
      count += 1;
      if (count >= URL_LIMIT) break outer;
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
