import type { Background } from '../kit';

/* Demo backdrop: a calm grid with the app name and a ripple wherever the surface is tapped. Replace with your own
   (a map, a floor plan, a timeline...). Draw in stage pixels; t.W x t.H is the whole table. */
const taps: Array<{ x: number; y: number; t: number }> = [];
let title = 'Interactive Table';
let glow = { x: 0.5, y: 0.45 };

export const demoBackground: Background = {
  init(t) { t.on('table:reset', () => { taps.length = 0; }); },
  draw(t) {
    const { g, W, H } = t;
    if (t.hub?.app.name) title = t.hub.app.name;
    const grad = g.createRadialGradient(W * glow.x, H * glow.y, 0, W * glow.x, H * glow.y, W * 0.7);
    grad.addColorStop(0, '#13243a'); grad.addColorStop(1, '#070b12');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    // 50 mm grid: physical units, so the grid has the same real size on any panel (config/table.config.json `panel`)
    const step = t.mm(50);
    g.strokeStyle = 'rgba(255,255,255,0.05)'; g.lineWidth = 1; g.beginPath();
    for (let x = step; x < W; x += step) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (let y = step; y < H; y += step) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();
    g.fillStyle = 'rgba(232,238,245,0.16)'; g.font = '600 72px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(title, W / 2, H * 0.12);
    for (let i = taps.length - 1; i >= 0; i--) {
      const tp = taps[i]!, age = t.time - tp.t;
      if (age > 1.2) { taps.splice(i, 1); continue; }
      g.strokeStyle = `rgba(79,214,255,${(1 - age / 1.2) * 0.8})`; g.lineWidth = 3;
      g.beginPath(); g.arc(tp.x, tp.y, 20 + age * 160, 0, Math.PI * 2); g.stroke();
    }
  },
  tap(x, y, t) { taps.push({ x, y, t: t.time }); t.beep(1320, 0.05); },
  // attract screen: drift the light around so the table looks alive from across the room
  attract(step) { const spots = [[0.5, 0.45], [0.25, 0.35], [0.75, 0.6], [0.4, 0.7], [0.65, 0.3]] as const; const s = spots[step % spots.length]!; glow = { x: s[0], y: s[1] }; },
  reset() { glow = { x: 0.5, y: 0.45 }; },
};
