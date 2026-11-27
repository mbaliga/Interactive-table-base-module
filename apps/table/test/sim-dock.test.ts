import { describe, it, expect } from 'vitest';
import { createPipeline, defaultConfig, type InputEvent } from '@itable/input';
import { SimDockSource } from '../src/kit/input/sim-dock';

describe('SimDockSource through the pipeline (smoothing off)', () => {
  it('maps role to the configured cid, and the tracker assigns the role back', () => {
    const dock = new SimDockSource(defaultConfig);
    const pipe = createPipeline({ source: dock, config: defaultConfig, transform: false, tracker: { oneEuro: null, removeHoldMs: 0 }, now: () => 0 });
    const ev: InputEvent[] = []; pipe.on((e) => ev.push(e));
    pipe.start();
    dock.add(3, 0.4, 0.6, 1); dock.set(3, 0.5, 0.6, 2); dock.del(3);
    pipe.stop();
    expect(ev.map((e) => e.t)).toEqual(['object:add', 'object:set', 'object:del']);
    const o = (ev[1] as any).o; expect(o.role).toBe(3); expect(o.x).toBe(0.5); expect(o.angle).toBeCloseTo(2, 12);
  });
  it('a duplicate add is a set; set/del without add are ignored', () => {
    const dock = new SimDockSource(defaultConfig); const raw: InputEvent[] = []; dock.on((e) => raw.push(e));
    dock.set(1, 0, 0, 0); dock.del(1); dock.add(1, 0.1, 0.1, 0); dock.add(1, 0.2, 0.1, 0); dock.del(1);
    expect(raw.map((e) => e.t)).toEqual(['object:add', 'object:set', 'object:del']);
    expect(dock.isPlaced(1)).toBe(false);
  });
});
