import type { Cursor, InputEvent, TableObject } from '@itable/input';
import type { OscMessage, OscPacket } from './osc';

type Profile = '2Dcur' | '2Dobj';
const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

interface ProfileState {
  source: string | null;
  lastFseq: number | null;
  oldRun: number;
  lastFrameAt: number;
  known: Map<number, Cursor | TableObject>;
}
export interface DecoderOptions {
  /** Frames older than this many consecutive times are taken as a restarted source. */
  restartAfterOld?: number;
  /** A silence this long also makes the next frame authoritative regardless of fseq. */
  restartGapMs?: number;
}

/** True if `next` is newer than `last` for a wrapping int32 counter. */
export function fseqIsNewer(next: number, last: number): boolean {
  const d = (((next - last) % 2 ** 32) + 2 ** 32) % 2 ** 32;
  return d > 0 && d < 2 ** 31;
}

/**
 * Stateful TUIO 1.1 decoder. Feed OSC packets in; get InputEvents out.
 * add/del are derived from changes in the `alive` list; a `set` for an unseen sid is an add.
 */
export class TuioDecoder {
  private st: Record<Profile, ProfileState> = { '2Dcur': this.fresh(), '2Dobj': this.fresh() };
  readonly dropped = { oldFrames: 0, restarts: 0, unknown: 0 };
  constructor(private opt: DecoderOptions = {}) {}

  private fresh(): ProfileState {
    return { source: null, lastFseq: null, oldRun: 0, lastFrameAt: 0, known: new Map() };
  }

  decode(packet: OscPacket, now: number): InputEvent[] {
    const msgs: OscMessage[] = [];
    const walk = (p: OscPacket) => ('packets' in p ? p.packets.forEach(walk) : msgs.push(p));
    walk(packet);
    const out: InputEvent[] = [];
    // A bundle holds one frame per profile; keep message order within each.
    for (const profile of ['2Dcur', '2Dobj'] as const) {
      const mine = msgs.filter((m) => m.address === `/tuio/${profile}`);
      if (mine.length) out.push(...this.frame(profile, mine, now));
    }
    for (const m of msgs) if (!/^\/tuio\/(2Dcur|2Dobj)$/.test(m.address)) this.dropped.unknown++;
    return out;
  }

  private frame(profile: Profile, msgs: OscMessage[], now: number): InputEvent[] {
    const s = this.st[profile];
    let source: string | null = null, fseq: number | null = null, alive: number[] | null = null;
    const sets: unknown[][] = [];
    for (const m of msgs) {
      const [cmd, ...rest] = m.args as [string, ...unknown[]];
      if (cmd === 'source') source = String(rest[0]);
      else if (cmd === 'alive') alive = rest.map(Number);
      else if (cmd === 'set') sets.push(rest);
      else if (cmd === 'fseq') fseq = Number(rest[0]);
    }

    // --- frame ordering ---
    const restartAfter = this.opt.restartAfterOld ?? 3;
    const gap = this.opt.restartGapMs ?? 1000;
    let restart = false;
    if (source !== null && s.source !== null && source !== s.source) restart = true;
    if (s.lastFseq !== null && now - s.lastFrameAt > gap) restart = true;
    if (fseq !== null && fseq !== -1 && s.lastFseq !== null && !restart) {
      if (!fseqIsNewer(fseq, s.lastFseq)) {
        s.oldRun++; this.dropped.oldFrames++;
        if (s.oldRun < restartAfter) return [];
        restart = true; // several "old" frames in a row: the sender restarted its counter
      } else s.oldRun = 0;
    }
    if (restart) { s.oldRun = 0; this.dropped.restarts++; }
    if (source !== null) s.source = source;
    if (fseq !== null && fseq !== -1) s.lastFseq = fseq;
    s.lastFrameAt = now;

    // --- diff ---
    const out: InputEvent[] = [];
    const aliveSet = alive ? new Set(alive) : null;
    for (const args of sets) {
      const ent = profile === '2Dcur' ? this.cursor(args) : this.object(args);
      if (!ent) continue;
      if (aliveSet && !aliveSet.has(ent.sid)) continue; // stale set for a sid that is no longer alive
      let prev = s.known.get(ent.sid);
      if (profile === '2Dobj' && prev && (prev as TableObject).cid !== (ent as TableObject).cid) {
        out.push(this.ev(profile, 'del', prev)); // the driver reused this session id for a different object
        prev = undefined;
      }
      s.known.set(ent.sid, ent);
      out.push(this.ev(profile, prev ? 'set' : 'add', ent));
    }
    if (aliveSet) {
      for (const [sid, ent] of [...s.known]) {
        if (!aliveSet.has(sid)) { s.known.delete(sid); out.push(this.ev(profile, 'del', ent)); }
      }
    }
    return out;
  }

  private cursor(a: unknown[]): Cursor | null {
    const [sid, x, y] = a.map(Number) as [number, number, number];
    return [sid, x, y].every(Number.isFinite) ? { sid, x, y } : null;
  }
  private object(a: unknown[]): TableObject | null {
    const [sid, cid, x, y, ang] = a.map(Number) as [number, number, number, number, number];
    return [sid, cid, x, y, ang].every(Number.isFinite) ? { sid, cid, role: null, x, y, angle: wrap(ang) } : null;
  }
  private ev(profile: Profile, kind: 'add' | 'set' | 'del', ent: Cursor | TableObject): InputEvent {
    return profile === '2Dcur'
      ? { t: `cursor:${kind}`, c: ent as Cursor }
      : { t: `object:${kind}`, o: ent as TableObject };
  }

  /** Current state, for syncing a browser that connects mid-session. */
  snapshot(): { cursors: Cursor[]; objects: TableObject[] } {
    return {
      cursors: [...this.st['2Dcur'].known.values()] as Cursor[],
      objects: [...this.st['2Dobj'].known.values()] as TableObject[],
    };
  }

  /** If a profile has been silent for staleMs, drop its entities (table or driver died). */
  expire(now: number, staleMs: number): InputEvent[] {
    const out: InputEvent[] = [];
    for (const profile of ['2Dcur', '2Dobj'] as const) {
      const s = this.st[profile];
      if (s.known.size && now - s.lastFrameAt > staleMs) {
        for (const ent of s.known.values()) out.push(this.ev(profile, 'del', ent));
        s.known.clear();
      }
    }
    return out;
  }
}
