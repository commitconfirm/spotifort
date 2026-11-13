import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
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

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src',
  envDir: '..',
  publicDir: '../public',
  plugins: [festivalTokens()],
  define: {
    __FESTIVAL_YEAR__: JSON.stringify(festival.year),
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
        callback: resolve(__dirname, 'src/callback.html'),
        lineup: resolve(__dirname, 'src/lineup.html'),
        setup: resolve(__dirname, 'src/setup.html'),
        why: resolve(__dirname, 'src/why.html'),
        notfound: resolve(__dirname, 'src/404.html'),
      },
    },
  },
});
