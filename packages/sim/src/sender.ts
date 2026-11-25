import dgram from 'node:dgram';
import { writePacket } from '@itable/bridge';

export interface SenderOptions {
  host?: string; port?: number; fps?: number; source?: string;
  /** Starting fseq; set near 2^31 to exercise wraparound. */
  fseqStart?: number;
  /** Probability 0..1 of dropping a whole UDP frame (lossy link test). */
  loss?: number;
}
type Obj = { sid: number; cid: number; x: number; y: number; a: number };
type Cur = { sid: number; x: number; y: number };

const S = (value: string) => ({ type: 's', value });
const I = (value: number) => ({ type: 'i', value });
const F = (value: number) => ({ type: 'f', value });

/** Minimal reacTIVision-like TUIO 1.1 sender: every frame carries source, alive, all sets, fseq. */
export class TuioSender {
  private sock = dgram.createSocket('udp4');
  private objs = new Map<number, Obj>();
  private curs = new Map<number, Cur>();
  private seq: number;
  private timer?: ReturnType<typeof setInterval>;
  private sid = 1;
  framesSent = 0;
  constructor(private o: SenderOptions = {}) { this.seq = o.fseqStart ?? 1; }

  start() { this.timer = setInterval(() => this.frame(), 1000 / (this.o.fps ?? 30)); }
  async stop() {
    clearInterval(this.timer);
    await new Promise<void>((r) => this.sock.close(() => r()));
  }
  wait(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }
  newSid() { return this.sid++; }

  putObject(sid: number, cid: number, x: number, y: number, a: number) { this.objs.set(sid, { sid, cid, x, y, a }); }
  dropObject(sid: number) { this.objs.delete(sid); }
  putCursor(sid: number, x: number, y: number) { this.curs.set(sid, { sid, x, y }); }
  dropCursor(sid: number) { this.curs.delete(sid); }
  hasObject(sid: number) { return this.objs.has(sid); }

  private bundle(profile: string, alive: number[], sets: unknown[][]) {
    const m = (...args: unknown[]) => ({ address: `/tuio/${profile}`, args });
    return {
      timeTag: { raw: [0, 1] },
      packets: [
        m(S('source'), S(this.o.source ?? 'sim@localhost')),
        m(S('alive'), ...alive.map(I)),
        ...sets.map((s) => m(S('set'), ...(s as never[]))),
        m(S('fseq'), I(this.seq | 0)),
      ],
    };
  }

  /** Send one frame now (also used directly by tests). */
  frame() {
    const o = [...this.objs.values()], c = [...this.curs.values()];
    const frames = [
      this.bundle('2Dobj', o.map((v) => v.sid), o.map((v) => [I(v.sid), I(v.cid), F(v.x), F(v.y), F(v.a), F(0), F(0), F(0), F(0), F(0)])),
      this.bundle('2Dcur', c.map((v) => v.sid), c.map((v) => [I(v.sid), F(v.x), F(v.y), F(0), F(0), F(0)])),
    ];
    this.seq = this.seq >= 2 ** 31 - 1 ? -(2 ** 31) : this.seq + 1; // int32 wrap
    if (this.o.loss && Math.random() < this.o.loss) return;
    for (const f of frames) {
      this.sock.send(writePacket(f), this.o.port ?? 3333, this.o.host ?? '127.0.0.1');
    }
    this.framesSent++;
  }
}
