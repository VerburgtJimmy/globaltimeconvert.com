// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://globaltimeconvert.com',
  output: 'server',
  adapter: cloudflare({
    imageService: 'cloudflare',
  }),
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    // Inline the full stylesheet into each HTML response. Default 'auto'
    // only inlines CSS under 4 KB; ours is ~30 KB. With external CSS, on
    // hard reload the browser was sometimes painting with browser defaults
    // (purple visited links, unstyled nav) before the stylesheet arrived,
    // because the <link rel="stylesheet"> sits after the ClientRouter
    // module script in head order. Inlining trades ~6–8 KB gzipped per
    // HTML response for zero FOUC.
    inlineStylesheets: 'always',
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es', 'pt', 'de', 'nl', 'zh-CN'],
    routing: {
      prefixDefaultLocale: false, // English at root, others under /<lang>/
    },
  },
});
