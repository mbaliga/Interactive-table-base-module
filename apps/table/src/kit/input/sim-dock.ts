import type { InputEvent, InputSource, Role, TableConfig } from '@itable/input';

/**
 * The on-screen dock of pucks as an InputSource. The dock UI turns pointer gestures into the same
 * add/set/del events a TUIO table produces, so the app has exactly one way in.
 * x,y are 0..1 of the stage; angle is radians (TUIO native).
 */
export class SimDockSource implements InputSource {
  private listeners = new Set<(e: InputEvent) => void>();
  private live = new Map<Role, number>(); // role -> raw sid
  private nextSid = 1;
  constructor(private cfg: Pick<TableConfig, 'objects'>) {}

  start(): void {}
  stop(): void { this.live.clear(); }
  on(fn: (e: InputEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  isPlaced(role: Role): boolean { return this.live.has(role); }

  add(role: Role, x: number, y: number, angle: number): void {
    if (this.live.has(role)) return this.set(role, x, y, angle);
    const sid = this.nextSid++;
    this.live.set(role, sid);
    this.emit('object:add', role, sid, x, y, angle);
  }
  set(role: Role, x: number, y: number, angle: number): void {
    const sid = this.live.get(role);
    if (sid !== undefined) this.emit('object:set', role, sid, x, y, angle);
  }
  del(role: Role, x = 0, y = 0, angle = 0): void {
    const sid = this.live.get(role);
    if (sid === undefined) return;
    this.live.delete(role);
    this.emit('object:del', role, sid, x, y, angle);
  }

  private emit(t: 'object:add' | 'object:set' | 'object:del', role: Role, sid: number, x: number, y: number, angle: number) {
    const cid = this.cfg.objects.find((o) => o.role === role)?.cid ?? role;
    const e: InputEvent = { t, o: { sid, cid, role: null, x, y, angle } };
    for (const l of this.listeners) l(e);
  }
}
