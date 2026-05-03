// OG image templates (Phase 7).
//
// Each template builds a satori-compatible element tree (1200×630). We use a
// tiny `h()` helper to avoid pulling React in just for createElement — satori
// accepts plain `{ type, key, props }` objects directly.
//
// Strict DESIGN compliance:
//   - Inter (loaded as TTF in the og endpoint)
//   - Accent #4f46e5-ish via oklch(0.62 0.19 252) — converted to RGB for satori
//   - Hairline border (#e5e5e5 ~ neutral-200/60)
//   - Tabular-nums on time numbers (font-feature-settings)
//   - No drop shadows, no gradients

import type { CityWithCountry } from './db';
import type { TimeOfDay } from './time-slugs';
import { displayTime } from './time-slugs';
import { formatInZone, momentForWallTime } from './tz';

// satori needs a serialisable object, not a React node — but the shape is the
// same (`{ type, key, props }`). The `as any` in the return cast keeps the
// public API simple; satori treats unknown extra fields as harmless.
interface OgElement {
  type: string;
  key: null;
  props: Record<string, unknown>;
}

export function h(
  type: string,
  props: Record<string, unknown> | null = null,
  ...children: unknown[]
): OgElement {
  const flat = children
    .flat()
    .filter((c) => c !== null && c !== undefined && c !== false);
  const allProps = { ...(props ?? {}) };
  if (flat.length === 1) allProps.children = flat[0];
  else if (flat.length > 1) allProps.children = flat;
  return { type, key: null, props: allProps };
}

// ---------------------------------------------------------------------------
// Design tokens (mirrors src/styles/global.css §3 colors).
// satori uses CSS values; we duplicate as constants for inline-style use.
// ---------------------------------------------------------------------------
export const OG = {
  width: 1200,
  height: 630,

  bg: '#ffffff',
  fg: '#171717',
  fgSubtle: '#525252',
  fgMuted: '#737373',
  hair: 'rgba(229, 229, 229, 0.6)',
  hairSolid: '#e5e5e5',

  accent: 'oklch(0.62 0.19 252)',
  accentFallback: '#4f46e5', // sRGB fallback in case satori chokes on oklch

  fontSans: 'Inter',
  fontMono: 'ui-monospace, "SF Mono", Menlo',

  trackingDisplay: '-0.022em',
} as const;

// Brand mark — small clock SVG + wordmark.
function brandMark() {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        color: OG.fg,
        fontSize: 22,
        fontWeight: 500,
        letterSpacing: '-0.01em',
      },
    },
    h(
      'svg',
      {
        width: 24,
        height: 24,
        viewBox: '0 0 24 24',
        fill: 'none',
      },
      h('circle', { cx: 12, cy: 12, r: 9.25, stroke: OG.fg, 'stroke-width': 1.5 }),
      h('path', {
        d: 'M12 7v5l3.2 2',
        stroke: OG.accentFallback,
        'stroke-width': 1.75,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      }),
    ),
    h('span', null, 'globaltimeconvert'),
  );
}

// Footer rule — thin hairline + privacy tagline. Anchors the brand voice.
function footerLine() {
  return h(
    'div',
    {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 18,
        color: OG.fgMuted,
      },
    },
    h('span', null, 'No ads · No cookies · No trackers'),
    h(
      'span',
      { style: { fontFamily: OG.fontMono, fontSize: 16 } },
      'globaltimeconvert.com',
    ),
  );
}

function frame(...children: unknown[]) {
  return h(
    'div',
    {
      style: {
        width: OG.width,
        height: OG.height,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: OG.bg,
        color: OG.fg,
        fontFamily: OG.fontSans,
        padding: '64px 72px',
        // Hairline border, 1px inset all around.
        boxSizing: 'border-box',
        borderTop: `1px solid ${OG.hairSolid}`,
        borderBottom: `1px solid ${OG.hairSolid}`,
      },
    },
    brandMark(),
    h(
      'div',
      {
        style: {
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        },
      },
      ...children,
    ),
    footerLine(),
  );
}

// ---------------------------------------------------------------------------
// Templates — one per page type.
// ---------------------------------------------------------------------------

export function homeTemplate(): OgElement {
  return frame(
    h(
      'div',
      {
        style: {
          fontSize: 96,
          fontWeight: 600,
          letterSpacing: OG.trackingDisplay,
          lineHeight: 1.05,
        },
      },
      'What time is it,',
    ),
    h(
      'div',
      {
        style: {
          fontSize: 96,
          fontWeight: 600,
          letterSpacing: OG.trackingDisplay,
          lineHeight: 1.05,
        },
      },
      'anywhere?',
    ),
    h(
      'div',
      {
        style: {
          marginTop: 32,
          fontSize: 28,
          color: OG.fgSubtle,
          lineHeight: 1.4,
        },
      },
      'Search any city. Compare timezones. Schedule across continents.',
    ),
  );
}

export function cityClockTemplate(args: {
  city: CityWithCountry;
  hour: number;
  minute: number;
  weekday: string;
  abbr: string;
}): OgElement {
  const timeStr = `${String(args.hour).padStart(2, '0')}:${String(args.minute).padStart(2, '0')}`;
  return frame(
    h(
      'div',
      {
        style: { fontSize: 32, color: OG.fgSubtle, marginBottom: 12 },
      },
      `Time in ${args.city.display_name}, ${args.city.country_name}`,
    ),
    h(
      'div',
      {
        style: {
          fontSize: 220,
          fontWeight: 600,
          letterSpacing: OG.trackingDisplay,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        },
      },
      timeStr,
    ),
    h(
      'div',
      {
        style: {
          marginTop: 20,
          fontSize: 28,
          color: OG.fgSubtle,
          display: 'flex',
          gap: 18,
        },
      },
      h('span', null, args.weekday),
      h('span', { style: { color: OG.hairSolid } }, '·'),
      h(
        'span',
        { style: { fontFamily: OG.fontMono, fontSize: 26 } },
        args.abbr,
      ),
      h('span', { style: { color: OG.hairSolid } }, '·'),
      h(
        'span',
        { style: { fontFamily: OG.fontMono, fontSize: 26 } },
        args.city.timezone_id,
      ),
    ),
  );
}

export function pairTemplate(args: {
  a: CityWithCountry;
  b: CityWithCountry;
  aTime: string;
  bTime: string;
  diffPhrase: string;
}): OgElement {
  const sideStyle = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  };
  const cityName = {
    fontSize: 38,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: OG.fg,
  };
  const country = {
    fontSize: 22,
    color: OG.fgMuted,
    marginTop: 4,
  };
  const time = {
    fontSize: 140,
    fontWeight: 600,
    letterSpacing: OG.trackingDisplay,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    marginTop: 32,
  };

  return frame(
    h(
      'div',
      {
        style: { fontSize: 28, color: OG.fgSubtle, marginBottom: 8 },
      },
      args.diffPhrase,
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 64,
        },
      },
      h(
        'div',
        { style: sideStyle },
        h('div', { style: cityName }, args.a.display_name),
        h('div', { style: country }, args.a.country_name),
        h('div', { style: time }, args.aTime),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            paddingTop: 90,
            fontSize: 56,
            color: OG.fgMuted,
          },
        },
        '↔',
      ),
      h(
        'div',
        { style: { ...sideStyle, alignItems: 'flex-end' } },
        h('div', { style: cityName }, args.b.display_name),
        h('div', { style: country }, args.b.country_name),
        h('div', { style: time }, args.bTime),
      ),
    ),
  );
}

export function timeCityTemplate(args: {
  time: TimeOfDay;
  city: CityWithCountry;
  weekday: string;
  abbr: string;
  lang: 'en' | 'es' | 'pt' | 'de' | 'nl' | 'zh-CN';
}): OgElement {
  const timeLabel = displayTime(args.time, args.lang);
  const big = `${String(args.time.hour).padStart(2, '0')}:${String(args.time.minute).padStart(2, '0')}`;

  return frame(
    h(
      'div',
      { style: { fontSize: 32, color: OG.fgSubtle, marginBottom: 16 } },
      `${timeLabel} in ${args.city.display_name}`,
    ),
    h(
      'div',
      {
        style: {
          fontSize: 220,
          fontWeight: 600,
          letterSpacing: OG.trackingDisplay,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        },
      },
      big,
    ),
    h(
      'div',
      {
        style: {
          marginTop: 20,
          fontSize: 28,
          color: OG.fgSubtle,
          display: 'flex',
          gap: 18,
        },
      },
      h('span', null, args.weekday),
      h('span', { style: { color: OG.hairSolid } }, '·'),
      h('span', { style: { fontFamily: OG.fontMono, fontSize: 26 } }, args.abbr),
    ),
  );
}

export function timePairTemplate(args: {
  time: TimeOfDay;
  a: CityWithCountry;
  b: CityWithCountry;
  bHour: number;
  bMinute: number;
  bDayShift: boolean;
  lang: 'en' | 'es' | 'pt' | 'de' | 'nl' | 'zh-CN';
}): OgElement {
  const aLabel = displayTime(args.time, args.lang);
  const bLabel = displayTime({ hour: args.bHour, minute: args.bMinute }, args.lang);
  const sideStyle = { flex: 1, display: 'flex', flexDirection: 'column' };
  const cityName = {
    fontSize: 36,
    fontWeight: 600,
    letterSpacing: '-0.01em',
  };
  const country = { fontSize: 22, color: OG.fgMuted, marginTop: 4 };
  const time = {
    fontSize: 120,
    fontWeight: 600,
    letterSpacing: OG.trackingDisplay,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    marginTop: 28,
  };

  return frame(
    h(
      'div',
      { style: { fontSize: 28, color: OG.fgSubtle, marginBottom: 8 } },
      args.bDayShift ? 'crosses midnight' : 'same day',
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 56,
        },
      },
      h(
        'div',
        { style: sideStyle },
        h('div', { style: cityName }, args.a.display_name),
        h('div', { style: country }, args.a.country_name),
        h('div', { style: time }, aLabel),
      ),
      h(
        'div',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            paddingTop: 84,
            fontSize: 48,
            color: OG.fgMuted,
          },
        },
        '=',
      ),
      h(
        'div',
        { style: { ...sideStyle, alignItems: 'flex-end' } },
        h('div', { style: cityName }, args.b.display_name),
        h('div', { style: country }, args.b.country_name),
        h(
          'div',
          { style: { ...time, color: args.bDayShift ? OG.accentFallback : OG.fg } },
          bLabel,
        ),
      ),
    ),
  );
}

export function genericTemplate(args: { title: string; subtitle?: string }): OgElement {
  return frame(
    h(
      'div',
      {
        style: {
          fontSize: 88,
          fontWeight: 600,
          letterSpacing: OG.trackingDisplay,
          lineHeight: 1.05,
        },
      },
      args.title,
    ),
    args.subtitle
      ? h(
          'div',
          {
            style: { marginTop: 28, fontSize: 28, color: OG.fgSubtle, lineHeight: 1.4 },
          },
          args.subtitle,
        )
      : null,
  );
}

// Re-export helpers used by the endpoint
export { formatInZone, momentForWallTime };
