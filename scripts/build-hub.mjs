// Bundle the hub (and the TUIO relay, OSC codec, QR generator, data proxy) into ONE file: dist/hub/hub.mjs.
// Only Node itself is needed on the table PC: no npm install, no native modules.
import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
await build({
  entryPoints: [path.join(root, 'packages/hub/src/cli.ts')],
  outfile: path.join(root, 'dist/hub/hub.mjs'),
  bundle: true, platform: 'node', target: 'node20', format: 'esm', sourcemap: false, minify: false, legalComments: 'none',
  // ws has optional native speed-ups; they are optional and absent is fine
  external: ['bufferutil', 'utf-8-validate'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
