// Give this copy of the base its own identity, for a new table app:
//   pnpm new-app forts-table "Forts Table"
// Updates app.json (id, name), the page titles and the phone page heading. The id names the release folder and zip,
// the Windows scheduled tasks, the systemd unit, the firewall rule and the kiosk browser profile, so two table apps can share a PC.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const [id, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();
if (!id || !name || !/^[a-z][a-z0-9-]{1,40}$/.test(id)) {
  console.error('usage: pnpm new-app <id> "<Display Name>"\n  id: lowercase letters, digits and dashes, e.g. forts-table');
  process.exit(2);
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const edit = (rel, fn) => { const f = path.join(root, rel); const before = fs.readFileSync(f, 'utf8'); const after = fn(before); if (after !== before) { fs.writeFileSync(f, after); console.log('updated', rel); } };

const appFile = path.join(root, 'app.json');
const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
Object.assign(app, { id, name });
fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n'); console.log('updated app.json');
edit('apps/table/index.html', (s) => s.replace(/<title>[^<]*<\/title>/, `<title>${esc(name)}</title>`));
edit('apps/phone/index.html', (s) => s.replace(/<title>[^<]*<\/title>/, `<title>${esc(name)}</title>`).replace(/(<h1 id="name">)[^<]*(<\/h1>)/, `$1${esc(name)}$2`));
console.log(`\n${name} (${id}). Next: replace apps/table/src/demo with your scenes, set the objects in config/table.config.json, see docs/NEW-APP.md.`);
