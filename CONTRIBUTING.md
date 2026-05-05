# Contributing

Thanks for your interest. The site is small and opinionated; this doc is here so contributions land cleanly.

## Before you open a PR

The site exists specifically as the minimal, modern, ad-free alternative to cluttered timezone incumbents. Contributions that work *with* that constraint land easily; contributions that work against it (more widgets, ad-style content density, animated graphics, embed CTAs) don't, even if they'd boost some metric.

The visual rules in short:

- Hairline borders, no shadows.
- Single accent color (`oklch(0.62 0.19 252)`).
- Tabular-nums on times.
- Generous whitespace.
- Motion under 120 ms; respects `prefers-reduced-motion`.
- Reuse existing components before adding new ones.

If you're not sure your idea fits, **open an issue first** describing what you want to do and a sketch of how it'd look. Cheaper than a rejected PR.

## What's in scope

- Bug fixes (UX, locale rendering, timezone math, SSR / edge issues).
- New cities (the dataset is GeoNames-driven; add disambiguation cases if you hit one).
- Translation improvements for `es`, `pt`, `de`, `nl`, `zh-CN`.
- Performance: trim bundle, reduce DB queries, improve cache hits.
- Accessibility (semantic HTML, ARIA, keyboard, contrast).

## What's not in scope (for now)

- Adding new tracking, telemetry, or third-party scripts.
- Account systems, login, or user-saved state.
- Embedded ads of any kind.
- Currency conversion, weather, holidays, or other adjacent verticals.

## Local development

See the [README](README.md#local-development).

Run the typecheck before pushing:

```bash
npx astro check
```

The build needs to pass:

```bash
npx astro build
```

Both of these run in CI on every PR.

## Translations

Locale files live in `src/content/i18n/{locale}.json`. The structure mirrors English (`en.json`) — find the missing key in the locale you're improving and translate it. The `t()` resolver falls back to English when a key is missing, so translations can ship incrementally.

Translation conventions:

- Match tone: calm, factual, no exclamation marks, no marketing voice.
- Keep `{var}` placeholders intact and in the right grammatical position.
- Prefer the locale's natural query phrasing over a literal English translation.

## Reporting a bug

Open a GitHub issue with: the URL you visited, what you expected, what you saw, and the browser/OS if relevant. A screenshot helps for visual bugs.

## Security issues

If you find something security-related (XSS, auth bypass, data leak), please email it directly rather than opening a public issue.
