import type { Puck, Scene } from '../kit';

/* Six example scenes, one per object in config/table.config.json. Each shows one technique:
     spotlight  rotation as a continuous value (radius)            selector  detents with option labels
     ripples    per-puck animation state in p.state                probe     physical units (mm) and heading
     pin-a/b    two pucks working together (distance between them)
   Copy one as the starting point for your own. */

const TAU = Math.PI * 2;

export const spotlight: Scene = {
  key: 'spotlight', color: '#ffd166',
  draw(p, { g }) {
    const r = p.value;
    const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, 'rgba(255,209,102,0.55)'); grad.addColorStop(1, 'rgba(255,209,102,0)');
    g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
  },
  label: (p, t) => `Radius ${Math.round(t.toMm(p.value))} mm\nTurn to resize`,
};

const COLOURS = ['#ff5d8f', '#7bf0b0', '#6a9bff'];
export const selector: Scene = {
  key: 'selector', color: '#ff5d8f', options: ['Red', 'Green', 'Blue'],
  draw(p, { g, W, H }) {
    g.globalAlpha = 0.12; g.fillStyle = COLOURS[p.option ?? 0]!; g.fillRect(0, 0, W, H);
  },
  label: (p) => `${selector.options![p.option ?? 0]} selected\nTurn to choose`,
};

interface Ring { born: number }
export const ripples: Scene = {
  key: 'ripples', color: '#7bf0b0',
  place(p) { p.state.rings = [] as Ring[]; p.state.next = 0; },
  tick(p, t) {
    const rings = p.state.rings as Ring[];
    if (t.time >= (p.state.next as number)) { rings.push({ born: t.time }); p.state.next = t.time + 1 / p.value; }
    while (rings.length && t.time - rings[0]!.born > 3) rings.shift();
  },
  draw(p, { g, time }) {
    for (const r of p.state.rings as Ring[]) {
      const age = time - r.born;
      g.strokeStyle = `rgba(123,240,176,${(1 - age / 3) * 0.7})`; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 60 + age * 140, 0, TAU); g.stroke();
    }
  },
  label: (p) => `${p.value.toFixed(1)} ripples per second`,
};

export const probe: Scene = {
  key: 'probe', color: '#4fd6ff',
  draw(p, { g, W, H }) {
    const a = ((p.angle - 90) * Math.PI) / 180, len = Math.hypot(W, H);
    g.strokeStyle = 'rgba(79,214,255,0.6)'; g.lineWidth = 2; g.setLineDash([10, 8]);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len); g.stroke();
  },
  label: (p, t) => `x ${Math.round(t.toMm(p.x))} mm · y ${Math.round(t.toMm(p.y))} mm\nHeading ${Math.round(p.angle)}°`,
};

function pin(key: string, other: string, color: string): Scene {
  return {
    key, color,
    draw(p, t) {
      const g = t.g, o = t.puck(other);
      g.fillStyle = color; g.beginPath(); g.arc(p.x, p.y, 10 + p.value * 30, 0, TAU); g.fill();
      if (o?.on && key < other) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(o.x, o.y); g.stroke(); }
    },
    label(p, t) { const o = t.puck(other); return o?.on ? `${Math.round(t.toMm(dist(p, o)))} mm to ${o.def.label}` : `Place ${t.puck(other)?.def.label ?? 'the other pin'} too`; },
  };
}
const dist = (a: Puck, b: Puck) => Math.hypot(a.x - b.x, a.y - b.y);

export const demoScenes: Scene[] = [spotlight, selector, ripples, probe, pin('pin-a', 'pin-b', '#b69cff'), pin('pin-b', 'pin-a', '#ff9b54')];
