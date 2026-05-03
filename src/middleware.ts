import { defineMiddleware } from 'astro:middleware';

// Two responsibilities:
//
//   1. /admin auth guard (Phase 9). In production we require the
//      `Cf-Access-Jwt-Assertion` header that Cloudflare Access adds to every
//      authenticated request. CF Access enforces auth at the edge — this
//      middleware is belt-and-suspenders against accidental exposure.
//      In dev we let /admin through without the header so local development
//      Just Works.
//
//   2. 404-body normalizer. Page dispatchers return plain
//      `new Response('Not found', { status: 404 })` when a slug doesn't match
//      a real city. We detect non-HTML 404s and replace them with the styled
//      /404 page body, preserving the 404 status.

export const onRequest = defineMiddleware(async (context, next) => {
  // -------- /admin gate ---------------------------------------------------
  // Astro/Vite statically replaces `import.meta.env.PROD` — true only when
  // the worker was built with `astro build`, false under `astro dev`.
  if (import.meta.env.PROD && context.url.pathname.startsWith('/admin')) {
    const cfJwt = context.request.headers.get('cf-access-jwt-assertion');
    if (!cfJwt) {
      return new Response(
        'Unauthorized — this route is protected by Cloudflare Access.',
        {
          status: 401,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store',
          },
        },
      );
    }
    // CF Access already validated the JWT; we trust the header's presence
    // because Cloudflare strips client-supplied versions before hitting
    // the worker. Verifying the signature here is possible but adds
    // ~50ms cold-start; revisit if defense-in-depth becomes a hard ask.
  }

  const response = await next();

  // -------- 404 normalizer ------------------------------------------------
  if (response.status !== 404) return response;
  const ct = response.headers.get('content-type') ?? '';
  if (ct.startsWith('text/html')) return response;
  if (context.url.pathname === '/404') return response;

  const rendered = await context.rewrite('/404');
  return new Response(await rendered.text(), {
    status: 404,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
});
