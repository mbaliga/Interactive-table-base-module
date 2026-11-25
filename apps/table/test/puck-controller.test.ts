import { describe, it, expect } from 'vitest';
import { Tracker, defaultConfig, roleMap, type InputEvent, type Role, type TableObject } from '@itable/input';
import { PuckController, quantize, radToDeg, type PuckHost } from '../src/kit/input/puck-controller';

const detents = (r: Role) => defaultConfig.objects.find((o) => o.role === r)!.rotation.detents;
function fakeHost() {
  const log: string[] = []; const on = new Set<Role>();
  const host: PuckHost = {
    isOn: (r) => on.has(r),
    place: (r, x, y, a) => { on.add(r); log.push(`place ${r} ${x.toFixed(2)},${y.toFixed(2)} ${a.toFixed(0)}`); },
    move: (r, x, y, a) => log.push(`move ${r} ${x.toFixed(2)},${y.toFixed(2)} ${a.toFixed(0)}`),
    remove: (r) => { on.delete(r); log.push(`remove ${r}`); },
  };
  return { host, log, on };
}
const obj = (sid: number, cid: number, x = 0.5, y = 0.5, angle = 0): TableObject => ({ sid, cid, role: cid as Role, x, y, angle });

describe('quantize / radToDeg', () => {
  it('snaps to the nearest detent', () => {
    expect(quantize(0, 3)).toBe(0); expect(quantize(59, 3)).toBe(0); expect(quantize(61, 3)).toBe(120);
    expect(quantize(200, 3)).toBe(240); expect(quantize(359, 3)).toBe(0); expect(quantize(-10, 3)).toBe(0);
  });
  it('passes continuous angles through, wrapped', () => { expect(quantize(370, null)).toBe(10); expect(quantize(-90, 0)).toBe(270); });
  it('rounds continuous angles to 0.01 degrees, so float32 wire noise disappears', () => {
    expect(quantize(318.000002, null)).toBe(318); expect(quantize(317.999998, null)).toBe(318);
    expect(quantize(359.999, null)).toBe(0); expect(quantize(12.346, null)).toBe(12.35);
    expect(quantize(radToDeg(Math.fround((318 * Math.PI) / 180)), null)).toBe(318);
  });
  it('radToDeg wraps', () => { expect(radToDeg(Math.PI)).toBeCloseTo(180); expect(radToDeg(-Math.PI / 2)).toBeCloseTo(270); expect(radToDeg(Math.PI * 5)).toBeCloseTo(180); });
});

describe('PuckController', () => {
  it('add -> place, set -> move, del -> remove', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: obj(1, 0, 0.3, 0.4, Math.PI / 2) });
    c.handle({ t: 'object:set', o: obj(1, 0, 0.35, 0.4, Math.PI) });
    c.handle({ t: 'object:del', o: obj(1, 0) });
    expect(log).toEqual(['place 0 0.30,0.40 90', 'move 0 0.35,0.40 180', 'remove 0']);
  });
  it('quantises detent roles (selector = 3 steps)', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: obj(1, 1, 0.5, 0.5, (130 * Math.PI) / 180) });
    expect(log[0]).toBe('place 1 0.50,0.50 120');
  });
  it('uses the unwrapped angle when present (same result, wrapped to 0..360)', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: { ...obj(1, 3), angle: 0.1, angleUnwrapped: Math.PI * 2 + 0.1 } });
    expect(log[0]).toBe('place 3 0.50,0.50 6');
  });
  it('ignores unmapped objects', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: { ...obj(1, 9), role: null } });
    expect(log).toEqual([]);
  });
  it('ignores a second object for an occupied role, and its del does not remove the first', () => {
    const { host, log } = fakeHost(); const msgs: string[] = []; const c = new PuckController(host, { detents, log: (m) => msgs.push(m) });
    c.handle({ t: 'object:add', o: obj(1, 2) }); c.handle({ t: 'object:add', o: obj(2, 2, 0.9) });
    c.handle({ t: 'object:set', o: obj(2, 2, 0.8) }); c.handle({ t: 'object:del', o: obj(2, 2) });
    expect(log).toEqual(['place 2 0.50,0.50 0']); expect(msgs).toHaveLength(1);
    c.handle({ t: 'object:del', o: obj(1, 2) });
    expect(log.at(-1)).toBe('remove 2');
  });
  it('skips repeated identical sets (no needless scenario recompute) but passes real changes', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: obj(1, 3, 0.5, 0.5, 1) });
    for (let i = 0; i < 5; i++) c.handle({ t: 'object:set', o: obj(1, 3, 0.5, 0.5, 1) });
    c.handle({ t: 'object:set', o: obj(1, 3, 0.5 + 5e-7, 0.5, 1) });        // float noise: skipped
    c.handle({ t: 'object:set', o: obj(1, 3, 0.5, 0.5, 1 + 1e-6) });        // 6e-5 degrees: rounds away, skipped
    expect(log).toEqual(['place 3 0.50,0.50 57']);
    c.handle({ t: 'object:set', o: obj(1, 3, 0.51, 0.5, 1) });
    c.handle({ t: 'object:set', o: obj(1, 3, 0.51, 0.5, 1.1) });
    expect(log.filter((l) => l.startsWith('move'))).toHaveLength(2);
  });
  it('a set for an unseen sid places (late add), and is idempotent on repeats', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:set', o: obj(7, 4) }); c.handle({ t: 'object:add', o: obj(7, 4) });
    expect(log.filter((l) => l.startsWith('place'))).toHaveLength(1);
  });
  it('cursor events are ignored', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'cursor:add', c: { sid: 1, x: 0, y: 0 } });
    expect(log).toEqual([]);
  });
  it('release ends the scenario and the same physical object stays ignored until lifted', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: obj(1, 3) });
    c.release(3);
    c.handle({ t: 'object:set', o: obj(1, 3, 0.6) }); // still on the table, jittering
    expect(log).toEqual(['place 3 0.50,0.50 0', 'remove 3']);
    c.handle({ t: 'object:del', o: obj(1, 3) });       // lifted
    c.handle({ t: 'object:add', o: obj(2, 3) });       // placed again: active again
    expect(log.at(-1)).toBe('place 3 0.50,0.50 0');
  });
  it('reset lifts every active role', () => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    c.handle({ t: 'object:add', o: obj(1, 0) }); c.handle({ t: 'object:add', o: obj(2, 5) });
    c.reset();
    expect(log.filter((l) => l.startsWith('remove')).sort()).toEqual(['remove 0', 'remove 5']);
  });
});

describe('PuckController behind the real Tracker (flicker)', () => {
  const run = (gapMs: number) => {
    const { host, log } = fakeHost(); const c = new PuckController(host, { detents });
    const tr = new Tracker(defaultConfig.tracker, roleMap(defaultConfig), () => {});
    tr.on((e: InputEvent) => c.handle(e));
    tr.ingest({ t: 'object:add', o: { sid: 5, cid: 2, role: null, x: 0.5, y: 0.5, angle: 0 } }, 0);
    tr.ingest({ t: 'object:del', o: { sid: 5, cid: 2, role: null, x: 0.5, y: 0.5, angle: 0 } }, 100);
    for (let t = 100; t < 100 + gapMs; t += 10) tr.tick(t);
    tr.ingest({ t: 'object:add', o: { sid: 6, cid: 2, role: null, x: 0.5, y: 0.5, angle: 0 } }, 100 + gapMs);
    for (let t = 100 + gapMs; t < 1500; t += 10) tr.tick(t);
    return log;
  };
  it('return within 100 ms never deactivates the scenario', () => {
    const l = run(100);
    expect(l.filter((x) => x.startsWith('place'))).toHaveLength(1);
    expect(l.filter((x) => x.startsWith('remove'))).toHaveLength(0);
  });
  it('return after 400 ms deactivates then re-activates', () => {
    const l = run(400);
    expect(l.filter((x) => x.startsWith('place'))).toHaveLength(2);
    expect(l.filter((x) => x.startsWith('remove'))).toHaveLength(1);
  });
});
