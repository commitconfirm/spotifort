import { defineConfig } from 'vite';

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
  },
});
