import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyEnvName } from './config';
import { createHub, HUB_VERSION, loadConfig, publicSummary } from './server';

const hubDir = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`interactive table hub ${HUB_VERSION}
usage: hub [--port 8080] [--host 0.0.0.0] [--udp-port 3333] [--phone-url URL] [--advertise-host HOST|IP] [--idle-seconds N]
           [--config FILE] [--data-dir DIR] [--web-root DIR] [--offline] [--print-config]
env:   HUB_PORT  HUB_HOST  HUB_PHONE_URL  HUB_ADVERTISE_HOST  HUB_IDLE_SECONDS  HUB_QR_NOTE  HUB_OFFLINE=1  TUIO_UDP_PORT  HUB_DATA_DIR
       HUB_KEY_<SOURCE> (or config/keys/<source>.txt): API key for a data proxy source, never stored in hub.config.json`);
  process.exit(0);
}

let cfg;
try { cfg = loadConfig({ argv, hubDir }); } catch (e) { console.error('Config error:', (e as Error).message); process.exit(2); }
if (argv.includes('--print-config')) { console.log(JSON.stringify({ ...publicSummary(cfg), udp: cfg.udp }, null, 2)); process.exit(0); }

// Tee console output to <dataDir>/logs/hub.log (rotated at 5 MB, one backup). Works the same under a service, where stdout goes nowhere.
{
  const dir = path.join(cfg.dataDir, 'logs'), file = path.join(dir, 'hub.log');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const write = (level: string, args: unknown[]) => {
      try {
        if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) fs.renameSync(file, file + '.1');
        fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
      } catch { /* logging must never take the hub down */ }
    };
    for (const [name, level] of [['log', 'INFO'], ['warn', 'WARN'], ['error', 'ERROR']] as const) {
      const orig = console[name].bind(console);
      console[name] = (...a: unknown[]) => { orig(...a); write(level, a); };
    }
  } catch { /* read-only install: console only */ }
}

const hub = createHub(cfg);
hub.start().then(({ port, udpPort }) => {
  const i = hub.info();
  console.log(`\n${cfg.app.name} hub ${HUB_VERSION} (app ${cfg.app.id} ${cfg.app.version})`);
  console.log(`  table      http://localhost:${port}/table/`);
  console.log(i.phonesCanReach ? `  phone      ${i.phoneUrl}   (QR code points here; source: ${i.phoneUrlSource})` : `  phone      ${i.phoneUrl}   (this computer only: the hub is not listening on a network address, so phones cannot connect and the table shows no QR code)`);
  if (i.alternatives.length > 1) console.log(`  other addresses: ${i.alternatives.slice(1).join('  ')}`);
  console.log(`  TUIO       udp ${udpPort} -> ws /tuio`);
  for (const [n, p] of Object.entries(cfg.proxies))
    console.log(`  proxy      /proxy/${n}/ -> ${p.base}   ${cfg.offline ? '(offline: cache only)' : !p.auth ? '(public, no key)' : p.key ? '(key configured, kept on the hub)' : `(NO KEY: set ${keyEnvName(n)} or config/keys/${n}.txt)`}`);
  if (cfg.offline) console.log('  offline    no upstream calls; proxies serve their cache only');
  console.log(`  data dir   ${cfg.dataDir}\n`);
}).catch((e: Error & { code?: string }) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${cfg.port} (or UDP ${cfg.udp.port}) is already in use. Is another hub running?` : `Hub failed to start: ${e.message}`);
  process.exit(1);
});
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) process.on(sig, () => { hub.stop().finally(() => process.exit(0)); });
