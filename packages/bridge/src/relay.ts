import dgram from 'node:dgram';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, WebSocket } from 'ws';
import type { InputEvent } from '@itable/input';
import { readPacket } from './osc';
import { TuioDecoder } from './decoder';

export interface RelayOptions {
  udpHost?: string; udpPort?: number;
  /** Remove objects if the table's UDP stream is silent this long. */
  staleMs?: number;
  /** Log message-rate every N ms (0 = off). */
  rateLogMs?: number;
  log?: (msg: string) => void;
}
export interface RelayStats { packets: number; events: number; clients: number; udp: 'listening' | 'down'; rate: number }

/**
 * TUIO over UDP -> JSON over WebSocket. Owns the UDP socket and the decoder; does NOT own an HTTP server, so the hub
 * can host it on its own port (`handleUpgrade`) and the standalone bridge can wrap it (see server.ts).
 */
export class TuioRelay {
  readonly decoder = new TuioDecoder();
  readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096 }); // clients never need to send us anything
  private udp?: dgram.Socket;
  private udpState: 'listening' | 'down' = 'down';
  private stopping = false;
  private rebind?: ReturnType<typeof setTimeout>;
  private timers: Array<ReturnType<typeof setInterval>> = [];
  private packets = 0; private events = 0; private lastPackets = 0; private rate = 0;
  private log: (m: string) => void;

  constructor(private opts: RelayOptions = {}) {
    this.log = opts.log ?? ((m) => console.log(new Date().toISOString(), m));
    this.wss.on('connection', (ws) => {
      const w = ws as WebSocket & { alive?: boolean };
      w.alive = true;
      ws.on('pong', () => (w.alive = true));
      ws.on('error', () => {});
      this.send(ws, { type: 'snapshot', ts: Date.now(), ...this.decoder.snapshot() });
      this.send(ws, this.status());
      this.log(`tuio client connected (${this.wss.clients.size})`);
    });
  }

  stats(): RelayStats { return { packets: this.packets, events: this.events, clients: this.wss.clients.size, udp: this.udpState, rate: this.rate }; }
  private status() { return { type: 'status', ts: Date.now(), udp: this.udpState, rate: this.rate, clients: this.wss.clients.size }; }
  private send(ws: WebSocket, m: object) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); }
  private broadcast(m: object) { for (const c of this.wss.clients) this.send(c, m); }
  private emit(evs: InputEvent[]) { for (const e of evs) { this.events++; this.broadcast({ type: 'event', ts: Date.now(), e }); } }

  /** Hand an HTTP upgrade request to the relay's WebSocket server. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
  }

  async start(): Promise<number> {
    this.stopping = false;
    const udpPort = await this.bindUdp();
    const every = (ms: number, fn: () => void) => { const t = setInterval(fn, ms); t.unref?.(); this.timers.push(t); };
    every(1000, () => { this.rate = this.packets - this.lastPackets; this.lastPackets = this.packets; });
    every(250, () => this.emit(this.decoder.expire(Date.now(), this.opts.staleMs ?? 2000)));
    every(1000, () => this.broadcast(this.status()));
    every(10_000, () => {
      for (const c of this.wss.clients) {
        const w = c as WebSocket & { alive?: boolean };
        if (w.alive === false) { c.terminate(); continue; }
        w.alive = false; c.ping();
      }
    });
    if (this.opts.rateLogMs !== 0) {
      const ms = this.opts.rateLogMs ?? 5000; let prev = 0;
      every(ms, () => { this.log(`rate ${(((this.packets - prev) * 1000) / ms).toFixed(0)} pkt/s, ${this.events} events total, ${this.wss.clients.size} client(s), udp ${this.udpState}`); prev = this.packets; });
    }
    return udpPort;
  }

  private bindUdp(): Promise<number> {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.udp = s;
      let settled = false;
      s.on('message', (buf) => {
        this.packets++;
        try { this.emit(this.decoder.decode(readPacket(buf), Date.now())); }
        catch (err) { this.log(`bad OSC packet: ${(err as Error).message}`); }
      });
      s.on('error', (err) => {
        this.log(`udp error: ${err.message}`);
        this.udpState = 'down';
        try { s.close(); } catch { /* already closed */ }
        if (!settled) { settled = true; reject(err); } else this.scheduleRebind();
      });
      s.bind(this.opts.udpPort ?? 3333, this.opts.udpHost ?? '0.0.0.0', () => {
        settled = true; this.udpState = 'listening';
        const port = s.address().port;
        this.log(`udp listening on ${this.opts.udpHost ?? '0.0.0.0'}:${port}`);
        resolve(port);
      });
    });
  }
  private scheduleRebind() {
    if (this.stopping) return;
    clearTimeout(this.rebind);
    this.rebind = setTimeout(() => this.bindUdp().catch(() => this.scheduleRebind()), 1000);
  }

  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.rebind);
    this.timers.splice(0).forEach(clearInterval);
    for (const c of this.wss.clients) c.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => { try { this.udp?.close(() => r()); } catch { r(); } });
    this.udpState = 'down';
  }
}
