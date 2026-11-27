import { defaultConfig } from '@itable/input';
import { TuioSender } from './sender';
import { scenarios } from './scenarios';
import { record, serveReplay } from './record';
import { generateFixtures } from './fixtures';

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1]! : d; };
const l = defaultConfig.link;
const wsUrl = flag('ws', `ws://127.0.0.1:${l.wsPort}`)!;

async function main() {
  if (cmd === 'list' || !cmd) {
    console.log('usage:\n  sim run <scenario|all> [--port 3333] [--host 127.0.0.1] [--fseq-start N] [--loop]\n  sim record <file.jsonl> [--ws ws://127.0.0.1:8080] [--seconds N]\n  sim fixtures [dir]\n  sim replay <file.jsonl> [--port 8080] [--speed 1] [--loop]\n\nscenarios:');
    for (const [k, v] of Object.entries(scenarios)) console.log(`  ${k.padEnd(18)} ${v.about}`);
    return;
  }
  if (cmd === 'run') {
    const name = rest[0] ?? 'all';
    const names = name === 'all' ? Object.keys(scenarios) : [name];
    for (const n of names) if (!scenarios[n]) { console.error(`unknown scenario: ${n}`); process.exit(1); }
    const s = new TuioSender({ host: flag('host'), port: Number(flag('port', String(l.udpPort))),
      fseqStart: flag('fseq-start') ? Number(flag('fseq-start')) : undefined });
    s.start();
    do { for (const n of names) { console.log('scenario:', n); await scenarios[n]!.run(s); } } while (rest.includes('--loop'));
    await s.stop();
    return;
  }
  if (cmd === 'record') {
    const file = rest[0]; if (!file) { console.error('record needs a file'); process.exit(1); }
    const r = record(wsUrl, file);
    const secs = Number(flag('seconds', '0'));
    const done = async () => { console.log(`wrote ${await r.stop()} messages to ${file}`); process.exit(0); };
    process.on('SIGINT', done);
    if (secs) setTimeout(done, secs * 1000);
    console.log(`recording ${wsUrl} -> ${file} (Ctrl-C to stop)`);
    return;
  }
  if (cmd === 'fixtures') { await generateFixtures(rest[0] ?? 'fixtures'); return; }
  if (cmd === 'replay') {
    const file = rest[0]; if (!file) { console.error('replay needs a file'); process.exit(1); }
    const srv = await serveReplay(file, Number(flag('port', String(l.wsPort))), { speed: Number(flag('speed', '1')), loop: rest.includes('--loop') });
    console.log(`replay server on ws://127.0.0.1:${srv.port}; starts when a client connects`);
    return;
  }
  console.error(`unknown command: ${cmd}`); process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
