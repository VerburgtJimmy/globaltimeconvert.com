import type { APIRoute } from 'astro';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('/sitemap.xml', site).toString();
  const body =
    [
      'User-agent: *',
      'Allow: /',
      '',
      // Don't waste crawl budget on dev artifacts or the analytics beacon
      // (Phase 7). Add Disallow lines as those endpoints come online.
      'Disallow: /api/',
      'Disallow: /admin/',
      '',
      `Sitemap: ${sitemap}`,
    ].join('\n') + '\n';

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
};
