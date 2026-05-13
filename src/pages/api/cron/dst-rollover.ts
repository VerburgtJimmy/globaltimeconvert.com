/// <reference types="@cloudflare/workers-types" />

// Daily DST roll-over job — pre-computes the next DST transition for every
// IANA zone in the cities table and writes it to the DST_NEXT KV namespace.
// City pages then read from KV in O(1) instead of running the 420-day walk
// inside `nextDstTransition()` on every render.
//
// Triggered by the separate cron worker in `workers/cron/` which fires a
// Cron Trigger daily at 03:00 UTC and POSTs to this endpoint with an
// `x-cron-token` header matching the CRON_TOKEN secret.
//
// Safe to invoke manually for ad-hoc population. The `Origin` header is
// required because Astro's `security.checkOrigin` rejects cross-origin
// POSTs without it:
//   curl -X POST \
//     -H "x-cron-token: $CRON_TOKEN" \
//     -H "Origin: https://globaltimeconvert.com" \
//     https://globaltimeconvert.com/api/cron/dst-rollover

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getDb } from '../../../lib/db';
import { nextDstTransition } from '../../../lib/tz';

export const prerender = false;

// 14 days. Doubles as a safety net: even if the cron breaks, the data
// silently expires and city pages fall back to inline compute rather
// than serving stale transitions.
const KV_TTL_SECONDS = 60 * 60 * 24 * 14;

interface ZoneRow {
  timezone_id: string;
}

interface DstCacheEntry {
  /** ISO timestamp of the next transition. Omitted if zone has no DST. */
  at?: string;
  /** True if clocks move forward (spring-forward). */
  forward?: boolean;
  /** Marker for zones that don't observe DST. */
  noDst?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  // Auth — constant-time-ish compare. The token is a long random secret
  // so timing attacks aren't really practical here, but the equality check
  // is still kept simple.
  const provided = request.headers.get('x-cron-token') ?? '';
  const expected = env.CRON_TOKEN ?? '';
  if (!expected || provided !== expected) {
    return new Response('Unauthorized', { status: 401 });
  }

  const start = Date.now();
  const db = getDb();
  const result = await db
    .prepare('SELECT DISTINCT timezone_id FROM cities')
    .all<ZoneRow>();
  const zones = (result.results ?? []).map((r) => r.timezone_id).filter(Boolean);

  let written = 0;
  let dstZones = 0;
  const failures: string[] = [];

  for (const tz of zones) {
    let payload: DstCacheEntry;
    try {
      const transition = nextDstTransition(tz);
      if (transition) {
        payload = { at: transition.at.toISOString(), forward: transition.forward };
        dstZones += 1;
      } else {
        payload = { noDst: true };
      }
    } catch (err) {
      failures.push(`${tz}: compute — ${(err as Error).message}`);
      continue;
    }

    try {
      await env.DST_NEXT.put(`dst-next:${tz}`, JSON.stringify(payload), {
        expirationTtl: KV_TTL_SECONDS,
      });
      written += 1;
    } catch (err) {
      failures.push(`${tz}: kv put — ${(err as Error).message}`);
    }
  }

  const summary = {
    zones: zones.length,
    dstZones,
    noDstZones: zones.length - dstZones,
    written,
    failures: failures.length,
    failureSamples: failures.slice(0, 5),
    durationMs: Date.now() - start,
  };

  return new Response(JSON.stringify(summary, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
