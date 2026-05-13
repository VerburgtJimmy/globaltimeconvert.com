/// <reference types="@cloudflare/workers-types" />

// Cron-only Worker. Currently runs one daily job: hits the main app's
// /api/cron/dst-rollover endpoint so it pre-computes next-DST-transition
// per zone and writes to the DST_NEXT KV namespace.
//
// All the actual work lives in the main app (auth-protected endpoint).
// This Worker is intentionally tiny — adding new jobs is just one more
// `fetch()` per scheduled handler.

export interface Env {
  /** Shared secret with the main worker. Set via `wrangler secret put CRON_TOKEN`. */
  CRON_TOKEN: string;
}

const TARGET_ORIGIN = 'https://globaltimeconvert.com';

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // waitUntil lets the scheduled invocation return immediately while the
    // HTTP call runs to completion in the background.
    ctx.waitUntil(triggerDstRollover(env));
  },

  /**
   * Optional HTTP surface — useful for manual one-off triggers via
   * `curl https://globaltimeconvert-cron.<account>.workers.dev/run`
   * during development. The endpoint just kicks off the same job the
   * scheduled handler does.
   */
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/run' && req.method === 'POST') {
      ctx.waitUntil(triggerDstRollover(env));
      return new Response('Triggered', { status: 202 });
    }
    return new Response(
      'cron worker — scheduled jobs only. POST /run for manual trigger.',
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
    // The Origin header is required because the Astro app has
    // security.checkOrigin enabled (default). Worker-to-worker fetches
    // don't add Origin by default, so we set it explicitly to match the
    // target.
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
