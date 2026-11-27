import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { createBridge, type Bridge } from '@itable/bridge';
import { TuioSender, scenarios } from '../src';

let bridge: Bridge | undefined;
afterEach(async () => { await bridge?.stop(); bridge = undefined; });

async function setup() {
  bridge = createBridge({ udpHost: '127.0.0.1', udpPort: 0, wsHost: '127.0.0.1', wsPort: 0, rateLogMs: 0, log: () => {}, staleMs: 800 });
  const ports = await bridge.start();
  return ports;
}
function collect(wsPort: number) {
  const msgs: any[] = [];
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
  ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
  const ready = new Promise<void>((r) => ws.on('open', () => r()));
  return { msgs, ws, ready, events: () => msgs.filter((m) => m.type === 'event').map((m) => m.e) };
}

describe('simulator -> UDP -> bridge -> WebSocket', () => {
  it('place-rotate: add, continuous angle through the seam, del', async () => {
    const { udpPort, wsPort } = await setup();
    const c = collect(wsPort); await c.ready;
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start();
    await scenarios['place-rotate']!.run(s); await s.stop();
    const ev = c.events().filter((e) => 'o' in e);
    expect(ev[0].t).toBe('object:add');
    expect(ev[0].o.cid).toBe(0);
    expect(ev.at(-1).t).toBe('object:del');
    expect(ev.filter((e) => e.t === 'object:add')).toHaveLength(1);
    expect(ev.filter((e) => e.t === 'object:del')).toHaveLength(1);
    const angles = ev.filter((e) => e.t === 'object:set').map((e) => e.o.angle as number);
    expect(angles.every((a) => a >= 0 && a < Math.PI * 2)).toBe(true);
    c.ws.close();
  });

  it('six-objects: six adds then six dels, one per cid', async () => {
    const { udpPort, wsPort } = await setup();
    const c = collect(wsPort); await c.ready;
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start();
    await scenarios['six-objects']!.run(s); await s.stop();
    const ev = c.events();
    expect(ev.filter((e) => e.t === 'object:add').map((e) => e.o.cid).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ev.filter((e) => e.t === 'object:del')).toHaveLength(6);
    c.ws.close();
  });

  it('late-joining client gets a snapshot of what is on the table', async () => {
    const { udpPort, wsPort } = await setup();
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start();
    s.putObject(1, 3, 0.4, 0.4, 1); s.putCursor(2, 0.1, 0.1);
    await s.wait(200);
    const c = collect(wsPort); await c.ready; await s.wait(100);
    const snap = c.msgs.find((m) => m.type === 'snapshot');
    expect(snap.objects).toHaveLength(1); expect(snap.cursors).toHaveLength(1);
    await s.stop(); c.ws.close();
  });

  it('fseq wraparound does not drop frames', async () => {
    const { udpPort, wsPort } = await setup();
    const c = collect(wsPort); await c.ready;
    const s = new TuioSender({ port: udpPort, fps: 60, fseqStart: 2 ** 31 - 5 }); s.start();
    s.putObject(1, 2, 0.5, 0.5, 0); await s.wait(300);
    s.putObject(1, 2, 0.9, 0.5, 0); await s.wait(300);
    await s.stop();
    expect(bridge!.decoder.dropped.oldFrames).toBe(0);
    expect(c.events().some((e) => e.t === 'object:set' && e.o.x > 0.85)).toBe(true);
    c.ws.close();
  });

  it('bridge recovers when the simulator restarts (new source counter)', async () => {
    const { udpPort, wsPort } = await setup();
    const c = collect(wsPort); await c.ready;
    let s = new TuioSender({ port: udpPort, fps: 60, fseqStart: 5000 }); s.start();
    s.putObject(1, 0, 0.5, 0.5, 0); await s.wait(250); await s.stop();
    s = new TuioSender({ port: udpPort, fps: 60, fseqStart: 1 }); s.start(); // restarted: counter far lower
    s.putObject(1, 0, 0.8, 0.5, 0); await s.wait(400); await s.stop();
    expect(c.events().some((e) => e.t === 'object:set' && e.o.x > 0.75)).toBe(true);
    c.ws.close();
  });

  it('table going silent removes objects (stale expiry)', async () => {
    const { udpPort, wsPort } = await setup();
    const c = collect(wsPort); await c.ready;
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start();
    s.putObject(1, 0, 0.5, 0.5, 0); await s.wait(200); await s.stop();
    await new Promise((r) => setTimeout(r, 1500));
    expect(c.events().map((e) => e.t)).toContain('object:del');
    c.ws.close();
  });

  it('exposes /health', async () => {
    const { wsPort } = await setup();
    const r = await fetch(`http://127.0.0.1:${wsPort}/health`).then((r) => r.json());
    expect(r).toMatchObject({ ok: true, udp: 'listening' });
  });

  it('a WebSocket client can restart and resync', async () => {
    const { udpPort, wsPort } = await setup();
    const s = new TuioSender({ port: udpPort, fps: 60 }); s.start();
    s.putObject(1, 5, 0.3, 0.3, 0); await s.wait(150);
    const a = collect(wsPort); await a.ready; await s.wait(80); a.ws.close();
    const b = collect(wsPort); await b.ready; await s.wait(80);
    expect(b.msgs.find((m) => m.type === 'snapshot').objects[0].cid).toBe(5);
    await s.stop(); b.ws.close();
  });
});
