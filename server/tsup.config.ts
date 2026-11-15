import { defineConfig } from 'tsup';

export default defineConfig({
  // index.ts is the long-lived server; handler.ts is the serverless export.
  entry: ['src/index.ts', 'src/handler.ts'],
  // ESM for the long-lived server, CJS for the Vercel entry. Vercel's function
  // runtime uses its own loader, which — unlike plain Node 22 — cannot
  // require() an ES module. Emitting CJS removes the mismatch rather than
  // working around it, and keeps the deployed artifact the same tsup output.
  format: ['esm', 'cjs'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Prisma's client is generated into node_modules and must stay external.
  // @vercel/functions is imported dynamically and only on Vercel; bundling it
  // would drag platform code into the Docker image that never runs there.
  external: ['@prisma/client', '.prisma/client', '@vercel/functions'],
  noExternal: ['@sederyom/shared'],
});
