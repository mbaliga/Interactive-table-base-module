import fs from 'node:fs';
import path from 'node:path';
import { createBridge } from '@itable/bridge';
import { TuioSender } from './sender';
import { scenarios } from './scenarios';
import { record } from './record';

/**
 * Regenerate fixtures/*.jsonl by running each scenario through a real UDP -> bridge -> WS path.
 * Status messages are dropped (they carry live counters and make files non-deterministic).
 * Fixtures are SIMULATED, not a table recording; replace with a real capture on day one.
 */
export async function generateFixtures(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const jobs: Array<{ name: string; scenario: string; fseqStart?: number }> = [
    ...Object.keys(scenarios).map((n) => ({ name: n, scenario: n })),
    { name: 'fseq-wrap', scenario: 'place-rotate', fseqStart: 2 ** 31 - 20 },
  ];
  for (const j of jobs) {
    const bridge = createBridge({ udpHost: '127.0.0.1', udpPort: 0, wsHost: '127.0.0.1', wsPort: 0, rateLogMs: 0, log: () => {}, staleMs: 5000 });
    const { udpPort, wsPort } = await bridge.start();
    const file = path.join(dir, `${j.name}.jsonl`);
    const tmp = `${file}.raw`;
    const rec = record(`ws://127.0.0.1:${wsPort}`, tmp);
    await new Promise((r) => setTimeout(r, 150));
    const s = new TuioSender({ port: udpPort, fps: 30, fseqStart: j.fseqStart });
    s.start();
    await scenarios[j.scenario]!.run(s);
    await s.stop();
    await new Promise((r) => setTimeout(r, 100));
    await rec.stop();
    await bridge.stop();
    const lines = fs.readFileSync(tmp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const kept = lines.filter((l) => l.msg.type !== 'status');
    const t0 = kept[0]?.t ?? 0;
    fs.writeFileSync(file, kept.map((l) => JSON.stringify({ t: l.t - t0, msg: { ...l.msg, ts: l.t - t0 } })).join('\n') + '\n');
    fs.unlinkSync(tmp);
    console.log(`${j.name}: ${kept.length} messages`);
  }
}
