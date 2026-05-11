/// <reference types="@cloudflare/workers-types" />

// OG image endpoint — `/og/{slug}.png`. One endpoint, six template branches.
//
// Pipeline:
//   element tree (lib/og.ts) → satori → SVG → @resvg/resvg-wasm → PNG.
//
// All assets (Inter TTF × 2, resvg WASM) live under public/ and are fetched
// from the same Worker origin at request time. Each binary is cached in
// module scope after the first fetch, so subsequent requests within the
// same Worker isolate skip the fetch entirely.
//
// Rendered PNGs are cached in Workers KV (binding OG_CACHE) for 7 days.

import type { APIRoute } from 'astro';
import { ImageResponse } from 'workers-og';
import { env } from 'cloudflare:workers';

import { getDb, getCityBySlug } from '../../lib/db';
import { parsePairSlug } from '../../lib/slugs';
import { parseTimePrefix } from '../../lib/time-slugs';
import {
  formatInZone,
  diffMin,
  describeDiff,
  momentForWallTime,
} from '../../lib/tz';
import {
  cityClockTemplate,
  genericTemplate,
  homeTemplate,
  pairTemplate,
  timeCityTemplate,
  timePairTemplate,
  OG,
} from '../../lib/og';

export const prerender = false;

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

// Inter TTF lives in public/fonts/. Module-scoped cache means one fetch per
// Worker isolate; subsequent requests skip the asset lookup.
//
// Prod path: env.ASSETS (the static-asset binding auto-injected by
// @astrojs/cloudflare) reads the file directly without an HTTP round-trip.
// A worker fetching its own zone URL via global fetch() goes through
// Cloudflare's edge plumbing which doesn't reliably serve the worker's own
// static assets — the same path served fine from the outside (curl returns
// 200) silently errors from inside the worker.
//
// Dev fallback: `astro dev` doesn't expose env.ASSETS, but Vite serves
// /public/ at the root of the dev server, so a plain fetch off request.url
// works there. We try the binding first and fall back transparently.
const FONT_REGULAR_PATH = '/fonts/Inter-Regular.ttf';
const FONT_SEMIBOLD_PATH = '/fonts/Inter-SemiBold.ttf';

let cachedRegular: ArrayBuffer | null = null;
let cachedSemibold: ArrayBuffer | null = null;

async function fetchAsset(path: string, requestUrl: string): Promise<Response> {
  const assets = (env as Cloudflare.Env & { ASSETS?: Fetcher }).ASSETS;
  if (assets) {
    // env.ASSETS.fetch only cares about pathname; host can be anything.
    return assets.fetch(new URL(path, 'https://assets.local'));
  }
  // astro dev: no binding, Vite serves /public/ at root.
  return fetch(new URL(path, requestUrl));
}

async function loadFonts(requestUrl: string) {
  if (!cachedRegular) {
    const r = await fetchAsset(FONT_REGULAR_PATH, requestUrl);
    if (!r.ok) {
      throw new Error(
        `Inter-Regular.ttf not found at ${FONT_REGULAR_PATH} (status ${r.status}). ` +
          `Place Inter Regular and SemiBold .ttf files under public/fonts/.`,
      );
    }
    cachedRegular = await r.arrayBuffer();
  }
  if (!cachedSemibold) {
    const r = await fetchAsset(FONT_SEMIBOLD_PATH, requestUrl);
    if (!r.ok) {
      throw new Error(
        `Inter-SemiBold.ttf not found at ${FONT_SEMIBOLD_PATH} (status ${r.status}).`,
      );
    }
    cachedSemibold = await r.arrayBuffer();
  }
  return [
    { name: 'Inter', data: cachedRegular, weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: cachedSemibold, weight: 600 as const, style: 'normal' as const },
  ];
}

export const GET: APIRoute = async ({ params, request }) => {
  const rawSlug = params.slug;
  if (!rawSlug || typeof rawSlug !== 'string') {
    return notFound();
  }
  const slug = rawSlug.replace(/\.png$/, '');

  // KV cache lookup.
  const kv = env.OG_CACHE;
  if (kv) {
    const cached = await kv.get(slug, 'arrayBuffer');
    if (cached) {
      return new Response(cached, {
        status: 200,
        headers: cacheHeaders('hit'),
      });
    }
  }

  // Cache miss — render the template.
  const element = await buildElement(slug);
  if (!element) return notFound();

  const fonts = await loadFonts(request.url);

  // workers-og bundles satori + resvg-wasm in a way that works under workerd
  // (Cloudflare's local + production runtime). It accepts the same React-shape
  // element trees we build in lib/og.ts.
  const imageResponse = new ImageResponse(element as never, {
    width: OG.width,
    height: OG.height,
    fonts: fonts as never,
  });
  const png = await imageResponse.arrayBuffer();

  // Fire-and-forget KV put.
  if (kv) {
    try {
      await kv.put(slug, png, { expirationTtl: CACHE_TTL_SECONDS });
    } catch {
      /* swallow — cache write failures shouldn't break the response */
    }
  }

  return new Response(png, { status: 200, headers: cacheHeaders('miss') });
};

function cacheHeaders(state: 'hit' | 'miss'): HeadersInit {
  return {
    'content-type': 'image/png',
    'cache-control':
      'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
    'x-og-cache': state,
  };
}

function notFound(): Response {
  return new Response('Not found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Slug → element dispatcher.
// ---------------------------------------------------------------------------
async function buildElement(slug: string): Promise<unknown> {
  if (slug === 'home') return homeTemplate();
  if (slug === 'about') {
    return genericTemplate({
      title: 'Built quiet on purpose.',
      subtitle: 'A clean, ad-free, cookie-free timezone tool.',
    });
  }
  if (slug === 'donate') {
    return genericTemplate({
      title: 'Help keep this thing free.',
      subtitle: 'A side project. One person. Out of pocket.',
    });
  }
  if (slug === 'privacy' || slug === 'terms') {
    return genericTemplate({
      title: slug === 'privacy' ? 'Privacy' : 'Terms',
      subtitle: 'globaltimeconvert.com',
    });
  }
  if (slug === '404' || slug === 'not-found') {
    return genericTemplate({
      title: "We couldn't find that page.",
      subtitle: 'Try the homepage.',
    });
  }

  const db = getDb();

  if (slug.startsWith('time-in-')) {
    const citySlug = slug.slice('time-in-'.length);
    const city = await getCityBySlug(db, citySlug, 'en');
    if (!city) return null;
    const now = new Date();
    const t = formatInZone(now, city.timezone_id);
    return cityClockTemplate({
      city,
      hour: t.hour,
      minute: t.minute,
      weekday: t.weekday,
      abbr: t.abbr,
    });
  }

  const tp = parseTimePrefix(slug);
  if (tp) {
    const pairSlugs = parsePairSlug(tp.rest);
    if (pairSlugs) {
      const [a, b] = await Promise.all([
        getCityBySlug(db, pairSlugs.from, 'en'),
        getCityBySlug(db, pairSlugs.to, 'en'),
      ]);
      if (!a || !b) return null;
      const moment = momentForWallTime(tp.time, a.timezone_id);
      const aFmt = formatInZone(moment, a.timezone_id);
      const bFmt = formatInZone(moment, b.timezone_id);
      return timePairTemplate({
        time: tp.time,
        a,
        b,
        bHour: bFmt.hour,
        bMinute: bFmt.minute,
        bDayShift: aFmt.weekday !== bFmt.weekday,
        lang: 'en',
      });
    }
    const city = await getCityBySlug(db, tp.rest, 'en');
    if (!city) return null;
    const moment = momentForWallTime(tp.time, city.timezone_id);
    const f = formatInZone(moment, city.timezone_id);
    return timeCityTemplate({
      time: tp.time,
      city,
      weekday: f.weekday,
      abbr: f.abbr,
      lang: 'en',
    });
  }

  const pairSlugs = parsePairSlug(slug);
  if (pairSlugs) {
    const [a, b] = await Promise.all([
      getCityBySlug(db, pairSlugs.from, 'en'),
      getCityBySlug(db, pairSlugs.to, 'en'),
    ]);
    if (!a || !b) return null;
    const now = new Date();
    const aTime = formatInZone(now, a.timezone_id);
    const bTime = formatInZone(now, b.timezone_id);
    const m = diffMin(a.timezone_id, b.timezone_id, now);
    const diff = describeDiff(m);
    return pairTemplate({
      a,
      b,
      aTime: `${pad(aTime.hour)}:${pad(aTime.minute)}`,
      bTime: `${pad(bTime.hour)}:${pad(bTime.minute)}`,
      diffPhrase: diff.same ? 'same timezone' : diff.phrase,
    });
  }

  return null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
