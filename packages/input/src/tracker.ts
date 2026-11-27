import type { Cursor, InputEvent, Role, TableObject } from './types';
import { TAU, wrapAngle } from './types';
import type { TrackerConfig } from './config';
import { OneEuro } from './oneEuro';

export type TrackerLogger = (msg: string) => void;

interface Placement {
  sid: number;           // stable id handed to the app
  rawSid: number | null; // current source sid; null while held after a removal
  cid: number;
  fx: OneEuro | null; fy: OneEuro | null; fa: OneEuro | null;
  unwrapped: number | null; // last raw unwrapped angle
  last: TableObject;
  removedAt: number | null;
  /** Latest raw (unsmoothed) values; the filters settle toward these between source messages. */
  target: { x: number; y: number; u: number };
  settled: boolean;
}

/**
 * Turns raw source events into the stable stream the app sees:
 *  - debounces removal (`removeHoldMs`); a returning cid inside the window keeps its stable sid
 *  - one-euro smoothing on x, y and the unwrapped angle
 *  - idempotent add (a duplicate add is a set)
 *  - unknown cid -> role null, logged once
 * Time is passed in by the caller (ms), so behaviour is deterministic under test. Call `tick(now)` regularly.
 */
export class Tracker {
  private listeners = new Set<(e: InputEvent) => void>();
  private byRaw = new Map<number, Placement>();
  private held: Placement[] = [];
  private cursors = new Map<number, Cursor>();
  private nextSid = 1;
  private warnedCids = new Set<number>();
  private dupCids = new Set<number>();

  constructor(
    private cfg: TrackerConfig,
    private roles: Map<number, Role>,
    private log: TrackerLogger = (m) => console.warn('[tracker]', m),
  ) {}

  on(fn: (e: InputEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: InputEvent) { for (const l of this.listeners) l(e); }

  /** Live (not held) objects, as the app currently sees them. */
  objects(): TableObject[] { return [...this.byRaw.values()].map((p) => p.last); }
  /** Cids currently on more than one live placement (dev overlay flag). */
  duplicateCids(): number[] { return [...this.dupCids]; }

  ingest(e: InputEvent, now: number): void {
    if ('c' in e) return this.ingestCursor(e);
    this.ingestObject(e, now);
  }

  private ingestCursor(e: Extract<InputEvent, { c: Cursor }>) {
    const { sid } = e.c;
    if (e.t === 'cursor:del') {
      if (this.cursors.delete(sid)) this.emit({ t: 'cursor:del', c: e.c });
      return;
    }
    const known = this.cursors.has(sid);
    this.cursors.set(sid, e.c);
    this.emit({ t: known ? 'cursor:set' : 'cursor:add', c: e.c });
  }

  private ingestObject(e: Extract<InputEvent, { o: TableObject }>, now: number) {
    const o = e.o;
    let p = this.byRaw.get(o.sid);

    // A table that restarts its session ids can hand an old sid to a different object: that is a removal plus an add.
    if (p && e.t !== 'object:del' && p.cid !== o.cid) {
      this.ingestObject({ t: 'object:del', o: { ...o, cid: p.cid } }, now);
      p = undefined;
    }

    if (e.t === 'object:del') {
      if (!p) return;
      this.byRaw.delete(o.sid);
      p.rawSid = null;
      this.recomputeDup();
      if (this.cfg.removeHoldMs <= 0) { this.emit({ t: 'object:del', o: p.last }); return; } // no debounce (simulated input)
      p.removedAt = now;
      this.held.push(p);
      return;
    }

    if (!p) {
      // Same cid returning inside the hold window -> same placement.
      const i = this.held.findIndex((h) => h.cid === o.cid);
      if (i >= 0) {
        p = this.held.splice(i, 1)[0]!;
        p.rawSid = o.sid; p.removedAt = null;
        this.byRaw.set(o.sid, p);
        p.last = this.smooth(p, o, now);
        this.emit({ t: 'object:set', o: p.last });
        this.recomputeDup();
        return;
      }
      p = this.create(o, now);
      this.byRaw.set(o.sid, p);
      this.recomputeDup();
      this.emit({ t: 'object:add', o: p.last });
      return;
    }
    // Existing placement: a duplicate/late add and a set are both just updates.
    p.last = this.smooth(p, o, now);
    this.emit({ t: 'object:set', o: p.last });
  }

  private create(o: TableObject, now: number): Placement {
    if (!this.roles.has(o.cid) && !this.warnedCids.has(o.cid)) {
      this.warnedCids.add(o.cid);
      this.log(`unknown cid ${o.cid}: emitting with role null`);
    }
    const eu = this.cfg.oneEuro;
    const p: Placement = {
      sid: this.nextSid++, rawSid: o.sid, cid: o.cid,
      fx: eu && new OneEuro(eu), fy: eu && new OneEuro(eu), fa: eu && new OneEuro(eu),
      unwrapped: null, last: undefined as unknown as TableObject, removedAt: null,
      target: { x: o.x, y: o.y, u: 0 }, settled: false,
    };
    p.last = this.smooth(p, o, now);
    return p;
  }

  private smooth(p: Placement, o: TableObject, now: number): TableObject {
    // Unwrap by the shortest arc from the previous raw angle.
    let u: number;
    if (p.unwrapped === null) u = wrapAngle(o.angle);
    else {
      let d = wrapAngle(o.angle) - wrapAngle(p.unwrapped);
      if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
      u = p.unwrapped + d;
    }
    p.unwrapped = u;
    p.target = { x: o.x, y: o.y, u };
    p.settled = false;
    const su = p.fa ? p.fa.filter(u, now) : u;
    return {
      sid: p.sid, cid: p.cid, role: this.roles.get(p.cid) ?? null,
      x: p.fx ? p.fx.filter(o.x, now) : o.x, y: p.fy ? p.fy.filter(o.y, now) : o.y,
      angle: wrapAngle(su), angleUnwrapped: su,
    };
  }

  /** Emit deferred removals whose hold window has expired. */
  tick(now: number): void {
    this.settle(now);
    if (!this.held.length) return;
    const keep: Placement[] = [];
    for (const h of this.held) {
      if (now - (h.removedAt as number) >= this.cfg.removeHoldMs) this.emit({ t: 'object:del', o: h.last });
      else keep.push(h);
    }
    this.held = keep;
  }

  /**
   * Sources (TUIO especially) stop sending when an object is still, which would strand the filtered
   * value short of the true one. Keep filtering toward the last raw value until it converges, then
   * emit one final exact `set`.
   */
  private settle(now: number) {
    for (const p of this.byRaw.values()) {
      if (p.settled || !p.fx || !p.fy || !p.fa) continue;
      const { x, y, u } = p.target;
      const nx = p.fx.filter(x, now), ny = p.fy.filter(y, now), nu = p.fa.filter(u, now);
      const done = Math.abs(nx - x) < 1e-4 && Math.abs(ny - y) < 1e-4 && Math.abs(nu - u) < 1e-3;
      const [fx, fy, fu] = done ? [x, y, u] : [nx, ny, nu];
      p.settled = done;
      p.last = { ...p.last, x: fx, y: fy, angle: wrapAngle(fu), angleUnwrapped: fu };
      this.emit({ t: 'object:set', o: p.last });
    }
  }

  /** Drop everything immediately (idle reset). Emits dels. */
  reset(): void {
    for (const p of [...this.byRaw.values(), ...this.held]) this.emit({ t: 'object:del', o: p.last });
    for (const c of this.cursors.values()) this.emit({ t: 'cursor:del', c });
    this.byRaw.clear(); this.held = []; this.cursors.clear(); this.dupCids.clear();
  }

  private recomputeDup() {
    const seen = new Map<number, number>();
    for (const p of this.byRaw.values()) seen.set(p.cid, (seen.get(p.cid) ?? 0) + 1);
    const next = new Set([...seen].filter(([, n]) => n > 1).map(([c]) => c));
    for (const c of next) if (!this.dupCids.has(c)) this.log(`two live objects share cid ${c}`);
    this.dupCids = next;
  }
}
