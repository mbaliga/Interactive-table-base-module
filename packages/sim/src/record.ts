import fs from 'node:fs';
import WebSocket from 'ws';
import { loadJsonl, type RecLine } from './jsonl';

/** Record a bridge WebSocket stream to JSONL: one {t: msSinceStart, msg} per line. */
export function record(url: string, file: string): { stop(): Promise<number> } {
  const out = fs.createWriteStream(file);
  const t0 = Date.now();
  let n = 0;
  const ws = new WebSocket(url);
  ws.on('message', (d) => {
    let msg: unknown;
    try { msg = JSON.parse(d.toString()); } catch { return; }
    out.write(JSON.stringify({ t: Date.now() - t0, msg }) + '\n'); n++;
  });
  ws.on('error', (e) => console.error('record: ws error', e.message));
  return {
    stop: () => new Promise((resolve) => {
      ws.close();
      out.end(() => resolve(n));
    }),
  };
}

/** Play lines to `send` with original timing (scaled by `speed`). Resolves when done or aborted. */
export async function play(lines: RecLine[], send: (msg: unknown) => void, opt: { speed?: number; signal?: AbortSignal } = {}) {
  const speed = opt.speed ?? 1;
  const t0 = Date.now();
  for (const l of lines) {
    const wait = l.t / speed - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (opt.signal?.aborted) return;
    send(l.msg);
  }
}

/** Serve a recording as a stand-in bridge: starts when the first client connects. */
export async function serveReplay(file: string, port: number, opt: { speed?: number; loop?: boolean } = {}) {
  const { WebSocketServer } = await import('ws');
  const lines = loadJsonl(file);
  const wss = new WebSocketServer({ port });
  const ac = new AbortController();
  let running = false;
  wss.on('connection', () => {
    if (running) return;
    running = true;
    void (async () => {
      do {
        await play(lines, (m) => { for (const c of wss.clients) c.send(JSON.stringify(m)); }, { ...opt, signal: ac.signal });
      } while (opt.loop && !ac.signal.aborted);
      running = false;
    })();
  });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  return {
    port: (wss.address() as { port: number }).port,
    stop: () => new Promise<void>((r) => { ac.abort(); for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
  };
}
