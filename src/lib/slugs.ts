const SLUG_PART = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Split a `{from}-to-{to}` slug. Returns null if the shape is invalid. */
export function parsePairSlug(slug: string): { from: string; to: string } | null {
  // We split on the FIRST `-to-` occurrence. Cities with internal "to" tokens
  // (e.g. "kyoto") are fine because their slug has no separator hyphens
  // around the "to". For our 224 curated cities, no slug contains "-to-".
  const idx = slug.indexOf('-to-');
  if (idx <= 0) return null;
  const from = slug.slice(0, idx);
  const to = slug.slice(idx + '-to-'.length);
  if (!SLUG_PART.test(from) || !SLUG_PART.test(to)) return null;
  if (from === to) return null;
  return { from, to };
}

/** Build the canonical pair slug. */
export function buildPairSlug(from: string, to: string): string {
  return `${from}-to-${to}`;
}
