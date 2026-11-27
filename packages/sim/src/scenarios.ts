import { TuioSender } from './sender';

export type Scenario = (s: TuioSender) => Promise<void>;
const TAU = Math.PI * 2;
const FRAME = 33;

/** Run `fn(progress 0..1)` every frame for `ms`. */
async function over(s: TuioSender, ms: number, fn: (p: number) => void) {
  const n = Math.max(1, Math.round(ms / FRAME));
  for (let i = 0; i <= n; i++) { fn(i / n); await s.wait(FRAME); }
}

export const scenarios: Record<string, { about: string; run: Scenario }> = {
  'place-rotate': {
    about: 'Place object 0, rotate it through a full turn (crossing the 0/2π seam), remove it.',
    async run(s) {
      const sid = s.newSid();
      await over(s, 600, () => s.putObject(sid, 0, 0.5, 0.5, 5.8));
      await over(s, 1800, (p) => s.putObject(sid, 0, 0.5 + 0.1 * p, 0.5, (5.8 + p * TAU) % TAU));
      s.dropObject(sid); await s.wait(500);
    },
  },
  'six-objects': {
    about: 'All six objects placed at once, jiggled, then removed together.',
    async run(s) {
      const sids = [0, 1, 2, 3, 4, 5].map(() => s.newSid());
      const pos = (c: number) => ({ x: 0.15 + 0.14 * c, y: 0.3 + 0.08 * (c % 3) });
      sids.forEach((sid, c) => s.putObject(sid, c, pos(c).x, pos(c).y, c * 1.0));
      await s.wait(600);
      await over(s, 1500, (p) => sids.forEach((sid, c) => s.putObject(sid, c, pos(c).x, pos(c).y + 0.05 * Math.sin(p * TAU + c), (c + p * 3) % TAU)));
      sids.forEach((sid) => s.dropObject(sid)); await s.wait(500);
    },
  },
  'touch-and-objects': {
    about: 'Two people drag fingers while objects 3 and 4 move.',
    async run(s) {
      const a = s.newSid(), b = s.newSid(), c1 = s.newSid(), c2 = s.newSid();
      await over(s, 2000, (p) => {
        s.putObject(a, 3, 0.3 + 0.2 * p, 0.5, p * 2);
        s.putObject(b, 4, 0.7, 0.3 + 0.3 * p, 1 + p);
        s.putCursor(c1, 0.1 + 0.3 * p, 0.8); s.putCursor(c2, 0.9 - 0.3 * p, 0.2);
      });
      [a, b].forEach((x) => s.dropObject(x)); [c1, c2].forEach((x) => s.dropCursor(x)); await s.wait(500);
    },
  },
  flicker: {
    about: 'Object 1 drops out for 1-2 frames, repeatedly, and returns under a new session id each time.',
    async run(s) {
      let sid = s.newSid();
      s.putObject(sid, 1, 0.4, 0.5, 1); await s.wait(400);
      for (let i = 0; i < 8; i++) {
        s.dropObject(sid); await s.wait(FRAME * (1 + (i % 2)));
        sid = s.newSid(); s.putObject(sid, 1, 0.4 + 0.01 * i, 0.5, 1); await s.wait(300);
      }
      s.dropObject(sid); await s.wait(600);
    },
  },
  'return-100': {
    about: 'Object 2 removed and returned within 100 ms (should be one placement).',
    async run(s) {
      let sid = s.newSid(); s.putObject(sid, 2, 0.5, 0.5, 0); await s.wait(500);
      s.dropObject(sid); await s.wait(100);
      sid = s.newSid(); s.putObject(sid, 2, 0.5, 0.5, 0); await s.wait(500);
      s.dropObject(sid); await s.wait(500);
    },
  },
  'return-400': {
    about: 'Object 2 removed and returned after 400 ms (should be removal, then a new placement).',
    async run(s) {
      let sid = s.newSid(); s.putObject(sid, 2, 0.5, 0.5, 0); await s.wait(500);
      s.dropObject(sid); await s.wait(400);
      sid = s.newSid(); s.putObject(sid, 2, 0.5, 0.5, 0); await s.wait(500);
      s.dropObject(sid); await s.wait(500);
    },
  },
};
