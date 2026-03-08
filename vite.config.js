import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'src',
  envDir: '..',
  publicDir: '../public',
  server: {
    port: 9090,
    host: '127.0.0.1',
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        lineup: resolve(__dirname, 'src/lineup.html'),
        setup: resolve(__dirname, 'src/setup.html'),
        notfound: resolve(__dirname, 'src/404.html'),
      },
    },
  },
});
