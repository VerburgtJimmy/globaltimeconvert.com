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
