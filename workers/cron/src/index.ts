/// <reference types="@cloudflare/workers-types" />

// Cron-only Worker. Runs two scheduled jobs:
//
//   "0 3 * * *"  daily  → DST roll-over (pre-computes next-transition
//                          per IANA zone into the DST_NEXT KV namespace)
//   "0 3 * * 0"  weekly → OG cache pre-warm (hits each /og/{slug}.png
//                          on the manifest so KV stays populated)
//
// All the actual work lives behind auth-protected endpoints on the main
// app. This Worker is intentionally tiny — adding new jobs is just one
// more entry in wrangler.toml's `[triggers].crons` plus one more trigger
// function below.

export interface Env {
  /** Shared secret with the main worker. Set via `wrangler secret put CRON_TOKEN`. */
  CRON_TOKEN: string;
}

const TARGET_ORIGIN = 'https://globaltimeconvert.com';

const CRON_DST_ROLLOVER = '0 3 * * *';
const CRON_OG_PREWARM = '0 3 * * SUN';

export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // waitUntil lets the scheduled invocation return immediately while
    // the HTTP work runs to completion in the background. Cloudflare
    // still bills CPU for it, but the trigger reports success fast.
    if (event.cron === CRON_OG_PREWARM) {
      ctx.waitUntil(triggerOgPrewarm(env));
    } else {
      // Default: treat any other cron expression (currently only the
      // daily DST rollover) as the DST job.
      ctx.waitUntil(triggerDstRollover(env));
    }
  },

  /**
   * Manual trigger surface for ad-hoc runs during development:
   *   curl -X POST .../run            → daily DST rollover
   *   curl -X POST .../run/og-prewarm → weekly OG prewarm
   */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST') {
      if (url.pathname === '/run' || url.pathname === '/run/dst-rollover') {
        ctx.waitUntil(triggerDstRollover(env));
        return new Response('dst-rollover triggered', { status: 202 });
      }
      if (url.pathname === '/run/og-prewarm') {
        ctx.waitUntil(triggerOgPrewarm(env));
        return new Response('og-prewarm triggered', { status: 202 });
      }
    }
    return new Response(
      'cron worker — scheduled jobs only.\n' +
        'POST /run                  → daily DST rollover\n' +
        'POST /run/og-prewarm       → weekly OG prewarm\n',
      { status: 200, headers: { 'content-type': 'text/plain' } },
    );
  },
};

async function triggerDstRollover(env: Env): Promise<void> {
  if (!env.CRON_TOKEN) {
    console.error('CRON_TOKEN not set on cron worker; cannot authenticate');
    return;
  }
  try {
    // Origin header is required because the Astro app has
    // security.checkOrigin enabled (default). Worker-to-worker fetches
    // don't add Origin by default, so we set it explicitly to match.
    const response = await fetch(`${TARGET_ORIGIN}/api/cron/dst-rollover`, {
      method: 'POST',
      headers: {
        'x-cron-token': env.CRON_TOKEN,
        Origin: TARGET_ORIGIN,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      console.error(`dst-rollover failed: ${response.status} ${body.slice(0, 500)}`);
      return;
    }
    console.log(`dst-rollover ok: ${body.slice(0, 500)}`);
  } catch (err) {
    console.error('dst-rollover threw:', (err as Error).message);
  }
}

async function triggerOgPrewarm(env: Env): Promise<void> {
  if (!env.CRON_TOKEN) {
    console.error('CRON_TOKEN not set on cron worker; cannot authenticate');
    return;
  }

  // Step 1 — fetch the manifest from the main app. Auth-protected with
  // the same shared secret as the rollover endpoint.
  let manifest: { count: number; slugs: string[] };
  try {
    const manifestRes = await fetch(
      `${TARGET_ORIGIN}/api/cron/og-prewarm-manifest`,
      {
        headers: { 'x-cron-token': env.CRON_TOKEN },
      },
    );
    if (!manifestRes.ok) {
      console.error(
        `og-prewarm manifest failed: ${manifestRes.status} ${(await manifestRes.text()).slice(0, 500)}`,
      );
      return;
    }
    manifest = (await manifestRes.json()) as typeof manifest;
  } catch (err) {
    console.error('og-prewarm manifest threw:', (err as Error).message);
    return;
  }

  console.log(`og-prewarm: warming ${manifest.count} OG urls`);

  // Step 2 — hit each /og/{slug}.png. The OG endpoint either returns
  // a cached PNG (cheap, idempotent) or renders fresh + writes to KV.
  // We don't care about the response body, just that the request
  // completes and populates the cache for next time.
  let warmed = 0;
  let alreadyCached = 0;
  let failed = 0;
  const failures: string[] = [];
  const start = Date.now();

  for (const slug of manifest.slugs) {
    try {
      const res = await fetch(`${TARGET_ORIGIN}/og/${slug}.png`);
      if (!res.ok) {
        failed += 1;
        if (failures.length < 5) failures.push(`${slug}: ${res.status}`);
        continue;
      }
      const state = res.headers.get('x-og-cache');
      if (state === 'hit') alreadyCached += 1;
      else warmed += 1;
    } catch (err) {
      failed += 1;
      if (failures.length < 5) failures.push(`${slug}: ${(err as Error).message}`);
    }
  }

  const durationMs = Date.now() - start;
  console.log(
    `og-prewarm done: warmed=${warmed} alreadyCached=${alreadyCached} ` +
      `failed=${failed} durationMs=${durationMs}` +
      (failures.length > 0 ? ` failureSamples=${failures.join('; ')}` : ''),
  );
}
