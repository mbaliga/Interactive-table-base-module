import http from 'node:http';
import { TuioRelay, type RelayOptions, type RelayStats } from './relay';
import type { TuioDecoder } from './decoder';

export interface BridgeOptions extends RelayOptions { wsHost?: string; wsPort?: number }
export interface Bridge {
  start(): Promise<{ udpPort: number; wsPort: number }>;
  stop(): Promise<void>;
  decoder: TuioDecoder;
  stats(): RelayStats;
}

/** Standalone bridge: a TuioRelay with its own tiny HTTP server (`/health`, WebSocket on the same port). */
export function createBridge(opts: BridgeOptions = {}): Bridge {
  const relay = new TuioRelay(opts);
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...relay.stats(), ...relay.decoder.dropped }));
    } else { res.writeHead(404); res.end(); }
  });
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
  return {
    decoder: relay.decoder,
    stats: () => relay.stats(),
    async start() {
      const udpPort = await relay.start();
      const wsPort = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.wsPort ?? 8080, opts.wsHost ?? '0.0.0.0', () => resolve((server.address() as { port: number }).port));
      });
      (opts.log ?? ((m) => console.log(new Date().toISOString(), m)))(`ws + /health on ${opts.wsHost ?? '0.0.0.0'}:${wsPort}`);
      return { udpPort, wsPort };
    },
    async stop() {
      await relay.stop();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
