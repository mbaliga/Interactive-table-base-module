import { createPipeline, defaultConfig, PointerSource, TuioWsSource, TAU, type InputEvent, type TableObject, type Cursor } from '@itable/input';

const q = new URLSearchParams(location.search);
const mode = q.get('source') ?? 'pointer';
const surface = document.getElementById('surface')!;
const layer = document.getElementById('layer')!;
const rolesEl = document.getElementById('roles')!;
const dev = document.getElementById('dev')!;
const cfg = defaultConfig;

// ---- source selection ---------------------------------------------------------------------
let tuio: TuioWsSource | undefined;
let source;
if (mode === 'tuio') {
  // the hub relays TUIO at /tuio on its own origin (the dev server proxies it); ?ws= points at a standalone bridge instead
  tuio = new TuioWsSource({ url: q.get('ws') ?? (location.host ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/tuio` : `ws://127.0.0.1:${cfg.link.wsPort}/tuio`) });
  source = tuio;
} else source = new PointerSource(surface, cfg);
const pipe = createPipeline({ source, config: cfg, transform: mode === 'tuio', log: (m) => pushLog(`! ${m}`) });

// ---- state mirrored from the stable stream ---------------------------------------------------
const objects = new Map<number, { o: TableObject; since: number }>();
const cursors = new Map<number, Cursor>();
const rawLog: string[] = [];
let rawCount = 0, rateWindow: number[] = [];
const pushLog = (s: string) => { rawLog.push(s); if (rawLog.length > 10) rawLog.shift(); };

pipe.onRaw((e) => {
  rawCount++; rateWindow.push(performance.now());
  const b = 'o' in e ? e.o : e.c;
  pushLog(`${e.t} sid=${b.sid}${'o' in e ? ` cid=${e.o.cid} a=${e.o.angle.toFixed(2)}` : ''} x=${b.x.toFixed(3)} y=${b.y.toFixed(3)}`);
});
pipe.on((e: InputEvent) => {
  if ('o' in e) {
    if (e.t === 'object:del') objects.delete(e.o.sid);
    else objects.set(e.o.sid, { o: e.o, since: objects.get(e.o.sid)?.since ?? performance.now() });
  } else if (e.t === 'cursor:del') cursors.delete(e.c.sid); else cursors.set(e.c.sid, e.c);
  render();
});

// ---- role bar (what each object will mean) ---------------------------------------------------
const fmt = (role: number, deg: number): string => {
  const d = cfg.objects.find((x) => x.role === role)!;
  const f = (((deg % 360) + 360) % 360) / 360, { min, max, detents } = d.rotation;
  if (role === 1) return ['today', '+1 day', '+2 days'][Math.min(2, Math.floor(f * 3))]!;
  if (role === 3) return `${Math.round(f * 360)}°`;
  if (role === 4) return `${Math.round(min + (max - min) * f * f)} m`;
  void detents;
  return (min + (max - min) * f).toFixed(role === 0 || role === 5 ? 1 : 0) + (role === 2 ? ' h' : role === 5 ? ' m' : '');
};
for (const d of cfg.objects) {
  const el = document.createElement('div');
  el.className = 'role'; el.dataset.r = String(d.role); el.id = `role-${d.role}`;
  el.innerHTML = `${d.label}<span class="v"></span>`;
  rolesEl.appendChild(el);
}

function render() {
  layer.replaceChildren();
  const W = surface.clientWidth, H = surface.clientHeight;
  const live = new Set<number>();
  for (const { o } of objects.values()) {
    if (o.role !== null) live.add(o.role);
    if (mode === 'pointer') continue; // tray tokens draw themselves
    const el = document.createElement('div');
    el.className = 'obj'; el.dataset.r = String(o.role);
    el.style.left = `${o.x * W}px`; el.style.top = `${o.y * H}px`; el.style.setProperty('--rot', `${o.angle}rad`);
    el.innerHTML = `<span class="lbl">${o.role === null ? `cid ${o.cid}` : cfg.objects.find((x) => x.role === o.role)!.key}</span>`;
    layer.appendChild(el);
  }
  for (const c of cursors.values()) {
    const el = document.createElement('div'); el.className = 'cur';
    el.style.left = `${c.x * W}px`; el.style.top = `${c.y * H}px`; layer.appendChild(el);
  }
  for (const d of cfg.objects) {
    const el = document.getElementById(`role-${d.role}`)!;
    const o = [...objects.values()].find((x) => x.o.role === d.role)?.o;
    el.classList.toggle('on', !!o);
    el.querySelector('.v')!.textContent = o ? fmt(d.role, ((o.angleUnwrapped ?? o.angle) * 180) / Math.PI) : '';
  }
  void live; void TAU;
}

// ---- dev overlay ------------------------------------------------------------------------------
let devOn = q.get('dev') !== '0' && (import.meta.env.DEV || q.get('dev') === '1');
const applyDev = () => (dev.hidden = !devOn);
addEventListener('keydown', (e) => { if (e.key === 'd' || e.key === 'D') { devOn = !devOn; applyDev(); } });
applyDev();
const link = { state: 'n/a' as string, udp: '', bridgeRate: 0 };
tuio?.onState((s) => (link.state = s));
tuio?.onStatus((m) => { link.udp = m.udp; link.bridgeRate = m.rate; });
tuio && (link.state = tuio.state);

setInterval(() => {
  const now = performance.now();
  rateWindow = rateWindow.filter((t) => now - t < 1000);
  if (!devOn) return;
  const dup = new Set(pipe.tracker.duplicateCids());
  const cls = (s: string) => (s === 'open' ? 'ok' : s === 'n/a' ? '' : 'bad');
  dev.innerHTML = `
    <h4>source</h4>${mode} · link <span class="${cls(link.state)}">${link.state}</span>${link.udp ? ` · udp <span class="${link.udp === 'listening' ? 'ok' : 'bad'}">${link.udp}</span>` : ''}
    <br>${rateWindow.length} msg/s${tuio ? ` · bridge ${link.bridgeRate} pkt/s` : ''} · total ${rawCount}
    <h4>objects (${objects.size})</h4>${[...objects.values()].map(({ o, since }) =>
      `sid ${o.sid} cid ${o.cid} role ${o.role ?? '<span class="warn">null</span>'}${dup.has(o.cid) ? ' <span class="bad">DUP CID</span>' : ''}<br>&nbsp; x ${o.x.toFixed(3)} y ${o.y.toFixed(3)} a ${o.angle.toFixed(2)} (${((o.angleUnwrapped ?? 0) / TAU).toFixed(2)} turns) · ${((now - since) / 1000).toFixed(1)}s`).join('<br>') || '—'}
    <h4>cursors (${cursors.size})</h4>${[...cursors.values()].map((c) => `sid ${c.sid} x ${c.x.toFixed(3)} y ${c.y.toFixed(3)}`).join('<br>') || '—'}
    <h4>last 10 raw</h4>${rawLog.map((l) => l.replace(/</g, '&lt;')).join('<br>') || '—'}
    <h4>keys</h4>D overlay · 1–6 place/remove · wheel or [ ] rotate`;
}, 100);

// ---- kiosk basics (full shell comes in M4) ----------------------------------------------------
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('gesturestart', (e) => e.preventDefault());
pipe.start();
(window as unknown as { __pipe: typeof pipe }).__pipe = pipe; // for tests / console
