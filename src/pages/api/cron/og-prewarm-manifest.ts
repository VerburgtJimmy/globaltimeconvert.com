/// <reference types="@cloudflare/workers-types" />

// Returns the list of OG-image slugs the weekly cron should pre-warm.
// The cron worker (workers/cron/) fetches this manifest, then hits each
// `/og/{slug}.png` so the KV cache stays populated for crawlers and
// social-share previews.
//
// We compute the list from the live D1 city table rather than hardcoding
// it — this way the manifest grows automatically when we add cities, and
// the same `prerender_priority` ordering that drives the rest of the
// site decides which OG cards stay warm.
//
// Auth via the shared CRON_TOKEN secret (same as /api/cron/dst-rollover).
//
//   curl -H "x-cron-token: $CRON_TOKEN" \
//     https://globaltimeconvert.com/api/cron/og-prewarm-manifest

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../lib/db';

export const prerender = false;

// Tuning knobs. The set below fits comfortably inside Cloudflare Workers'
// 1,000-subrequests-per-invocation limit, with headroom for additional
// pre-warm targets later.
const CITY_CLOCK_COUNT = 100;       // top N cities → /og/time-in-{slug}.png
const PAIR_ORIGIN_COUNT = 50;       // top N origins for pair OGs
const PAIR_DESTINATION_COUNT = 5;   // top M destinations per origin
// → ~100 city + ~245 pair = ~345 OG URLs prewarmed weekly

interface SlugRow {
  slug: string;
}

export const GET: APIRoute = async ({ request }) => {
  const provided = request.headers.get('x-cron-token') ?? '';
  const expected = env.CRON_TOKEN ?? '';
  if (!expected || provided !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = getDb();
  const result = await db
    .prepare('SELECT slug FROM cities ORDER BY prerender_priority DESC LIMIT ?1')
    .bind(Math.max(CITY_CLOCK_COUNT, PAIR_ORIGIN_COUNT))
    .all<SlugRow>();
  const slugs = (result.results ?? []).map((r) => r.slug);

  const ogSlugs: string[] = [];

  // Per-city clock cards.
  for (const slug of slugs.slice(0, CITY_CLOCK_COUNT)) {
    ogSlugs.push(`time-in-${slug}`);
  }

  // Pair cards — top N origins × top M destinations, skipping self-pairs.
  const origins = slugs.slice(0, PAIR_ORIGIN_COUNT);
  const destinations = slugs.slice(0, PAIR_DESTINATION_COUNT);
  for (const origin of origins) {
    for (const destination of destinations) {
      if (origin === destination) continue;
      ogSlugs.push(`${origin}-to-${destination}`);
    }
  }

  return new Response(
    JSON.stringify({ count: ogSlugs.length, slugs: ogSlugs }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    },
  );
};
