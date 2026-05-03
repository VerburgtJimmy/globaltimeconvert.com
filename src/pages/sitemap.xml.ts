import type { APIRoute } from 'astro';
import { SUPPORTED_LOCALES } from '../lib/i18n';

// Sitemap index. We chunk by both type and locale because:
//   - the pairs sitemap has 49,952 URLs per locale (just under the 50k limit)
//   - 6 locales × 49,952 = ~300k URLs would overflow a single file
// So we emit 12 chunks total (6 langs × {static, pairs}).

export const prerender = false;

export const GET: APIRoute = ({ site }) => {
  const today = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const lang of SUPPORTED_LOCALES) {
    lines.push(
      sitemapEntry(new URL(`/sitemap-static-${lang}.xml`, site).toString(), today),
    );
    lines.push(
      sitemapEntry(new URL(`/sitemap-pairs-${lang}.xml`, site).toString(), today),
    );
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
