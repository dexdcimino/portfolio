import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* Splitmob build.

   base: the app is served from dexcimino.com/splitmob/, not the domain root, so
   every emitted asset URL has to carry that prefix or the bundle 404s the moment
   it leaves the dev server.

   outDir: the portfolio repo IS the deploy target, so the build writes straight
   into /splitmob/ at the repo root rather than into a dist/ that then has to be
   copied by hand. emptyOutDir keeps stale hashed assets from piling up there.
   Source stays here in ai/apps/uvote/ — the same source-beside-build split
   games/stickland/ uses. */
export default defineConfig({
  base: '/splitmob/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../../splitmob',
    emptyOutDir: true,
  },
});
