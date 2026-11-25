import { describe, it, expect } from 'vitest';
import { Tracker, defaultConfig, roleMap, type InputEvent, type TableObject } from '../src';

const cfg = { ...defaultConfig.tracker, oneEuro: { minCutoff: 1e6, beta: 0, dCutoff: 1 } }; // effectively no smoothing
const mk = (log: string[] = []) => {
  const tr = new Tracker(cfg, roleMap(defaultConfig), (m) => log.push(m));
  const ev: InputEvent[] = [];
  tr.on((e) => ev.push(e));
  return { tr, ev, log };
};
const obj = (sid: number, cid: number, x = 0.5, y = 0.5, angle = 0): TableObject => ({ sid, cid, role: null, x, y, angle });
const types = (ev: InputEvent[]) => ev.map((e) => e.t);

describe('Tracker', () => {
  it('maps cid to role through config', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(7, 3) }, 0);
    expect((ev[0] as any).o.role).toBe(3);
  });

  it('delays del by the hold window', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:del', o: obj(1, 0) }, 100);
    tr.tick(250); expect(types(ev)).toEqual(['object:add']);
    tr.tick(300); expect(types(ev)).toEqual(['object:add', 'object:del']);
  });

  it('treats a return within the window as the same placement (stable sid, new raw sid)', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 2) }, 0);
    tr.ingest({ t: 'object:del', o: obj(1, 2) }, 100);
    tr.ingest({ t: 'object:add', o: obj(9, 2, 0.6) }, 180); // table reissued a new session id
    tr.tick(1000);
    expect(types(ev).filter((t) => t !== 'object:set')).toEqual(['object:add']); // no del, no second add
    expect((ev[1] as any).o.sid).toBe((ev[0] as any).o.sid);
    expect(tr.objects()).toHaveLength(1);
  });

  it('a return after the window is a new placement with a new sid', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 2) }, 0);
    tr.ingest({ t: 'object:del', o: obj(1, 2) }, 100);
    tr.tick(400);
    tr.ingest({ t: 'object:add', o: obj(2, 2) }, 410);
    expect(types(ev)).toEqual(['object:add', 'object:del', 'object:add']);
    expect((ev[2] as any).o.sid).not.toBe((ev[0] as any).o.sid);
  });

  it('repeated flicker never emits a del', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 4) }, 0);
    for (let i = 0; i < 10; i++) {
      tr.ingest({ t: 'object:del', o: obj(1 + i, 4) }, 50 + i * 100);
      tr.ingest({ t: 'object:add', o: obj(2 + i, 4) }, 80 + i * 100);
      tr.tick(90 + i * 100);
    }
    expect(types(ev).filter((t) => t === 'object:del')).toHaveLength(0);
    expect(types(ev).filter((t) => t === 'object:add')).toHaveLength(1);
  });

  it('is idempotent on duplicate and late adds', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 10);
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 20);
    expect(types(ev)).toEqual(['object:add', 'object:set', 'object:set']);
  });

  it('ignores a del for an unknown sid', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:del', o: obj(5, 0) }, 0); tr.tick(1000);
    expect(ev).toHaveLength(0);
  });

  it('unknown cid: role null, logged once, no throw', () => {
    const { tr, ev, log } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 42) }, 0);
    tr.ingest({ t: 'object:set', o: obj(1, 42, 0.4) }, 10);
    expect((ev[0] as any).o.role).toBeNull();
    expect(log.filter((m) => m.includes('unknown cid 42'))).toHaveLength(1);
  });

  it('keeps two objects with the same cid apart and flags it', () => {
    const { tr, ev, log } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 1, 0.2) }, 0);
    tr.ingest({ t: 'object:add', o: obj(2, 1, 0.8) }, 5);
    expect(types(ev)).toEqual(['object:add', 'object:add']);
    expect(tr.duplicateCids()).toEqual([1]);
    expect(log.some((m) => m.includes('share cid 1'))).toBe(true);
    expect(tr.objects().map((o) => o.sid).sort()).toEqual([1, 2]);
  });

  it('burst of 6 adds yields 6 distinct placements, all roles', () => {
    const { tr, ev } = mk();
    for (let c = 0; c < 6; c++) tr.ingest({ t: 'object:add', o: obj(10 + c, c) }, 0);
    const roles = ev.map((e) => (e as any).o.role).sort();
    expect(roles).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(ev.map((e) => (e as any).o.sid)).size).toBe(6);
  });

  it('unwraps angle across 0/2π so the app never sees a jump', () => {
    const { tr, ev } = mk();
    const A = Math.PI * 2;
    const seq = [A - 0.2, A - 0.1, 0.0, 0.1, 0.2]; // clockwise through the seam
    seq.forEach((a, i) => tr.ingest({ t: i ? 'object:set' : 'object:add', o: obj(1, 3, 0.5, 0.5, a) }, i * 16));
    const u = ev.map((e) => (e as any).o.angleUnwrapped as number);
    for (let i = 1; i < u.length; i++) expect(u[i]! - u[i - 1]!).toBeCloseTo(0.1, 3);
    expect(u[4]).toBeGreaterThan(A);
    const w = ev.map((e) => (e as any).o.angle as number);
    expect(w.every((a) => a >= 0 && a < A)).toBe(true);
  });

  it('unwraps counter-clockwise through the seam', () => {
    const { tr, ev } = mk();
    [0.1, 0.0, Math.PI * 2 - 0.1].forEach((a, i) => tr.ingest({ t: i ? 'object:set' : 'object:add', o: obj(1, 3, 0.5, 0.5, a) }, i * 16));
    const u = ev.map((e) => (e as any).o.angleUnwrapped as number);
    expect(u[2]).toBeCloseTo(-0.1, 3);
  });

  it('smoothing reduces jitter on a stationary object', () => {
    const tr = new Tracker(defaultConfig.tracker, roleMap(defaultConfig), () => {});
    const xs: number[] = [];
    tr.on((e) => xs.push((e as any).o.x));
    for (let i = 0; i < 60; i++) tr.ingest({ t: i ? 'object:set' : 'object:add', o: obj(1, 0, 0.5 + (i % 2 ? 0.002 : -0.002)) }, i * 16);
    const spread = Math.max(...xs.slice(10)) - Math.min(...xs.slice(10));
    expect(spread).toBeLessThan(0.002);
  });

  it('smoothing does not lag a fast move by much', () => {
    const tr = new Tracker(defaultConfig.tracker, roleMap(defaultConfig), () => {});
    let last = 0;
    tr.on((e) => (last = (e as any).o.x));
    tr.ingest({ t: 'object:add', o: obj(1, 0, 0.1) }, 0);
    for (let i = 1; i <= 30; i++) tr.ingest({ t: 'object:set', o: obj(1, 0, 0.1 + i * 0.02) }, i * 16);
    expect(0.7 - last).toBeLessThan(0.1);
  });

  it('cursors: duplicate add is a set; del once', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'cursor:add', c: { sid: 1, x: 0.1, y: 0.1 } }, 0);
    tr.ingest({ t: 'cursor:add', c: { sid: 1, x: 0.2, y: 0.1 } }, 1);
    tr.ingest({ t: 'cursor:del', c: { sid: 1, x: 0.2, y: 0.1 } }, 2);
    tr.ingest({ t: 'cursor:del', c: { sid: 1, x: 0.2, y: 0.1 } }, 3);
    expect(types(ev)).toEqual(['cursor:add', 'cursor:set', 'cursor:del']);
  });

  it('reset clears everything, including held placements', () => {
    const { tr, ev } = mk();
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:add', o: obj(2, 1) }, 0);
    tr.ingest({ t: 'object:del', o: obj(2, 1) }, 10);
    tr.reset();
    expect(types(ev).filter((t) => t === 'object:del')).toHaveLength(2);
    tr.tick(10_000);
    expect(types(ev).filter((t) => t === 'object:del')).toHaveLength(2);
  });
});

describe('Tracker settling', () => {
  const real = () => {
    const tr = new Tracker(defaultConfig.tracker, roleMap(defaultConfig), () => {});
    const ev: any[] = []; tr.on((e) => ev.push(e));
    return { tr, ev };
  };
  it('converges to the true value after the source stops sending', () => {
    const { tr, ev } = real();
    tr.ingest({ t: 'object:add', o: obj(1, 0, 0.1, 0.1, 0) }, 0);
    tr.ingest({ t: 'object:set', o: obj(1, 0, 0.9, 0.9, 2) }, 1); // one jump, then silence
    const lag = ev.at(-1).o.x;
    expect(lag).toBeLessThan(0.9);
    for (let t = 20; t <= 1000; t += 20) tr.tick(t);
    const last = ev.at(-1).o;
    expect(last.x).toBeCloseTo(0.9, 5); expect(last.y).toBeCloseTo(0.9, 5); expect(last.angleUnwrapped).toBeCloseTo(2, 3);
  });
  it('goes quiet once settled', () => {
    const { tr, ev } = real();
    tr.ingest({ t: 'object:add', o: obj(1, 0, 0.1, 0.1, 0) }, 0);
    tr.ingest({ t: 'object:set', o: obj(1, 0, 0.5, 0.5, 1) }, 1);
    for (let t = 20; t <= 2000; t += 20) tr.tick(t);
    const n = ev.length;
    for (let t = 2020; t <= 4000; t += 20) tr.tick(t);
    expect(ev.length).toBe(n);
  });
  it('does not settle a held (removed) placement or emit after del', () => {
    const { tr, ev } = real();
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:del', o: obj(1, 0) }, 5);
    for (let t = 20; t <= 1000; t += 20) tr.tick(t);
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:del']);
  });
});

describe('Tracker with smoothing off', () => {
  it('passes values through exactly and never emits settle sets', () => {
    const tr = new Tracker({ ...defaultConfig.tracker, oneEuro: null }, roleMap(defaultConfig), () => {});
    const ev: any[] = []; tr.on((e) => ev.push(e));
    tr.ingest({ t: 'object:add', o: obj(1, 0, 0.123, 0.456, 1.5) }, 0);
    tr.ingest({ t: 'object:set', o: obj(1, 0, 0.9, 0.1, 2.5) }, 1);
    for (let t = 20; t < 1000; t += 20) tr.tick(t);
    expect(ev).toHaveLength(2);
    expect(ev[0].o.x).toBe(0.123); expect(ev[1].o.y).toBe(0.1); expect(ev[1].o.angle).toBeCloseTo(2.5, 12);
  });
});

describe('Tracker with removeHoldMs 0', () => {
  it('emits del immediately and synchronously', () => {
    const tr = new Tracker({ ...defaultConfig.tracker, oneEuro: null, removeHoldMs: 0 }, roleMap(defaultConfig), () => {});
    const ev: any[] = []; tr.on((e) => ev.push(e));
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:del', o: obj(1, 0) }, 1);
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:del']);
    tr.ingest({ t: 'object:add', o: obj(2, 0) }, 2);
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:del', 'object:add']);
    expect(ev[2].o.sid).not.toBe(ev[0].o.sid); // a new placement, not a re-adoption
  });
});

describe('Tracker: session id reused for a different object', () => {
  it('treats same sid + different cid as a removal then an add, with the right roles', () => {
    const tr = new Tracker({ ...defaultConfig.tracker, oneEuro: null, removeHoldMs: 0 }, roleMap(defaultConfig), () => {});
    const ev: any[] = []; tr.on((e) => ev.push(e));
    tr.ingest({ t: 'object:add', o: obj(1, 0) }, 0);
    tr.ingest({ t: 'object:set', o: obj(1, 3, 0.7) }, 10); // table restarted its ids: sid 1 is now a different puck
    expect(ev.map((e) => `${e.t}:${e.o.role}`)).toEqual(['object:add:0', 'object:del:0', 'object:add:3']);
    expect(ev[2].o.sid).not.toBe(ev[0].o.sid);
  });
});
