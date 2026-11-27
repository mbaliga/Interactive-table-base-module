import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Many API keys are 32-character hex strings (and the hub's key files hold real ones). None may appear in anything we commit or build.
const root = path.resolve(import.meta.dirname, '../..');
const SKIP = new Set(['node_modules', '.git', 'dist', 'release', 'data']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|html|css|md|txt|yml|yaml|ps1|cmd|sh|svg|example)$/i;
const KEYLIKE = /(?<![0-9A-Fa-f])[0-9a-f]{32}(?![0-9A-Fa-f])/;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (p === path.join(root, 'config', 'keys')) continue; // git-ignored: real keys live there on a configured machine
    if (e.isDirectory()) yield* walk(p); else if (TEXT.test(e.name)) yield p;
  }
}

describe('repository hygiene', () => {
  it('no key-shaped string in any tracked source, data, doc or fixture file', () => {
    const hits: string[] = [];
    for (const f of walk(root)) { if (fs.statSync(f).size > 5_000_000) continue; if (KEYLIKE.test(fs.readFileSync(f, 'utf8'))) hits.push(path.relative(root, f)); }
    expect(hits).toEqual([]);
  });
  it('config/keys/* and hub.config.json are git-ignored', () => {
    const ig = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    expect(ig).toMatch(/^config\/keys\/\*$/m); expect(ig).toMatch(/hub\.config\.json/);
  });
});
