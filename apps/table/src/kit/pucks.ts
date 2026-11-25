import type { ObjectDef } from '@itable/input';
import type { SimDockSource } from './input';
import type { Puck, Scene } from './types';

const PALETTE = ['#4fd6ff', '#7bf0b0', '#ffd166', '#ff5d8f', '#b69cff', '#ff9b54', '#5ee0c8', '#f7a1ff'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Map a (snapped) angle onto the object's rotation range. */
export function rotationValue(def: ObjectDef, angle: number): { value: number; option: number | null } {
  const r = def.rotation, n = r.detents;
  if (n && n > 0) {
    const option = Math.round(angle / (360 / n)) % n;
    return { option, value: n > 1 ? r.min + (option * (r.max - r.min)) / (n - 1) : r.min };
  }
  return { option: null, value: r.min + ((((angle % 360) + 360) % 360) / 360) * (r.max - r.min) };
}

export interface PuckView {
  puck: Puck;
  scene: Scene | undefined;
  color: string;
  el: HTMLElement;
  cap: HTMLElement;
  knob: SVGGElement;
  dockX: number;
}

export interface PuckLayerOptions {
  W: number; H: number;
  ringRadius: number;
  mode: 'sim' | 'tuio';
  dock: SimDockSource | null;
  /** Convert a client (screen) point into stage pixels. */
  toStage(clientX: number, clientY: number): { x: number; y: number };
  /** Where a tapped docked puck lands (stage px). */
  defaultSpot(i: number): { x: number; y: number };
}

/**
 * DOM for the pucks: a ring with ticks (and option labels for detent objects) around each placed object, a label capsule, and,
 * in simulated mode, the on-screen dock. Dock gestures go into the SimDockSource, i.e. through the same input pipeline as TUIO;
 * nothing here changes puck state directly.
 */
export class PuckLayer {
  readonly views: PuckView[] = [];
  readonly dockTop: number;
  private z = 10;
  constructor(private layer: HTMLElement, private dockEl: HTMLElement, pucks: Puck[], scenes: Map<string, Scene>, private o: PuckLayerOptions) {
    this.dockTop = o.H - 128;
    const n = pucks.length, gap = Math.min(150, (o.W * 0.6) / Math.max(1, n));
    pucks.forEach((p, i) => {
      const scene = scenes.get(p.def.key), color = scene?.color ?? PALETTE[i % PALETTE.length]!;
      const dockX = o.W / 2 + (i - (n - 1) / 2) * gap;
      if (o.mode === 'sim') {
        const slot = document.createElement('div'); slot.className = 'slot'; slot.style.left = dockX + 'px';
        slot.innerHTML = `<span>${esc(p.def.label)}</span>`; dockEl.appendChild(slot);
      }
      const el = document.createElement('div');
      el.className = 'pk docked'; el.style.setProperty('--a', color); el.dataset.key = p.def.key;
      el.innerHTML = `<div class="ring">${this.ringSvg(p.def, scene)}</div><div class="cap"><b>${esc(p.def.label)}</b><span></span></div>` +
        `<div class="disc" tabindex="0" role="button" aria-label="${esc(p.def.label)} object"><i></i></div>`;
      layer.appendChild(el);
      const v: PuckView = { puck: p, scene, color, el, cap: el.querySelector('.cap')!, knob: el.querySelector('.knob')!, dockX };
      this.views.push(v);
      if (o.mode === 'sim') this.wire(v, i);
      this.paint(v);
    });
    if (o.mode === 'tuio') { dockEl.style.display = 'none'; layer.classList.add('tuio'); }
  }

  private ringSvg(def: ObjectDef, scene: Scene | undefined): string {
    const R = this.o.ringRadius, n = def.rotation.detents || 24;
    let ticks = '';
    for (let k = 0; k < n; k++) ticks += `<line x1="0" y1="${-R + 4}" x2="0" y2="${-R - 6}" transform="rotate(${(k * 360) / n})"/>`;
    let opts = '';
    if (def.rotation.detents && scene?.options) {
      scene.options.slice(0, def.rotation.detents).forEach((t, k) => {
        const a = ((k * 360) / def.rotation.detents! - 90) * (Math.PI / 180), r = R + 26;
        opts += `<text class="opt" data-k="${k}" x="${(Math.cos(a) * r).toFixed(1)}" y="${(Math.sin(a) * r).toFixed(1)}" text-anchor="middle" dominant-baseline="central">${esc(t)}</text>`;
      });
    }
    const S = R + 60;
    return `<svg viewBox="${-S} ${-S} ${2 * S} ${2 * S}" width="${2 * S}" height="${2 * S}"><circle class="rc" r="${R}"/><g class="tk">${ticks}</g>${opts}` +
      `<g class="knob"><circle class="hit" cx="0" cy="${-R}" r="24"/><circle class="kh" cx="0" cy="${-R}" r="9"/></g></svg>`;
  }

  /** Bring the DOM in line with the puck state (cheap; call after every change). */
  paint(v: PuckView): void {
    const p = v.puck;
    const x = p.on ? p.x : v.dockX, y = p.on ? p.y : this.dockTop + 58;
    v.el.style.transform = `translate(${x}px, ${y}px)`;
    v.el.classList.toggle('docked', !p.on);
    v.knob.setAttribute('transform', `rotate(${p.angle})`);
    v.el.querySelector<HTMLElement>('.disc i')!.style.transform = `rotate(${p.angle}deg)`;
    v.el.querySelectorAll('.opt').forEach((t) => t.classList.toggle('sel', p.option !== null && Number((t as SVGElement).dataset.k) === p.option));
  }

  /** Put the label capsule on the side of the puck that faces the middle of the table, and keep it on screen. */
  setLabel(v: PuckView, text: string | null, show: boolean): void {
    const span = v.cap.querySelector('span')!;
    if (span.textContent !== (text ?? '')) span.textContent = text ?? '';
    const vis = show && v.puck.on;
    v.cap.classList.toggle('on', vis);
    if (!vis) return;
    const R = this.o.ringRadius + 18, w = v.cap.offsetWidth || 220, h = v.cap.offsetHeight || 60;
    const right = v.puck.x < this.o.W / 2;
    let dx = right ? R : -R - w, dy = -h / 2;
    const ax = v.puck.x + dx, ay = v.puck.y + dy;
    if (ax < 8) dx += 8 - ax; if (ax + w > this.o.W - 8) dx -= ax + w - (this.o.W - 8);
    if (ay < 8) dy += 8 - ay; if (ay + h > this.o.H - 8) dy -= ay + h - (this.o.H - 8);
    v.cap.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  raise(v: PuckView): void { v.el.style.zIndex = String(++this.z); }

  /* ---- simulated mode: the on-screen dock -------------------------------------------------------------------------- */
  private wire(v: PuckView, i: number): void {
    const dock = this.o.dock!, role = v.puck.role, disc = v.el.querySelector<HTMLElement>('.disc')!;
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const send = (x: number, y: number, deg: number) => (dock.isPlaced(role) ? dock.set(role, x / this.o.W, y / this.o.H, rad(deg)) : dock.add(role, x / this.o.W, y / this.o.H, rad(deg)));
    const step = () => 360 / (v.puck.def.rotation.detents || 72);

    // drag the disc: out of the dock places it, back into the dock lifts it; a tap on a docked puck places it at its default spot
    disc.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); disc.setPointerCapture(e.pointerId); this.raise(v);
      const start = this.o.toStage(e.clientX, e.clientY), from = { x: v.puck.on ? v.puck.x : v.dockX, y: v.puck.on ? v.puck.y : this.dockTop + 58 };
      let moved = false;
      const mv = (ev: PointerEvent) => {
        const q = this.o.toStage(ev.clientX, ev.clientY), x = from.x + q.x - start.x, y = from.y + q.y - start.y;
        if (!moved && Math.hypot(q.x - start.x, q.y - start.y) < 6) return;
        moved = true; v.el.classList.add('drag');
        if (y < this.dockTop) send(clamp(x, 0, this.o.W), clamp(y, 0, this.o.H), v.puck.angle);
        else { if (dock.isPlaced(role)) dock.del(role); v.el.style.transform = `translate(${x}px, ${y}px)`; }
      };
      const up = () => {
        disc.removeEventListener('pointermove', mv); disc.removeEventListener('pointerup', up); disc.removeEventListener('pointercancel', up);
        v.el.classList.remove('drag');
        if (!moved && !dock.isPlaced(role)) { const s = this.o.defaultSpot(i); send(s.x, s.y, v.puck.angle); }
        this.paint(v);
      };
      disc.addEventListener('pointermove', mv); disc.addEventListener('pointerup', up); disc.addEventListener('pointercancel', up);
    });

    // rotate: drag the knob on the ring, the mouse wheel over the puck, or the arrow keys when it has focus
    const knob = v.el.querySelector<SVGGElement>('.knob')!;
    knob.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation(); (knob as unknown as Element).setPointerCapture(e.pointerId);
      const mv = (ev: PointerEvent) => {
        const q = this.o.toStage(ev.clientX, ev.clientY);
        const deg = ((Math.atan2(q.x - v.puck.x, -(q.y - v.puck.y)) * 180) / Math.PI + 360) % 360;
        send(v.puck.x, v.puck.y, deg);
      };
      const up = () => { knob.removeEventListener('pointermove', mv); knob.removeEventListener('pointerup', up); knob.removeEventListener('pointercancel', up); };
      knob.addEventListener('pointermove', mv); knob.addEventListener('pointerup', up); knob.addEventListener('pointercancel', up);
    });
    v.el.addEventListener('wheel', (e) => {
      if (!v.puck.on) return;
      e.preventDefault();
      send(v.puck.x, v.puck.y, (v.puck.angle + Math.sign(e.deltaY) * step() + 360) % 360);
    }, { passive: false });
    disc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (v.puck.on) dock.del(role); else { const s = this.o.defaultSpot(i); send(s.x, s.y, v.puck.angle); } this.paint(v); return; }
      if (!v.puck.on) return;
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (d) { e.preventDefault(); send(v.puck.x, v.puck.y, (v.puck.angle + d * step() + 360) % 360); }
    });
  }
}

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
