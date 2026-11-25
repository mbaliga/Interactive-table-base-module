import { describe, it, expect } from 'vitest';
import { Normalizer, TAU } from '../src';

const base = { flipX: false, flipY: false, rotate: 0 as const, crop: { x: 0, y: 0, w: 1, h: 1 } };

describe('Normalizer', () => {
  it('identity', () => {
    const n = new Normalizer(base);
    expect(n.point(0.3, 0.7)).toEqual({ x: 0.3, y: 0.7 });
    expect(n.angle(1)).toBeCloseTo(1);
  });
  it('flipX mirrors x and negates angle', () => {
    const n = new Normalizer({ ...base, flipX: true });
    expect(n.point(0.2, 0.7).x).toBeCloseTo(0.8);
    expect(n.angle(0.5)).toBeCloseTo(TAU - 0.5);
  });
  it('flipY mirrors y; angle becomes π - a', () => {
    const n = new Normalizer({ ...base, flipY: true });
    expect(n.point(0.2, 0.7).y).toBeCloseTo(0.3);
    expect(n.angle(0)).toBeCloseTo(Math.PI);
  });
  it('rotate 90 moves top-left to top-right and turns angle +90°', () => {
    const n = new Normalizer({ ...base, rotate: 90 });
    const p = n.point(0, 0);
    expect(p.x).toBeCloseTo(1); expect(p.y).toBeCloseTo(0);
    expect(n.angle(0)).toBeCloseTo(Math.PI / 2);
  });
  it('four 90° rotations are the identity; rotate 180 equals flipX+flipY on points', () => {
    const r180 = new Normalizer({ ...base, rotate: 180 });
    const ff = new Normalizer({ ...base, flipX: true, flipY: true });
    expect(r180.point(0.2, 0.9).x).toBeCloseTo(ff.point(0.2, 0.9).x);
    expect(r180.point(0.2, 0.9).y).toBeCloseTo(ff.point(0.2, 0.9).y);
    expect(r180.angle(0.3)).toBeCloseTo(ff.angle(0.3));
  });
  it('crop remaps the active area to 0..1', () => {
    const n = new Normalizer({ ...base, crop: { x: 0.1, y: 0.2, w: 0.8, h: 0.6 } });
    expect(n.point(0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const p = n.point(0.9, 0.8);
    expect(p.x).toBeCloseTo(1); expect(p.y).toBeCloseTo(1);
  });
  it('apply preserves ids and event type', () => {
    const n = new Normalizer({ ...base, flipX: true });
    const e = n.apply({ t: 'object:set', o: { sid: 3, cid: 1, role: null, x: 0.1, y: 0.1, angle: 0 } });
    expect(e.t).toBe('object:set');
    expect((e as any).o.sid).toBe(3);
  });
});
