/**
 * Minimal OSC 1.0 codec (messages and bundles). Pure JS, no native modules, so the bridge runs the same on
 * Windows and Linux. Checked against vectors produced by the `osc` npm package (test/osc-golden.json).
 * Supported argument types: i f s b h d t c T F N I. Anything else throws.
 */
export interface OscMessage { address: string; args: unknown[] }
export interface OscBundle { timeTag?: { raw: [number, number] }; packets: OscPacket[] }
export type OscPacket = OscMessage | OscBundle;
export interface OscArg { type: string; value?: unknown }

const pad4 = (n: number) => (n + 3) & ~3;

export function readPacket(data: Uint8Array): OscPacket {
  const buf = data instanceof Buffer ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return readAt(buf, 0, buf.length);
}

function readString(buf: Buffer, pos: number, end: number): [string, number] {
  let z = pos;
  while (z < end && buf[z] !== 0) z++;
  if (z >= end) throw new Error('OSC: unterminated string');
  return [buf.toString('utf8', pos, z), pos + pad4(z - pos + 1)];
}

function readAt(buf: Buffer, start: number, end: number): OscPacket {
  if (end - start < 4) throw new Error('OSC: packet too short');
  if (buf.toString('latin1', start, start + 8) === '#bundle\0') {
    if (end - start < 16) throw new Error('OSC: truncated bundle');
    const raw: [number, number] = [buf.readUInt32BE(start + 8), buf.readUInt32BE(start + 12)];
    const packets: OscPacket[] = [];
    let p = start + 16;
    while (p < end) {
      if (p + 4 > end) throw new Error('OSC: truncated bundle element');
      const size = buf.readInt32BE(p); p += 4;
      if (size < 0 || p + size > end) throw new Error('OSC: bad bundle element size');
      packets.push(readAt(buf, p, p + size)); p += size;
    }
    return { timeTag: { raw }, packets };
  }
  let [address, p] = readString(buf, start, end);
  if (!address.startsWith('/')) throw new Error('OSC: bad address');
  const args: unknown[] = [];
  if (p >= end) return { address, args };
  let tags: string; [tags, p] = readString(buf, p, end);
  if (tags[0] !== ',') throw new Error('OSC: bad type tags');
  const need = (n: number) => { if (p + n > end) throw new Error('OSC: truncated argument'); };
  for (const t of tags.slice(1)) {
    switch (t) {
      case 'i': need(4); args.push(buf.readInt32BE(p)); p += 4; break;
      case 'f': need(4); args.push(buf.readFloatBE(p)); p += 4; break;
      case 'c': need(4); args.push(String.fromCharCode(buf.readUInt32BE(p))); p += 4; break;
      case 's': { let s: string; [s, p] = readString(buf, p, end); args.push(s); break; }
      case 'b': { need(4); const n = buf.readInt32BE(p); p += 4; if (n < 0) throw new Error('OSC: bad blob'); need(n); args.push(Uint8Array.from(buf.subarray(p, p + n))); p += pad4(n); break; }
      case 'h': need(8); args.push(buf.readBigInt64BE(p)); p += 8; break;
      case 'd': need(8); args.push(buf.readDoubleBE(p)); p += 8; break;
      case 't': need(8); args.push({ raw: [buf.readUInt32BE(p), buf.readUInt32BE(p + 4)] }); p += 8; break;
      case 'T': args.push(true); break;
      case 'F': args.push(false); break;
      case 'N': args.push(null); break;
      case 'I': args.push(Infinity); break;
      default: throw new Error(`OSC: unsupported type tag '${t}'`);
    }
  }
  return { address, args };
}

const str = (s: string) => { const b = Buffer.from(s, 'utf8'); const out = Buffer.alloc(pad4(b.length + 1)); b.copy(out); return out; };

/** Encode a message `{address, args:[{type,value}]}` or bundle `{timeTag:{raw:[a,b]}, packets}`. */
export function writePacket(p: { address: string; args?: OscArg[] } | { timeTag?: { raw: number[] }; packets: unknown[] }): Buffer {
  if ('packets' in p) {
    const head = Buffer.alloc(16); head.write('#bundle\0', 0, 'latin1');
    const raw = p.timeTag?.raw ?? [0, 1]; head.writeUInt32BE(raw[0] ?? 0, 8); head.writeUInt32BE(raw[1] ?? 1, 12);
    const parts: Buffer[] = [head];
    for (const e of p.packets) { const b = writePacket(e as never); const len = Buffer.alloc(4); len.writeInt32BE(b.length); parts.push(len, b); }
    return Buffer.concat(parts);
  }
  const args = p.args ?? [];
  const parts: Buffer[] = [str(p.address), str(',' + args.map((a) => a.type).join(''))];
  for (const a of args) {
    const v = a.value;
    let b: Buffer;
    switch (a.type) {
      case 'i': b = Buffer.alloc(4); b.writeInt32BE(v as number); break;
      case 'f': b = Buffer.alloc(4); b.writeFloatBE(v as number); break;
      case 's': b = str(String(v)); break;
      case 'b': { const d = Buffer.from(v as Uint8Array); b = Buffer.alloc(4 + pad4(d.length)); b.writeInt32BE(d.length); d.copy(b, 4); break; }
      case 'h': b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v as number | bigint)); break;
      case 'd': b = Buffer.alloc(8); b.writeDoubleBE(v as number); break;
      case 't': { b = Buffer.alloc(8); const r = (v as { raw: [number, number] }).raw; b.writeUInt32BE(r[0]); b.writeUInt32BE(r[1], 4); break; }
      case 'T': case 'F': case 'N': case 'I': b = Buffer.alloc(0); break;
      default: throw new Error(`OSC: unsupported type '${a.type}'`);
    }
    parts.push(b);
  }
  return Buffer.concat(parts);
}
