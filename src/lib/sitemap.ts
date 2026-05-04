// Shared constants for sitemap generation. Lives in lib/ rather than
// pages/ so both sitemap.xml.ts (the index) and the per-chunk pairs route
// can import without ambiguous .xml.ts module-resolution.

/**
 * Sitemap-spec hard cap is 50,000 URLs per file; we leave 1 entry of
 * headroom in case any chunk ever needs a sentinel/marker row.
 */
export const PAIRS_URL_LIMIT = 49_999;
