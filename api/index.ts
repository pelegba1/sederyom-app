// Vercel routes every request here (see vercel.json). The real work lives in
// the server workspace; this file only re-exports the built handler so the
// deployed bundle is the same tsup output the Docker image runs.
//
// The .cjs build, deliberately: this file is CommonJS (the repo root has no
// "type": "module") and Vercel's function runtime cannot require() an ES
// module, even though plain Node 22 can.
export { default } from '../server/dist/handler.cjs';
export const config = { maxDuration: 300 };
