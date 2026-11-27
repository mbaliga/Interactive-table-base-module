import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tracker, defaultConfig, roleMap, TAU, type InputEvent } from '@itable/input';
import { loadJsonl, type RecLine } from '../src';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fx = (n: string) => loadJsonl(path.join(dir, `${n}.jsonl`));

/** Drive the tracker from a recording in virtual time (no real timers). */
export function runTracker(lines: RecLine[], holdMs = defaultConfig.tracker.removeHoldMs) {
  const tr = new Tracker({ ...defaultConfig.tracker, removeHoldMs: holdMs }, roleMap(defaultConfig), () => {});
  const out: InputEvent[] = [];
  tr.on((e) => out.push(e));
  let now = 0;
  const advance = (to: number) => { for (; now < to; now += 10) tr.tick(now); };
  for (const l of lines) {
    advance(l.t);
    const m = l.msg;
    if (m.type === 'event') tr.ingest(m.e, l.t);
    else if (m.type === 'snapshot') {
      for (const o of m.objects) tr.ingest({ t: 'object:add', o }, l.t);
      for (const c of m.cursors) tr.ingest({ t: 'cursor:add', c }, l.t);
    }
  }
  advance((lines.at(-1)?.t ?? 0) + 1000);
  return { out, tr };
}
const count = (ev: InputEvent[], t: string) => ev.filter((e) => e.t === t).length;
const objs = (ev: InputEvent[]) => ev.filter((e): e is Extract<InputEvent, { o: any }> => 'o' in e);

describe('tracker against recorded fixtures', () => {
  it('flicker: eight dropouts under the hold window never reach the app', () => {
    const { out } = runTracker(fx('flicker'));
    expect(count(out, 'object:add')).toBe(1);
    expect(count(out, 'object:del')).toBe(1);
    expect(new Set(objs(out).map((e) => e.o.sid)).size).toBe(1);
    expect(objs(out)[0]!.o.role).toBe(1);
  });

  it('flicker with hold disabled shows what the debounce is protecting against', () => {
    const { out } = runTracker(fx('flicker'), 0);
    expect(count(out, 'object:add')).toBeGreaterThan(1);
  });

  it('return-100: one placement, one removal', () => {
    const { out } = runTracker(fx('return-100'));
    expect(count(out, 'object:add')).toBe(1);
    expect(count(out, 'object:del')).toBe(1);
  });

  it('return-400: two placements with distinct stable sids', () => {
    const { out } = runTracker(fx('return-400'));
    const adds = objs(out).filter((e) => e.t === 'object:add');
    expect(adds).toHaveLength(2);
    expect(adds[0]!.o.sid).not.toBe(adds[1]!.o.sid);
    expect(count(out, 'object:del')).toBe(2);
  });

  it('six-objects: six roles, six distinct sids, all removed', () => {
    const { out, tr } = runTracker(fx('six-objects'));
    const adds = objs(out).filter((e) => e.t === 'object:add');
    expect(adds.map((e) => e.o.role).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(adds.map((e) => e.o.sid)).size).toBe(6);
    expect(count(out, 'object:del')).toBe(6);
    expect(tr.objects()).toHaveLength(0);
  });

  it('place-rotate: unwrapped angle is continuous and advances one full turn', () => {
    const { out } = runTracker(fx('place-rotate'));
    const u = objs(out).filter((e) => e.t !== 'object:del').map((e) => e.o.angleUnwrapped!);
    for (let i = 1; i < u.length; i++) expect(Math.abs(u[i]! - u[i - 1]!)).toBeLessThan(0.6); // no seam jump
    expect(Math.max(...u) - u[0]!).toBeGreaterThan(TAU * 0.8); // smoothing lags the very end slightly
    expect(objs(out).every((e) => e.o.angle >= 0 && e.o.angle < TAU)).toBe(true);
  });

  it('touch-and-objects: two cursors and two objects, all cleaned up', () => {
    const { out } = runTracker(fx('touch-and-objects'));
    expect(count(out, 'cursor:add')).toBe(2);
    expect(count(out, 'cursor:del')).toBe(2);
    expect(count(out, 'object:add')).toBe(2);
    expect(count(out, 'object:del')).toBe(2);
  });

  it('fseq-wrap fixture behaves like place-rotate', () => {
    const { out } = runTracker(fx('fseq-wrap'));
    expect(count(out, 'object:add')).toBe(1);
    expect(count(out, 'object:del')).toBe(1);
  });
});
