import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/* MindSplit build.

   base: the app is served from dexcimino.com/mindsplit/, not the domain root, so
   every emitted asset URL has to carry that prefix or the bundle 404s the moment
   it leaves the dev server.

   outDir: the portfolio repo IS the deploy target, so the build writes straight
   into /mindsplit/ at the repo root rather than into a dist/ that then has to be
   copied by hand. emptyOutDir keeps stale hashed assets from piling up there.
   Source stays here in ai/apps/mindsplit/ — the same source-beside-build split
   games/stickland/ uses. */
export default defineConfig({
  base: '/mindsplit/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../../../mindsplit',
    emptyOutDir: true,
  },
});
