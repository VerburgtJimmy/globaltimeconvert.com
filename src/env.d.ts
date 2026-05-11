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
     * Static asset fetcher — auto-injected by @astrojs/cloudflare. Lets the
     * worker read files from /public/ directly without an HTTP round-trip,
     * which is needed because a worker fetching its own zone URL goes
     * through edge plumbing that's unreliable for the worker's own assets.
     */
    ASSETS: Fetcher;
    ENVIRONMENT: string;
    /** Cloudflare account ID — set as a public var in wrangler.toml. */
    CF_ACCOUNT_ID?: string;
    /** Cloudflare API token with Account Analytics scope — set via `wrangler secret put`. */
    CF_API_TOKEN?: string;
  }
}

declare namespace App {
  interface Locals {
    runtime: import('@astrojs/cloudflare').Runtime<Cloudflare.Env>;
  }
}
