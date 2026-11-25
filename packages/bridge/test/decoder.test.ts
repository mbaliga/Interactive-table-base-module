import { describe, it, expect } from 'vitest';
import { TuioDecoder, fseqIsNewer, type OscPacket } from '../src';

type A = (string | number)[];
const msg = (profile: string, ...args: A) => ({ address: `/tuio/${profile}`, args });
const bundle = (profile: string, fseq: number, alive: number[], sets: A[] = [], source = 'src'): OscPacket => ({
  packets: [msg(profile, 'source', source), msg(profile, 'alive', ...alive), ...sets.map((s) => msg(profile, 'set', ...s)), msg(profile, 'fseq', fseq)],
});
const objSet = (sid: number, cid: number, x = 0.5, y = 0.5, a = 0): A => [sid, cid, x, y, a, 0, 0, 0, 0, 0];
const T = (e: any[]) => e.map((x) => x.t);

describe('fseqIsNewer', () => {
  it('handles plain, wrap and int32 sign flip', () => {
    expect(fseqIsNewer(5, 4)).toBe(true);
    expect(fseqIsNewer(4, 5)).toBe(false);
    expect(fseqIsNewer(5, 5)).toBe(false);
    expect(fseqIsNewer(-2147483648, 2147483647)).toBe(true); // int32 wrap
    expect(fseqIsNewer(0, 4294967295)).toBe(true);
  });
});

describe('TuioDecoder (2Dobj)', () => {
  it('derives add / set / del from alive', () => {
    const d = new TuioDecoder();
    expect(T(d.decode(bundle('2Dobj', 1, [3], [objSet(3, 2)]), 0))).toEqual(['object:add']);
    expect(T(d.decode(bundle('2Dobj', 2, [3], [objSet(3, 2, 0.6)]), 33))).toEqual(['object:set']);
    expect(T(d.decode(bundle('2Dobj', 3, []), 66))).toEqual(['object:del']);
    expect(d.snapshot().objects).toEqual([]);
  });

  it('del carries the last known state', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 1, [3], [objSet(3, 2, 0.1, 0.2)]), 0);
    const ev = d.decode(bundle('2Dobj', 2, []), 33) as any[];
    expect(ev[0].o).toMatchObject({ sid: 3, cid: 2, x: 0.1, y: 0.2 });
  });

  it('parses cid and wraps angle into [0, 2π)', () => {
    const d = new TuioDecoder();
    const e = d.decode(bundle('2Dobj', 1, [1], [objSet(1, 4, 0.2, 0.3, -0.5)]), 0)[0] as any;
    expect(e.o.cid).toBe(4);
    expect(e.o.angle).toBeCloseTo(Math.PI * 2 - 0.5);
    expect(e.o.role).toBeNull();
  });

  it('a set for an unseen sid is an add; alive-only sid emits nothing yet', () => {
    const d = new TuioDecoder();
    expect(T(d.decode(bundle('2Dobj', 1, [1, 2], [objSet(2, 0)]), 0))).toEqual(['object:add']);
    expect(T(d.decode(bundle('2Dobj', 2, [1, 2], [objSet(1, 1)]), 33))).toEqual(['object:add']);
  });

  it('ignores a stale set for a sid not in alive', () => {
    const d = new TuioDecoder();
    expect(d.decode(bundle('2Dobj', 1, [], [objSet(9, 0)]), 0)).toEqual([]);
  });

  it('burst of 6 adds in one frame', () => {
    const d = new TuioDecoder();
    const sids = [1, 2, 3, 4, 5, 6];
    const ev = d.decode(bundle('2Dobj', 1, sids, sids.map((s) => objSet(s, s - 1))), 0);
    expect(T(ev)).toEqual(Array(6).fill('object:add'));
    expect(d.snapshot().objects).toHaveLength(6);
  });

  it('drops old and duplicate frames', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 10, [1], [objSet(1, 0)]), 0);
    expect(d.decode(bundle('2Dobj', 9, []), 10)).toEqual([]);   // old: would have deleted it
    expect(d.decode(bundle('2Dobj', 10, []), 20)).toEqual([]);  // duplicate
    expect(d.snapshot().objects).toHaveLength(1);
    expect(d.dropped.oldFrames).toBe(2);
  });

  it('survives fseq wraparound at int32 max', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 2147483646, [1], [objSet(1, 0)]), 0);
    d.decode(bundle('2Dobj', 2147483647, [1], [objSet(1, 0, 0.6)]), 10);
    const ev = d.decode(bundle('2Dobj', -2147483648, [1], [objSet(1, 0, 0.7)]), 20);
    expect(T(ev)).toEqual(['object:set']);
    expect(d.dropped.oldFrames).toBe(0);
  });

  it('detects a restarted source (counter resets low) after a few old frames', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 5000, [1], [objSet(1, 0)]), 0);
    expect(d.decode(bundle('2Dobj', 1, [1], [objSet(1, 0, 0.6)]), 10)).toEqual([]);
    expect(d.decode(bundle('2Dobj', 2, [1], [objSet(1, 0, 0.6)]), 20)).toEqual([]);
    expect(T(d.decode(bundle('2Dobj', 3, [1], [objSet(1, 0, 0.7)]), 30))).toEqual(['object:set']);
    expect(d.dropped.restarts).toBe(1);
    expect(T(d.decode(bundle('2Dobj', 4, [1], [objSet(1, 0, 0.8)]), 40))).toEqual(['object:set']); // ordering resumes
  });

  it('a changed source name resets ordering immediately', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 5000, [1], [objSet(1, 0)], 'a'), 0);
    expect(T(d.decode(bundle('2Dobj', 1, [1], [objSet(1, 0, 0.6)], 'b'), 10))).toEqual(['object:set']);
  });

  it('after a long silence the next frame is accepted regardless of fseq', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 5000, [1], [objSet(1, 0)]), 0);
    expect(T(d.decode(bundle('2Dobj', 1, [1], [objSet(1, 0, 0.6)]), 5000))).toEqual(['object:set']);
  });

  it('fseq -1 means unordered and is always accepted', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 100, [1], [objSet(1, 0)]), 0);
    expect(T(d.decode(bundle('2Dobj', -1, [1], [objSet(1, 0, 0.6)]), 10))).toEqual(['object:set']);
  });

  it('expire removes entities after the stream goes silent', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 1, [1, 2], [objSet(1, 0), objSet(2, 1)]), 0);
    expect(d.expire(1000, 2000)).toEqual([]);
    expect(T(d.expire(2500, 2000))).toEqual(['object:del', 'object:del']);
    expect(d.snapshot().objects).toEqual([]);
  });

  it('reads nested bundles and ignores unknown profiles', () => {
    const d = new TuioDecoder();
    const inner = bundle('2Dobj', 1, [1], [objSet(1, 0)]);
    const ev = d.decode({ packets: [inner, msg('2Dblb', 'alive', 1), { address: '/other', args: [] }] }, 0);
    expect(T(ev)).toEqual(['object:add']);
    expect(d.dropped.unknown).toBe(2);
  });
});

describe('TuioDecoder: session id reused for a different class id', () => {
  it('emits del for the old object and add for the new one', () => {
    const d = new TuioDecoder();
    d.decode(bundle('2Dobj', 1, [1], [objSet(1, 0)]), 0);
    const ev = d.decode(bundle('2Dobj', 2, [1], [objSet(1, 3, 0.7)]), 33) as any[];
    expect(ev.map((e) => `${e.t}:${e.o.cid}`)).toEqual(['object:del:0', 'object:add:3']);
    expect(d.snapshot().objects).toHaveLength(1);
  });
});

describe('TuioDecoder (2Dcur)', () => {
  it('derives cursor events; profiles are independent', () => {
    const d = new TuioDecoder();
    expect(T(d.decode(bundle('2Dcur', 1, [7], [[7, 0.2, 0.3, 0, 0, 0]]), 0))).toEqual(['cursor:add']);
    expect(T(d.decode(bundle('2Dobj', 1, [1], [objSet(1, 0)]), 10))).toEqual(['object:add']);
    expect(T(d.decode(bundle('2Dcur', 2, []), 20))).toEqual(['cursor:del']);
    expect(d.snapshot().objects).toHaveLength(1);
  });
});
