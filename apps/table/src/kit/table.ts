import { defaultConfig, type InputEvent } from '@itable/input';
import { beep, sound, unlockAudio } from './audio';
import { createDevLog } from './devlog';
import { hubInfo, onHub } from './hub';
import { mountIdle } from './idle';
import { createAppInput, readMode, type PuckHost } from './input';
import { PuckLayer, rotationValue } from './pucks';
import { mountQr } from './qr';
import type { Puck, Scene, TableContext, TableOptions } from './types';

const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T;

/**
 * Start a table app. Expects the elements of apps/table/index.html (#stage, #canvas, #layer, #dock, #hint, #tools, #log).
 *
 *   createTable({ scenes: [spotlight, ripples], background: myMap });
 *
 * One input path for everything: the on-screen dock (default, for development and for tables without object tracking) or
 * TUIO objects from the hub (?source=tuio), both through the tracker (debounce, smoothing) to the scenes' place/move/remove.
 */
export function createTable(opts: TableOptions) {
  const W = opts.width ?? 1920, H = opts.height ?? 1080;
  const DEV = import.meta.env.DEV || /[?&]dev=1/.test(location.search);
  const stage = $('#stage'), cv = $<HTMLCanvasElement>('#canvas'), g = cv.getContext('2d')!;
  stage.style.width = W + 'px'; stage.style.height = H + 'px';
  const { mode, wsUrl, smooth } = readMode(location.search);
  const cfg = defaultConfig;

  /* ---- physical units: config panel size (mm) spans the whole stage ---- */
  const pxPerMm = W / cfg.panel.widthMm;
  const mm = (v: number) => v * pxPerMm, toMm = (px: number) => px / pxPerMm;

  /* ---- fit the logical stage to the screen; canvas resolution follows the device pixels (capped at 2x) ---- */
  let k = 1, Q = 1;
  function fit() {
    k = Math.min(innerWidth / W, innerHeight / H);
    document.documentElement.style.setProperty('--k', String(k));
    const q = Math.min(2, Math.max(1, Math.round(k * (window.devicePixelRatio || 1) * 2) / 2));
    if (q !== Q || cv.width !== W * q) { Q = q; cv.width = W * Q; cv.height = H * Q; }
  }
  addEventListener('resize', fit); fit();
  const toStage = (cx: number, cy: number) => { const r = stage.getBoundingClientRect(); return { x: (cx - r.left) / k, y: (cy - r.top) / k }; };

  /* ---- event bus ---- */
  const handlers = new Map<string, Set<(d: unknown) => void>>();
  const emit = (type: string, data?: unknown) => { for (const h of handlers.get(type) ?? []) { try { h(data); } catch (e) { console.warn(`[table] ${type} handler failed`, e); } } };
  const on = (type: string, fn: (d: unknown) => void) => { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type)!.add(fn); return () => handlers.get(type)!.delete(fn); };

  /* ---- pucks and their scenes ---- */
  const scenes = new Map<string, Scene>(opts.scenes.map((s) => [s.key, s]));
  for (const o of cfg.objects) if (!scenes.has(o.key)) console.warn(`[table] no scene for object "${o.key}" (cid ${o.cid}); it will show a ring and label only`);
  const pucks: Puck[] = [...cfg.objects].sort((a, b) => a.role - b.role).map((def) => ({ role: def.role, def, on: false, x: 0, y: 0, angle: 0, value: def.rotation.min, option: def.rotation.detents ? 0 : null, placedAt: 0, touchedAt: 0, state: {} }));
  const byRole = new Map(pucks.map((p) => [p.role, p]));
  const sceneOf = (p: Puck) => scenes.get(p.def.key);
  let time = 0;

  // `input` is assigned right below; the context only reads it lazily.
  // eslint-disable-next-line prefer-const
  let input: ReturnType<typeof createAppInput>;
  const t: TableContext = {
    W, H, g, mm, toMm, get time() { return time; }, pucks, puck: (key) => pucks.find((p) => p.def.key === key),
    get input() { return input; }, get hub() { return hubInfo(); }, emit, on,
    beep: (f, s) => beep(f, s),
    release: (key) => { const p = t.puck(key); if (p) input.controller.release(p.role); },
  };

  let idle: ReturnType<typeof mountIdle>;
  const setPose = (p: Puck, x: number, y: number, deg: number) => {
    p.x = x * W; p.y = y * H; p.angle = deg;
    const r = rotationValue(p.def, deg); p.value = r.value; p.option = r.option;
  };
  const host: PuckHost = {
    isOn: (r) => !!byRole.get(r)?.on,
    place(r, x, y, deg) {
      const p = byRole.get(r); if (!p) return;
      p.state = {}; setPose(p, x, y, deg); p.on = true; p.placedAt = p.touchedAt = performance.now();
      idle.notePlaced(r, p.x, p.y, deg); hint.classList.add('gone');
      sceneOf(p)?.place?.(p, t); layer.raise(viewOf(p)); layer.paint(viewOf(p));
      beep(660, 0.07); emit('puck:place', p);
    },
    move(r, x, y, deg) {
      const p = byRole.get(r); if (!p) return;
      const prevOption = p.option;
      setPose(p, x, y, deg);
      if (idle.noteMove(r, p.x, p.y, deg)) p.touchedAt = performance.now();
      if (p.option !== prevOption) beep(990, 0.04);
      sceneOf(p)?.move?.(p, t); layer.paint(viewOf(p)); emit('puck:move', p);
    },
    remove(r) {
      const p = byRole.get(r); if (!p) return;
      p.on = false; p.placedAt = p.touchedAt = 0; idle.noteLifted(r);
      sceneOf(p)?.remove?.(p, t); layer.paint(viewOf(p));
      beep(440, 0.07); emit('puck:remove', p);
    },
  };

  const log = createDevLog($('#log'), mode === 'sim' ? 'SIMULATED' : 'LIVE TUIO');
  input = createAppInput(host, { mode, wsUrl, smooth, onLog: (m) => console.warn('[input]', m) });
  input.pipeline.onRaw((e) => log.event(e));
  if (opts.onCursor) input.pipeline.on((e: InputEvent) => { if ('c' in e) opts.onCursor!(e, t); });

  const ringRadius = Math.max(70, mm(60)); // clears a 100 mm (4") puck with room for the ticks
  const layer = new PuckLayer($('#layer'), $('#dock'), pucks, scenes, {
    W, H, ringRadius, mode, dock: input.dock, toStage,
    defaultSpot: (i) => { const n = pucks.length, cols = Math.min(n, 4), row = Math.floor(i / cols), col = i % cols; return { x: W * (0.2 + (0.6 * (col + 0.5)) / cols), y: H * (0.3 + 0.3 * row) }; },
  });
  const viewOf = (p: Puck) => layer.views[pucks.indexOf(p)]!;

  /* ---- chrome: hint, tools, QR, idle ---- */
  const hint = $('#hint');
  hint.textContent = mode === 'tuio' ? (opts.hint?.tuio ?? 'Place an object on the table') : (opts.hint?.sim ?? 'Drag an object onto the table');
  if (mode === 'tuio') stage.classList.add('tuio');
  const qr = mountQr(stage);

  function reset() {
    qr.close();
    input.controller.reset();                       // lifts every puck; a physical object left down is ignored until it is lifted
    for (const p of pucks) if (input.dock?.isPlaced(p.role)) input.dock.del(p.role);
    for (const s of scenes.values()) s.reset?.(t);
    opts.background?.reset?.(t);
    hint.classList.remove('gone');
    emit('table:reset');
  }
  idle = mountIdle({
    stage, W, H, reset,
    attract: {
      title: mode === 'tuio' ? (opts.attract?.titleTuio ?? 'Place an object on the table') : (opts.attract?.title ?? 'Drag an object onto the table'),
      subtitle: opts.attract?.subtitle ?? 'or scan the code to play on your phone',
    },
    onAttract: (a) => emit('idle:attract', a),
    onAttractStep: (n) => opts.background?.attract?.(n, t),
  });

  $('#bSnd').addEventListener('click', (e) => { unlockAudio(); sound.on = !sound.on; (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(sound.on)); });
  $('#bLog').addEventListener('click', (e) => { const off = $('#log').classList.toggle('off'); (e.currentTarget as HTMLElement).setAttribute('aria-pressed', String(!off)); });
  $('#bRst').addEventListener('click', reset);
  if (!DEV) $('#bLog').style.display = 'none';
  window.addEventListener('pointerdown', unlockAudio, { capture: true, passive: true });
  onHub((h) => { if (h?.app?.name) document.title = h.app.name; });

  // taps on the bare surface go to the background (pucks, buttons and dialogs stop propagation or sit above the canvas)
  cv.addEventListener('pointerup', (e) => { const p = toStage(e.clientX, e.clientY); opts.background?.tap?.(p.x, p.y, t); });

  /* ---- frame loop ---- */
  const maxLabels = opts.maxLabels ?? 3;
  let last = performance.now(), uiT = 0;
  opts.background?.init?.(t);
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    for (const p of pucks) if (p.on) sceneOf(p)?.tick?.(p, t, dt);
    g.setTransform(Q, 0, 0, Q, 0, 0);
    g.clearRect(0, 0, W, H);
    opts.background?.draw(t, dt);
    for (const p of pucks) if (p.on) { g.save(); try { sceneOf(p)?.draw?.(p, t); } catch (e) { console.error(`[table] scene ${p.def.key} draw failed`, e); } g.restore(); }
    uiT += dt;
    if (uiT > 0.15) {
      uiT = 0;
      // only the most recently used pucks show their label, so a crowded table stays readable
      const shown = new Set(pucks.filter((p) => p.on).sort((a, b) => b.touchedAt - a.touchedAt).slice(0, maxLabels));
      for (const v of layer.views) {
        const p = v.puck, s = sceneOf(p);
        layer.setLabel(v, p.on ? (s?.label ? s.label(p, t) : p.def.label) : null, shown.has(p));
      }
      log.flush();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  input.pipeline.start();

  const api = { context: t, pucks, input, reset, idle, qr, emit, on, mm, toMm };
  // test / debugging hook: dev builds, or any build with ?dev=1
  if (DEV) (window as unknown as { __table: unknown }).__table = {
    ...api,
    /** Drive the simulated dock from tests: role, x/y 0..1, angle in degrees. */
    place: (role: number, x: number, y: number, deg = 0) => input.dock?.add(role, x, y, (deg * Math.PI) / 180),
    lift: (role: number) => input.dock?.del(role),
    state: () => pucks.map((p) => ({ key: p.def.key, on: p.on, x: p.x / W, y: p.y / H, angle: p.angle, value: p.value, option: p.option })),
  };
  return api;
}
