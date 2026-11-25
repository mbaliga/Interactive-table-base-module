import { describe, it, expect } from 'vitest';
import type { ObjectDef } from '@itable/input';
import { rotationValue } from '../src/kit/pucks';

const def = (min: number, max: number, detents: number | null): ObjectDef => ({ cid: 0, role: 0, key: 'k', label: 'K', rotation: { meaning: 'm', min, max, detents } });

describe('rotationValue', () => {
  it('maps a continuous turn onto min..max', () => {
    expect(rotationValue(def(0, 360, null), 90)).toEqual({ value: 90, option: null });
    expect(rotationValue(def(80, 360, null), 180).value).toBe(220);
    expect(rotationValue(def(0, 1, null), 0).value).toBe(0);
    expect(rotationValue(def(0, 1, null), 359.99).value).toBeCloseTo(1, 3);
  });
  it('maps detent positions to an option index and evenly spaced values', () => {
    const d = def(0, 2, 3);
    expect(rotationValue(d, 0)).toEqual({ option: 0, value: 0 });
    expect(rotationValue(d, 120)).toEqual({ option: 1, value: 1 });
    expect(rotationValue(d, 240)).toEqual({ option: 2, value: 2 });
    expect(rotationValue(d, 359)).toEqual({ option: 0, value: 0 });
    expect(rotationValue(def(10, 10, 1), 200)).toEqual({ option: 0, value: 10 });
  });
});
