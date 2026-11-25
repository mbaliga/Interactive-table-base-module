// Build everything and assemble a self-contained release folder (and zip) that runs on Windows and Linux with only Node 20.11+.
//   pnpm package          -> release/<app id>/  and  release/<app id>-<version>.zip      (id and version from app.json)
//   pnpm package --no-build   reuse dist/ as it is
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { zipSync } from 'fflate';

const root = path.resolve(import.meta.dirname, '..');
// pnpm is pnpm.cmd on Windows and needs a shell; node.exe must NOT go through cmd.exe, because "C:\\Program Files\\nodejs\\node.exe"
// is split at the space. So only pnpm gets the shell.
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'pnpm' });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${args.join(' ')}`); process.exit(r.status ?? 1); }
};
const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
if (!/^[a-z][a-z0-9-]{1,40}$/.test(app.id)) { console.error(`app.json: id "${app.id}" must be lowercase letters, digits and dashes`); process.exit(2); }

if (!process.argv.includes('--no-build')) {
  run('pnpm', ['--filter', '@itable/table', 'build']);
  run('pnpm', ['--filter', '@itable/phone', 'build']);
  run(process.execPath, ['scripts/build-hub.mjs']);
}

const out = path.join(root, 'release', app.id);
fs.rmSync(path.join(root, 'release'), { recursive: true, force: true });
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
cp('dist/table', 'table'); cp('dist/phone', 'phone'); cp('dist/hub', 'hub');
cp('scripts/windows', 'scripts/windows'); cp('scripts/linux', 'scripts/linux');
for (const f of ['kiosk.mjs', 'kiosk-lib.mjs', 'smoke.mjs']) cp(`scripts/${f}`, `scripts/${f}`);
cp('config/hub.config.example.json', 'config/hub.config.example.json'); cp('config/keys/README.txt', 'config/keys/README.txt');
cp('docs/DEPLOY.md', 'README.md');
fs.writeFileSync(path.join(out, 'app.json'), JSON.stringify({ id: app.id, name: app.name, version: app.version, builtAt: new Date().toISOString() }, null, 2) + '\n');
// the smoke test needs jsqr; ship it so `node scripts/smoke.mjs` works on site
const jsqrLink = path.join(root, 'node_modules/jsqr');
if (fs.existsSync(jsqrLink)) fs.cpSync(fs.realpathSync(jsqrLink), path.join(out, 'node_modules/jsqr'), { recursive: true, dereference: true }); // pnpm links packages

// zip (unix permissions kept for the .sh files)
const files = {};
const walk = (dir, rel = '') => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(p, r); else files[`${app.id}/` + r] = [new Uint8Array(fs.readFileSync(p)), { os: 3, attrs: ((r.endsWith('.sh') ? 0o100755 : 0o100644) << 16) >>> 0, mtime: new Date() }]; } };
walk(out);
const zip = path.join(root, 'release', `${app.id}-${app.version}.zip`);
fs.writeFileSync(zip, zipSync(files, { level: 6 }));
const size = (p) => (fs.statSync(p).size / 1048576).toFixed(1) + ' MB';
console.log(`\nrelease folder: ${path.relative(root, out)}\nzip: ${path.relative(root, zip)} (${size(zip)})`);
