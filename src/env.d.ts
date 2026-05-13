/// <reference path="../.astro/types.d.ts" />
/// <reference types="@cloudflare/workers-types" />

// Augment `Cloudflare.Env` (declared by @cloudflare/workers-types) with our
// project bindings. Both `import { env } from 'cloudflare:workers'` and
// `Astro.locals.runtime.env` are typed against this same interface.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ANALYTICS: AnalyticsEngineDataset;
    OG_CACHE: KVNamespace;
    /**
     * Pre-computed next-DST-transition per IANA zone, written daily by the
     * workers/cron/ cron worker. Keys: `dst-next:{IANA zone}`, values:
     * JSON of either `{ at: ISO, forward: bool }` or `{ noDst: true }`.
     */
    DST_NEXT: KVNamespace;
    ENVIRONMENT: string;
    /** Cloudflare account ID — set as a public var in wrangler.toml. */
    CF_ACCOUNT_ID?: string;
    /** Cloudflare API token with Account Analytics scope — set via `wrangler secret put`. */
    CF_API_TOKEN?: string;
    /**
     * Shared secret with the cron worker. Set via `wrangler secret put CRON_TOKEN`
     * on BOTH the main worker (so the endpoint can verify) AND the cron worker
     * (so it can present the header).
     */
    CRON_TOKEN?: string;
  }
}

declare namespace App {
  interface Locals {
    runtime: import('@astrojs/cloudflare').Runtime<Cloudflare.Env>;
  }
}
