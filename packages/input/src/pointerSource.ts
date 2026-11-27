import type { InputEvent, InputSource, TableObject } from './types';
import { wrapAngle } from './types';
import type { TableConfig } from './config';

/**
 * Browser source for desktop testing. Pointer Events -> cursors (multi-touch), plus a dock of six
 * draggable tokens that behave like tangible objects:
 *   drag token       move (drop it back on the dock to remove)
 *   ring knob / wheel / [ ] keys   rotate
 *   keys 1-6         place at centre / remove
 * Emits surface-normalised coordinates, so run it with `transform: false`.
 */
export class PointerSource implements InputSource {
  private listeners = new Set<(e: InputEvent) => void>();
  private cleanup: Array<() => void> = [];
  private tokens = new Map<number, { el: HTMLElement; o: TableObject | null; rawSid: number }>();
  private nextSid = 1000;
  private dock?: HTMLElement;

  constructor(private surface: HTMLElement, private cfg: TableConfig, private opts: { tray?: boolean } = {}) {}

  on(fn: (e: InputEvent) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: InputEvent) { for (const l of this.listeners) l(e); }

  private norm(ev: { clientX: number; clientY: number }) {
    const r = this.surface.getBoundingClientRect();
    return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
  }
  private listen<K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: string, fn: (e: any) => void, opt?: AddEventListenerOptions) {
    el.addEventListener(type, fn, opt);
    this.cleanup.push(() => el.removeEventListener(type, fn, opt));
  }

  start() {
    const s = this.surface;
    s.style.touchAction = 'none';
    const active = new Set<number>();
    this.listen(s, 'pointerdown', (ev: PointerEvent) => {
      if ((ev.target as HTMLElement).closest('.tok,.dock')) return;
      s.setPointerCapture?.(ev.pointerId);
      active.add(ev.pointerId);
      this.emit({ t: 'cursor:add', c: { sid: ev.pointerId, ...this.norm(ev) } });
    });
    this.listen(s, 'pointermove', (ev: PointerEvent) => {
      if (active.has(ev.pointerId)) this.emit({ t: 'cursor:set', c: { sid: ev.pointerId, ...this.norm(ev) } });
    });
    const up = (ev: PointerEvent) => {
      if (!active.delete(ev.pointerId)) return;
      this.emit({ t: 'cursor:del', c: { sid: ev.pointerId, ...this.norm(ev) } });
    };
    this.listen(s, 'pointerup', up); this.listen(s, 'pointercancel', up);
    if (this.opts.tray !== false) this.buildTray();
  }

  stop() {
    for (const c of this.cleanup.splice(0)) c();
    this.dock?.remove(); this.dock = undefined;
    for (const t of this.tokens.values()) { t.el.remove(); }
    this.tokens.clear();
  }

  // ---- tray -------------------------------------------------------------------------------
  private buildTray() {
    const dock = document.createElement('div');
    dock.className = 'dock';
    this.dock = dock;
    this.cfg.objects.forEach((def, i) => {
      const el = document.createElement('div');
      el.className = 'tok'; el.dataset.role = String(def.role); el.dataset.cid = String(def.cid);
      el.title = `${i + 1}: ${def.label}`;
      el.innerHTML = `<span class="num">${i + 1}</span><span class="knob"></span>`;
      dock.appendChild(el);
      this.tokens.set(def.cid, { el, o: null, rawSid: this.nextSid++ });
      this.wireToken(def.cid);
    });
    this.surface.appendChild(dock);
    this.listen(window, 'keydown', (ev: KeyboardEvent) => {
      const n = Number(ev.key);
      if (n >= 1 && n <= this.cfg.objects.length) this.toggle(this.cfg.objects[n - 1]!.cid);
      if (ev.key === '[' || ev.key === ']') this.rotateHovered(ev.key === ']' ? 0.1 : -0.1);
    });
  }

  private toggle(cid: number) {
    const t = this.tokens.get(cid)!;
    if (t.o) this.remove(cid); else this.place(cid, 0.5, 0.5, 0);
  }

  private place(cid: number, x: number, y: number, angle: number) {
    const t = this.tokens.get(cid)!;
    t.rawSid = this.nextSid++;
    t.o = { sid: t.rawSid, cid, role: null, x, y, angle };
    this.draw(cid);
    this.emit({ t: 'object:add', o: t.o });
  }

  private move(cid: number, x: number, y: number, angle: number) {
    const t = this.tokens.get(cid)!;
    if (!t.o) return;
    t.o = { ...t.o, x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)), angle: wrapAngle(angle) };
    this.draw(cid);
    this.emit({ t: 'object:set', o: t.o });
  }

  private remove(cid: number) {
    const t = this.tokens.get(cid)!;
    if (!t.o) return;
    const o = t.o; t.o = null;
    this.draw(cid);
    this.emit({ t: 'object:del', o });
  }

  private draw(cid: number) {
    const t = this.tokens.get(cid)!;
    const o = t.o;
    if (!o) { t.el.classList.remove('placed'); t.el.style.left = ''; t.el.style.top = ''; t.el.style.transform = ''; this.dock!.appendChild(t.el); return; }
    if (t.el.parentElement !== this.surface) this.surface.appendChild(t.el);
    t.el.classList.add('placed');
    t.el.style.left = `${o.x * 100}%`; t.el.style.top = `${o.y * 100}%`;
    t.el.style.transform = `translate(-50%,-50%) rotate(${o.angle}rad)`;
  }

  private hovered: number | null = null;
  private rotateHovered(d: number) {
    const t = this.hovered !== null ? this.tokens.get(this.hovered) : undefined;
    if (t?.o) this.move(t.o.cid, t.o.x, t.o.y, t.o.angle + d);
  }

  private wireToken(cid: number) {
    const t = this.tokens.get(cid)!;
    const el = t.el;
    el.addEventListener('pointerenter', () => (this.hovered = cid));
    el.addEventListener('pointerleave', () => { if (this.hovered === cid) this.hovered = null; });
    el.addEventListener('wheel', (ev) => { ev.preventDefault(); if (t.o) this.move(cid, t.o.x, t.o.y, t.o.angle + Math.sign(ev.deltaY) * 0.1); }, { passive: false });
    el.addEventListener('pointerdown', (ev: PointerEvent) => {
      ev.preventDefault();
      const id = ev.pointerId;
      const onKnob = (ev.target as HTMLElement).classList.contains('knob');
      if (!t.o) { const p = this.norm(ev); this.place(cid, p.x, p.y, 0); }
      // Window-level listeners: place() reparents the token, which would drop pointer capture.
      const mv = (m: PointerEvent) => {
        if (m.pointerId !== id) return;
        const p = this.norm(m);
        if (onKnob && t.o) {
          // knob sits at the top of the token (angle 0, clockwise): point it at the pointer
          this.move(cid, t.o.x, t.o.y, Math.atan2(p.x - t.o.x, -(p.y - t.o.y) * this.aspect()));
        } else this.move(cid, p.x, p.y, t.o?.angle ?? 0);
      };
      const end = (u: PointerEvent) => {
        if (u.pointerId !== id) return;
        window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
        const d = this.dock!.getBoundingClientRect();
        if (!onKnob && u.clientY >= d.top && u.clientX >= d.left && u.clientX <= d.right) this.remove(cid);
      };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
      this.cleanup.push(() => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); });
    });
  }
  private aspect() { const r = this.surface.getBoundingClientRect(); return r.height / r.width; }
}
