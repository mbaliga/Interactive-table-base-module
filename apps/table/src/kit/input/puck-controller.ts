import type { InputEvent, Role, TableObject } from '@itable/input';

/** What the app implements so tangible objects can drive it. cid here is the puck/scenario index (= role). */
export interface PuckHost {
  isOn(role: Role): boolean;
  /** An object of this role appeared. x,y are 0..1 of the table surface; angleDeg is 0..360 (already detent-quantised). */
  place(role: Role, x: number, y: number, angleDeg: number): void;
  move(role: Role, x: number, y: number, angleDeg: number): void;
  remove(role: Role): void;
}

export interface PuckControllerOptions {
  /** detents per role (null/0 = continuous). Comes from config `objects[].rotation.detents`. */
  detents: (role: Role) => number | null;
  log?: (msg: string) => void;
}

/** Position changes smaller than this (normalised units, about 0.004 px on a 4K panel) are not movement. */
export const MOVE_EPS = 1e-6;

export const radToDeg = (a: number): number => (((a * 180) / Math.PI) % 360 + 360) % 360;

/**
 * Snap to the nearest detent. Continuous angles are rounded to 0.01 degrees:
 * OSC carries angles as 32-bit floats (about 2e-6 degrees of noise), which is far below anything a puck can resolve
 * but is enough to make heading-sensitive output flicker between two values.
 */
export function quantize(deg: number, detents: number | null): number {
  const a = ((deg % 360) + 360) % 360;
  if (!detents) return Math.round(a * 100) / 100 % 360;
  const step = 360 / detents;
  return (Math.round(a / step) % detents) * step;
}

/**
 * Turns the tracker's stable object stream into puck actions.
 * One placed object per role: a second object that maps to an occupied role is ignored until the first is lifted.
 * Unmapped objects (role null) are ignored. Position is the query location; angle is the role's parameter.
 */
export class PuckController {
  private owner = new Map<Role, number>(); // role -> tracker sid that owns it
  private last = new Map<Role, { x: number; y: number; deg: number }>(); // what the host last saw
  private ignored = new Set<number>();
  private suppressed = new Set<number>(); // sids released by the app; ignored until the object is lifted
  constructor(private host: PuckHost, private opt: PuckControllerOptions) {}

  handle(e: InputEvent): void {
    if (!('o' in e)) return;
    const o = e.o;
    if (o.role === null) return;
    const role = o.role;
    if (this.suppressed.has(o.sid)) { if (e.t === 'object:del') this.suppressed.delete(o.sid); return; }
    const deg = () => quantize(radToDeg(o.angleUnwrapped ?? o.angle), this.opt.detents(role));
    switch (e.t) {
      case 'object:add':
      case 'object:set': {
        const owner = this.owner.get(role);
        if (owner === undefined) {
          if (this.host.isOn(role)) { this.warnOnce(o, `role ${role} is already active locally`); return; }
          this.owner.set(role, o.sid);
          const d = deg();
          this.last.set(role, { x: o.x, y: o.y, deg: d });
          this.host.place(role, o.x, o.y, d);
        } else if (owner === o.sid) {
          // Many drivers re-send unchanged `set`s; every host.move recomputes the scenario, so skip no-ops.
          const d = deg(), l = this.last.get(role);
          if (l && Math.abs(l.x - o.x) < MOVE_EPS && Math.abs(l.y - o.y) < MOVE_EPS && l.deg === d) return;
          this.last.set(role, { x: o.x, y: o.y, deg: d });
          this.host.move(role, o.x, o.y, d);
        }
        else this.warnOnce(o, `second object (sid ${o.sid}) for role ${role}; ignoring`);
        return;
      }
      case 'object:del':
        if (this.owner.get(role) === o.sid) { this.owner.delete(role); this.last.delete(role); this.host.remove(role); }
        this.ignored.delete(o.sid);
        return;
    }
  }

  /**
   * End a role's scenario from the app side (Reset button, idle reset) while the physical object may still be on the table.
   * The object is then ignored until it is lifted, so it does not re-activate on its next jitter.
   */
  release(role: Role): void {
    const sid = this.owner.get(role);
    if (sid === undefined) return;
    this.owner.delete(role); this.last.delete(role);
    this.suppressed.add(sid);
    this.host.remove(role);
  }

  /** Release everything. */
  reset(): void {
    for (const role of [...this.owner.keys()]) this.release(role);
    this.ignored.clear();
  }

  private warnOnce(o: TableObject, msg: string) {
    if (this.ignored.has(o.sid)) return;
    this.ignored.add(o.sid);
    this.opt.log?.(msg);
  }
}
