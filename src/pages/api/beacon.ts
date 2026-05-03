/// <reference types="@cloudflare/workers-types" />

// Pageview beacon endpoint (PLAN §7).
//
// Accepts a small JSON POST from the browser on every page load:
//   { path: "/time-in-tokyo", lang: "en", ref?: "google.com",
//     utm?: { s?, m?, c? } }
//
// Server-side enrichments:
//   - `country` from Cloudflare's CF-IPCountry header (region-anonymised).
//   - `visitor_hash` from SHA-256(ip + today's salt). The IP itself is never
//     stored or logged.
//
// Writes a single row to Workers Analytics Engine and returns 204 No Content.
// Failure is silent: the beacon must never block page rendering.

import type { APIRoute } from 'astro';
import {
  getDailySalt,
  hashIp,
  writePageview,
  refDomain,
  capString,
} from '../../lib/analytics';
import { getDb } from '../../lib/db';
import { isValidLocale, DEFAULT_LOCALE } from '../../lib/i18n';

export const prerender = false;

const NO_CONTENT = new Response(null, { status: 204 });

const PATH_LIMIT = 256;
const REF_LIMIT = 80;
const UTM_LIMIT = 80;
const LANG_LIMIT = 8;

interface BeaconBody {
  path?: unknown;
  lang?: unknown;
  ref?: unknown;
  utm?: { s?: unknown; m?: unknown; c?: unknown };
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // Reject anything that's not a browser-shaped POST.
  if (request.headers.get('content-type')?.toLowerCase().split(';')[0] !==
      'application/json') {
    return NO_CONTENT;
  }

  let body: BeaconBody;
  try {
    body = (await request.json()) as BeaconBody;
  } catch {
    return NO_CONTENT;
  }

  // Validate path. Only same-origin paths are accepted.
  const path = capString(typeof body.path === 'string' ? body.path : '', PATH_LIMIT);
  if (!path.startsWith('/')) return NO_CONTENT;

  const lang = capString(
    typeof body.lang === 'string' && isValidLocale(body.lang) ? body.lang : DEFAULT_LOCALE,
    LANG_LIMIT,
  );

  const referrer = capString(
    typeof body.ref === 'string' ? refDomain(body.ref) : '',
    REF_LIMIT,
  );

  const utm = (body.utm ?? {}) as { s?: unknown; m?: unknown; c?: unknown };
  const utmSource = capString(typeof utm.s === 'string' ? utm.s : '', UTM_LIMIT);
  const utmMedium = capString(typeof utm.m === 'string' ? utm.m : '', UTM_LIMIT);
  const utmCampaign = capString(typeof utm.c === 'string' ? utm.c : '', UTM_LIMIT);

  // Country: Cloudflare's CF-IPCountry header. Falls back to "XX" when absent
  // (e.g. local dev, Tor, anonymous proxies).
  const country = capString(request.headers.get('cf-ipcountry') ?? 'XX', 4);

  // Visitor hash. The IP comes from `clientAddress` (Cloudflare-resolved) or
  // CF-Connecting-IP — never persisted, only hashed against today's salt.
  const ip =
    request.headers.get('cf-connecting-ip') ??
    clientAddress ??
    '0.0.0.0';

  let visitorHash = '';
  try {
    const db = getDb();
    const salt = await getDailySalt(db);
    visitorHash = await hashIp(ip, salt);
  } catch {
    // Don't fail the beacon if D1 is briefly unavailable.
    visitorHash = '';
  }

  // Fire-and-forget AE write.
  writePageview({
    path,
    lang,
    country,
    referrer,
    utmSource,
    utmMedium,
    utmCampaign,
    visitorHash,
  });

  return NO_CONTENT;
};

// GET fallback: returning 204 keeps misconfigured probes quiet.
export const GET: APIRoute = () => NO_CONTENT;
