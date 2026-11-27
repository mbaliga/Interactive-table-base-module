import { describe, it, expect } from 'vitest';
import golden from './osc-golden.json';
import { readPacket, writePacket } from '../src/osc';

type G = { input: any; hex: string; decoded: any };
const norm = (v: any): any => (v instanceof Uint8Array ? Array.from(v) : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, norm(x)])) : v);
const toInput = (p: any): any => ('packets' in p ? p : { address: p.address, args: p.args.map((a: any) => (a.type === 'b' ? { type: 'b', value: Uint8Array.from(a.value) } : a)) });

// Vectors were produced with the `osc` npm package (encoded bytes). Its decoder mis-reads blobs, so the blob case's decoded
// expectation is the value that was encoded ([1,2,3,4,5]) rather than that library's output.
describe('OSC codec vs vectors from the `osc` package', () => {
  for (const [name, g] of Object.entries(golden as Record<string, G>)) {
    it(`${name}: decodes to the same structure`, () => {
      expect(norm(readPacket(Buffer.from(g.hex, 'hex')))).toEqual(norm(g.decoded));
    });
    it(`${name}: encodes to the same bytes`, () => {
      const enc = (p: any): any => ('packets' in p ? { ...p, packets: p.packets.map(enc) } : toInput(p));
      expect(writePacket(enc(g.input)).toString('hex')).toBe(g.hex);
    });
  }
  it('rejects garbage without throwing anything but Error', () => {
    for (const bad of ['', '00', '2f61', '2f61000000', '2c696900', '2f6100002c690000'])
      expect(() => readPacket(Buffer.from(bad, 'hex'))).toThrow(Error);
  });
  it('rejects a bundle element that claims to be larger than the packet', () => {
    const b = Buffer.concat([Buffer.from('#bundle\0', 'latin1'), Buffer.alloc(8), Buffer.from([0, 0, 1, 0]), Buffer.from('/a\0\0')]);
    expect(() => readPacket(b)).toThrow(/size/);
  });
  it('round-trips int64, double, timetag, true/false/nil', () => {
    const msg = { address: '/t', args: [{ type: 'h', value: 5 }, { type: 'd', value: 1.25 }, { type: 't', value: { raw: [1, 2] } }, { type: 'T' }, { type: 'F' }, { type: 'N' }] };
    const d: any = readPacket(writePacket(msg));
    expect(d.args).toEqual([5n, 1.25, { raw: [1, 2] }, true, false, null]);
  });
});
