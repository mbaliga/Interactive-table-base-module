import type { Cursor, InputEvent, InputSource, TableObject } from './types';

/** Wire format produced by @itable/bridge. */
export type BridgeMessage =
  | { type: 'event'; ts: number; e: InputEvent }
  | { type: 'snapshot'; ts: number; cursors: Cursor[]; objects: TableObject[] }
  | { type: 'status'; ts: number; udp: 'listening' | 'down'; rate: number; clients: number };

export type LinkState = 'connecting' | 'open' | 'closed';

interface WsLike {
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  close(): void;
}
export interface TuioWsOptions {
  url: string;
  /** Injectable for tests / Node. Defaults to the global WebSocket. */
  WebSocketImpl?: new (url: string) => WsLike;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  /** If the link stays down this long, synthesise removals so nothing is stranded on screen. */
  downRemoveMs?: number;
}

/**
 * Receives bridge messages. Reconnects with backoff. On every (re)connect the bridge sends a
 * snapshot; the source reconciles against what it last told the app, so a short outage causes
 * no spurious del/add pair.
 */
export class TuioWsSource implements InputSource {
  private listeners = new Set<(e: InputEvent) => void>();
  private stateListeners = new Set<(s: LinkState) => void>();
  private statusListeners = new Set<(m: Extract<BridgeMessage, { type: 'status' }>) => void>();
  private ws?: WsLike;
  private running = false;
  private attempt = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private downTimer?: ReturnType<typeof setTimeout>;
  private objs = new Map<number, TableObject>();
  private curs = new Map<number, Cursor>();
  state: LinkState = 'closed';

  constructor(private o: TuioWsOptions) {}

  on(fn: (e: InputEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onState(fn: (s: LinkState) => void) { this.stateListeners.add(fn); return () => this.stateListeners.delete(fn); }
  onStatus(fn: (m: Extract<BridgeMessage, { type: 'status' }>) => void) { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn); }

  start() { if (this.running) return; this.running = true; this.connect(); }
  stop() {
    this.running = false;
    clearTimeout(this.retry); clearTimeout(this.downTimer); this.downTimer = undefined;
    this.ws?.close(); this.setState('closed');
  }

  private setState(s: LinkState) { this.state = s; for (const l of this.stateListeners) l(s); }
  private emit(e: InputEvent) { for (const l of this.listeners) l(e); }

  private connect() {
    if (!this.running) return;
    this.setState('connecting');
    const Impl = this.o.WebSocketImpl ?? (globalThis as unknown as { WebSocket: new (u: string) => WsLike }).WebSocket;
    const ws = new Impl(this.o.url);
    this.ws = ws;
    ws.onopen = () => { this.attempt = 0; clearTimeout(this.downTimer); this.downTimer = undefined; /* so the next outage re-arms it */ this.setState('open'); };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => { /* close follows */ };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.setState('closed');
      if (!this.running) return;
      this.downTimer ??= setTimeout(() => this.clearAll(), this.o.downRemoveMs ?? 5000);
      const min = this.o.reconnectMinMs ?? 250, max = this.o.reconnectMaxMs ?? 4000;
      const delay = Math.min(max, min * 2 ** this.attempt++);
      this.retry = setTimeout(() => this.connect(), delay);
    };
  }

  private handle(data: unknown) {
    let m: BridgeMessage;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'event') this.apply(m.e);
    else if (m.type === 'snapshot') this.reconcile(m);
    else if (m.type === 'status') for (const l of this.statusListeners) l(m);
  }

  private apply(e: InputEvent) {
    if ('o' in e) { if (e.t === 'object:del') this.objs.delete(e.o.sid); else this.objs.set(e.o.sid, e.o); }
    else { if (e.t === 'cursor:del') this.curs.delete(e.c.sid); else this.curs.set(e.c.sid, e.c); }
    this.emit(e);
  }

  private reconcile(s: Extract<BridgeMessage, { type: 'snapshot' }>) {
    const oSids = new Set(s.objects.map((o) => o.sid));
    const cSids = new Set(s.cursors.map((c) => c.sid));
    for (const o of [...this.objs.values()]) if (!oSids.has(o.sid)) this.apply({ t: 'object:del', o });
    for (const c of [...this.curs.values()]) if (!cSids.has(c.sid)) this.apply({ t: 'cursor:del', c });
    for (const o of s.objects) {
      const prev = this.objs.get(o.sid);
      if (prev && prev.cid !== o.cid) this.apply({ t: 'object:del', o: prev }); // the table reused this session id for a different object
      this.apply({ t: this.objs.has(o.sid) ? 'object:set' : 'object:add', o });
    }
    for (const c of s.cursors) this.apply({ t: this.curs.has(c.sid) ? 'cursor:set' : 'cursor:add', c });
  }

  private clearAll() {
    this.downTimer = undefined;
    for (const o of [...this.objs.values()]) this.apply({ t: 'object:del', o });
    for (const c of [...this.curs.values()]) this.apply({ t: 'cursor:del', c });
  }
}
