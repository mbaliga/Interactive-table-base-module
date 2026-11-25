import { describe, it, expect, vi } from 'vitest';
import { TuioWsSource, type InputEvent } from '../src';

class FakeWS {
  static all: FakeWS[] = [];
  onopen: any = null; onclose: any = null; onerror: any = null; onmessage: any = null;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() { this.onclose?.({}); }
  open() { this.onopen?.({}); }
  send(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
}
const o = (sid: number) => ({ sid, cid: 0, role: null, x: 0.5, y: 0.5, angle: 0 });

describe('TuioWsSource', () => {
  it('reconnects and reconciles snapshot without spurious del/add', () => {
    vi.useFakeTimers(); FakeWS.all = [];
    const src = new TuioWsSource({ url: 'ws://x', WebSocketImpl: FakeWS as any, reconnectMinMs: 100, downRemoveMs: 5000 });
    const ev: InputEvent[] = []; src.on((e) => ev.push(e));
    src.start();
    FakeWS.all[0]!.open();
    FakeWS.all[0]!.send({ type: 'snapshot', ts: 0, cursors: [], objects: [o(1), o(2)] });
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:add']);

    FakeWS.all[0]!.close(); // link drops
    vi.advanceTimersByTime(150);
    expect(FakeWS.all).toHaveLength(2);
    FakeWS.all[1]!.open();
    FakeWS.all[1]!.send({ type: 'snapshot', ts: 1, cursors: [], objects: [o(1), o(3)] }); // 2 gone, 3 new
    expect(ev.slice(2).map((e) => `${e.t}:${(e as any).o.sid}`).sort()).toEqual(['object:add:3', 'object:del:2', 'object:set:1']);
    src.stop(); vi.useRealTimers();
  });

  it('removes everything if the link stays down past downRemoveMs', () => {
    vi.useFakeTimers(); FakeWS.all = [];
    const src = new TuioWsSource({ url: 'ws://x', WebSocketImpl: FakeWS as any, reconnectMinMs: 100, reconnectMaxMs: 200, downRemoveMs: 1000 });
    const ev: InputEvent[] = []; src.on((e) => ev.push(e));
    src.start(); FakeWS.all[0]!.open();
    FakeWS.all[0]!.send({ type: 'event', ts: 0, e: { t: 'object:add', o: o(1) } });
    FakeWS.all[0]!.close();
    vi.advanceTimersByTime(1100);
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:del']);
    src.stop(); vi.useRealTimers();
  });

  it('ignores malformed messages', () => {
    FakeWS.all = [];
    const src = new TuioWsSource({ url: 'ws://x', WebSocketImpl: FakeWS as any });
    const ev: InputEvent[] = []; src.on((e) => ev.push(e));
    src.start(); FakeWS.all[0]!.open();
    FakeWS.all[0]!.onmessage({ data: '{not json' });
    expect(ev).toHaveLength(0); src.stop();
  });

  it('re-arms the down-too-long timer after a successful reconnect (second outage still clears pucks)', () => {
    vi.useFakeTimers(); FakeWS.all = [];
    const src = new TuioWsSource({ url: 'ws://x', WebSocketImpl: FakeWS as any, reconnectMinMs: 100, reconnectMaxMs: 100, downRemoveMs: 1000 });
    const ev: InputEvent[] = []; src.on((e) => ev.push(e));
    src.start(); FakeWS.all[0]!.open();
    FakeWS.all[0]!.send({ type: 'snapshot', ts: 0, cursors: [], objects: [o(1)] });
    FakeWS.all[0]!.close(); vi.advanceTimersByTime(150);          // short outage, reconnects
    FakeWS.all[1]!.open();
    FakeWS.all[1]!.send({ type: 'snapshot', ts: 1, cursors: [], objects: [o(1)] });
    FakeWS.all[1]!.close(); vi.advanceTimersByTime(30_000);       // long outage
    expect(ev.map((e) => e.t)).toContain('object:del');
    src.stop(); vi.useRealTimers();
  });

  it('a sid reused for a different cid is a removal plus an add, not a move', () => {
    FakeWS.all = [];
    const src = new TuioWsSource({ url: 'ws://x', WebSocketImpl: FakeWS as any });
    const ev: InputEvent[] = []; src.on((e) => ev.push(e));
    src.start(); FakeWS.all[0]!.open();
    FakeWS.all[0]!.send({ type: 'snapshot', ts: 0, cursors: [], objects: [{ ...o(1), cid: 0 }] });
    FakeWS.all[0]!.send({ type: 'snapshot', ts: 1, cursors: [], objects: [{ ...o(1), cid: 3 }] });
    expect(ev.slice(1).map((e) => `${e.t}:${(e as any).o.cid}`)).toEqual(['object:del:0', 'object:add:3']);
    src.stop();
  });
});
