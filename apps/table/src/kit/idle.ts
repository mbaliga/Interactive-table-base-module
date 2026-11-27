import { onHub } from './hub';

/* ============ idle reset and attract mode ============
   After `seconds` with nobody at the table (no touch, no key, no puck placed, lifted or deliberately moved) the table starts over
   (the app's reset) and shows an invitation until someone touches it or places a puck. The last 15 s are counted down so nobody is
   surprised. The time comes from the hub (idleSeconds in hub.config.json, default 90); ?idle=N in the URL wins (0 = never). */
export interface IdleOptions {
  stage: HTMLElement;
  /** Logical stage size, to turn normalised puck motion into pixels. */
  W: number; H: number;
  reset(): void;
  attract: { title: string; subtitle: string };
  /** Called every `stepSeconds` while the attract screen shows. */
  onAttractStep?(step: number): void;
  onAttract?(on: boolean): void;
  stepSeconds?: number;
}

const COUNTDOWN_S = 15;

export function mountIdle(o: IdleOptions) {
  const q = new URLSearchParams(location.search), fromUrl = q.get('idle');
  const urlWins = fromUrl !== null && fromUrl !== '' && !isNaN(+fromUrl);
  let seconds = urlWins ? +fromUrl! : 90;
  const step = o.stepSeconds ?? 12;

  o.stage.insertAdjacentHTML('beforeend',
    '<div id="attract"><b></b><span></span></div>' +
    '<div id="idlecd"><span>Starting over in <b></b> s</span><em>Touch to keep going</em></div>');
  const attractEl = o.stage.querySelector<HTMLElement>('#attract')!, countEl = o.stage.querySelector<HTMLElement>('#idlecd')!;
  attractEl.querySelector('b')!.textContent = o.attract.title;
  attractEl.querySelector('span')!.textContent = o.attract.subtitle;

  let last = performance.now(), attract = false, t = 0, n = 0;

  function noteActivity() {
    last = performance.now();
    countEl.classList.remove('on');
    if (attract) { attract = false; attractEl.classList.remove('on'); document.body.classList.remove('attract'); o.onAttract?.(false); }
  }
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart'])
    window.addEventListener(ev, noteActivity, { capture: true, passive: true });

  /** Placing and lifting are always activity; a puck only counts as moved when it travels about 16 px or turns 3 degrees from where
   *  it was last counted, so a resting puck's sensor noise never keeps the table awake. */
  const lastPos = new Map<number, { x: number; y: number; a: number }>();
  const notePlaced = (role: number, x: number, y: number, deg: number) => { lastPos.set(role, { x, y, a: deg }); noteActivity(); };
  const noteLifted = (role: number) => { lastPos.delete(role); noteActivity(); };
  /** x, y in stage pixels. Returns true when this counts as a deliberate move. */
  function noteMove(role: number, x: number, y: number, deg: number): boolean {
    const l = lastPos.get(role);
    const da = l ? Math.abs(((deg - l.a + 540) % 360) - 180) : Infinity;
    if (!l || Math.hypot(x - l.x, y - l.y) > 16 || da > 3) { lastPos.set(role, { x, y, a: deg }); noteActivity(); return true; }
    return false;
  }

  function enterAttract() {
    attract = true; t = 0; n = 0;
    attractEl.classList.add('on'); document.body.classList.add('attract');
    o.onAttract?.(true); o.onAttractStep?.(0);
  }

  setInterval(() => {
    if (attract) { t += 0.25; if (t >= step) { t = 0; o.onAttractStep?.(++n); } return; }
    if (!seconds) return;
    const remaining = seconds - (performance.now() - last) / 1000;
    if (remaining <= 0) { countEl.classList.remove('on'); o.reset(); enterAttract(); return; }
    if (remaining <= Math.min(COUNTDOWN_S, seconds / 2)) { countEl.querySelector('b')!.textContent = String(Math.ceil(remaining)); countEl.classList.add('on'); }
  }, 250);

  if (!urlWins) onHub((h) => { if (typeof h?.ui?.idleSeconds === 'number') seconds = h.ui.idleSeconds; });

  return {
    noteActivity, notePlaced, noteLifted, noteMove,
    get seconds() { return seconds; },
    get attract() { return attract; },
  };
}
