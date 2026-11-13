import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { copyFileSync } from 'fs';
import festival from './festival.config.js';

/**
 * Replace %FESTIVAL_*% tokens in every HTML entry (dev server and build).
 */
function festivalTokens() {
  const tokens = {
    '%FESTIVAL_YEAR%': String(festival.year),
    '%FESTIVAL_NAME%': festival.name,
    '%FESTIVAL_DATES%': festival.dates,
  };
  return {
    name: 'festival-tokens',
    transformIndexHtml(html) {
      return Object.entries(tokens).reduce(
        (out, [token, value]) => out.split(token).join(value),
        html
      );
    },
  };
}

/**
 * Cloudflare Pages serves /callback from callback.html. The Spotify login returns there, and it must be the app
 * page itself, so the build writes dist/callback.html as a copy of the built dist/index.html (same hashed assets)
 * instead of keeping a hand-made duplicate. The dev server needs nothing: Vite already serves index.html for
 * /callback (its HTML fallback).
 */
function callbackPage() {
  let outDir;
  return {
    name: 'callback-page',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, 'callback.html'));
    },
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  envDir: '..',
  publicDir: '../public',
  plugins: [festivalTokens(), callbackPage()],
  define: {
    __FESTIVAL_YEAR__: JSON.stringify(festival.year),
    __EXAMPLE_ARTISTS__: JSON.stringify(festival.exampleArtists ?? []),
  },
  server: {
    port: 9090,
    host: '127.0.0.1',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        lineup: resolve(__dirname, 'src/lineup.html'),
        setup: resolve(__dirname, 'src/setup.html'),
        why: resolve(__dirname, 'src/why.html'),
        notfound: resolve(__dirname, 'src/404.html'),
      },
    },
  },
});
