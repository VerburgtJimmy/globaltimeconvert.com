// JSON-LD builders. Emitted into <head> by components/seo/StructuredData.astro
// (which is wired into Meta.astro). Schemas referenced:
//   - Organization      — global, always emitted
//   - WebSite           — homepage only, with SearchAction for sitelinks searchbox
//   - BreadcrumbList    — every non-home page
//   - FAQPage           — pages with FAQ blocks (none in v1; reserved)

import { DEFAULT_LOCALE, SUPPORTED_LOCALES, pathFor, type Locale } from './i18n';

export interface BreadcrumbItem {
  name: string;
  /** Path relative to the site root, e.g. "/" or "/time-in-tokyo". */
  url: string;
}

export interface Alternate {
  hreflang: string;
  href: string;
}

const SITE_NAME = 'globaltimeconvert.com';

export function buildOrganization(site: URL | string): Record<string, unknown> {
  const base = new URL('/', site).toString();
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: base,
  };
}

export function buildWebSite(site: URL | string): Record<string, unknown> {
  const base = new URL('/', site).toString();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: base,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${base}?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function buildBreadcrumbList(
  items: BreadcrumbItem[],
  site: URL | string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: new URL(item.url, site).toString(),
    })),
  };
}

/**
 * Build hreflang alternates for a "neutral" path (without locale prefix).
 * Returns an entry per supported locale plus `x-default` pointing at English.
 *
 * Pages that don't exist in every locale (e.g. /privacy is EN-only) should
 * pass `localesAvailable` to limit the set.
 */
export function buildAlternates(
  neutralPath: string,
  site: URL | string,
  localesAvailable: readonly Locale[] = SUPPORTED_LOCALES,
): Alternate[] {
  const alts: Alternate[] = localesAvailable.map((locale) => ({
    hreflang: locale,
    href: new URL(pathFor(neutralPath, locale), site).toString(),
  }));
  alts.push({
    hreflang: 'x-default',
    href: new URL(pathFor(neutralPath, DEFAULT_LOCALE), site).toString(),
  });
  return alts;
}
