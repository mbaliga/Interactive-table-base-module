import { defaultConfig } from '@itable/input';
import { createBridge } from './server';

const arg = (n: string, d: number | string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1]! : d;
};
const l = defaultConfig.link;
const bridge = createBridge({
  udpHost: String(arg('udp-host', l.udpHost)), udpPort: Number(arg('udp-port', l.udpPort)),
  wsHost: String(arg('ws-host', l.wsHost)), wsPort: Number(arg('ws-port', l.wsPort)),
  staleMs: l.staleMs,
});
bridge.start().catch((e) => { console.error('bridge failed to start:', e.message); process.exit(1); });
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => bridge.stop().then(() => process.exit(0)));
