import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';
import { SUPPORTED_LOCALES } from '../lib/i18n';
import { PAIRS_URL_LIMIT } from '../lib/sitemap';

// Sitemap index. Each locale gets:
//   - 1 static sitemap (homepage, /about, /donate, city clocks, anchor-time URLs)
//   - N pair sitemaps (chunked at 49,999 URLs each — one URL per directional pair)
//
// At 1000 cities: ~10k static + 999k pair URLs/locale → 1 static + 20 pair chunks.
// At 5000 cities: ~50k static (right at limit, will need static sharding too) +
//                 ~25M pair URLs/locale → ~500 pair chunks. Plan for it then.

interface CountRow {
  n: number;
}

export const prerender = false;

export const GET: APIRoute = async ({ site }) => {
  const today = new Date().toISOString().slice(0, 10);
  const db = getDb();
  const countResult = await db.prepare('SELECT COUNT(*) AS n FROM cities').first<CountRow>();
  const cityCount = countResult?.n ?? 0;
  const pairsPerLocale = cityCount * Math.max(cityCount - 1, 0);
  const pairChunkCount = Math.ceil(pairsPerLocale / PAIRS_URL_LIMIT);

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const lang of SUPPORTED_LOCALES) {
    lines.push(
      sitemapEntry(new URL(`/sitemap-static-${lang}.xml`, site).toString(), today),
    );
    for (let chunk = 0; chunk < pairChunkCount; chunk++) {
      lines.push(
        sitemapEntry(
          new URL(`/sitemap-pairs-${lang}-${chunk}.xml`, site).toString(),
          today,
        ),
      );
    }
  }
  lines.push('</sitemapindex>');

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800',
    },
  });
};

function sitemapEntry(loc: string, lastmod: string): string {
  return `  <sitemap><loc>${loc}</loc><lastmod>${lastmod}</lastmod></sitemap>`;
}
