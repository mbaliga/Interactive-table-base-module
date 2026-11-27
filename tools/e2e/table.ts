// The table in simulated mode with REAL mouse/keyboard gestures on the on-screen dock, the label limit, Reset, and the idle reset.
//   pnpm e2e        (needs `pnpm build`)
import { check, finish, launch, sleep, startHub, watchErrors } from './lib';

const srv = await startHub();
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = watchErrors(page);
const st = () => page.evaluate(() => (window as any).__table.state());
const W = 1920, H = 1080;
try {
  await page.goto(`${srv.base}/table/?dev=1&idle=12`);
  await page.waitForFunction(() => !!(window as any).__table);
  check('table loads with six docked pucks and the hint', (await page.locator('#dock .slot').count()) === 6 && (await page.locator('#hint:not(.gone)').count()) === 1);
  check('the app name comes from the hub (app.json)', (await page.title()) === 'Interactive Table', await page.title());

  // stage -> screen coordinates (the stage is scaled to fit and centred)
  const box = (await page.locator('#stage').boundingBox())!; const k = box.width / W;
  const scr = (x: number, y: number) => ({ x: box.x + x * k, y: box.y + y * k });
  const discCentre = async (key: string) => { const b = (await page.locator(`.pk[data-key="${key}"] .disc`).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

  // 1. drag the probe out of the dock onto the table
  let c = await discCentre('probe'); const to = scr(0.4 * W, 0.45 * H);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 }); await page.mouse.up();
  let s = (await st()).find((p: any) => p.key === 'probe');
  check('dragging a puck out of the dock places it where it is dropped', s.on && Math.abs(s.x - 0.4) < 0.01 && Math.abs(s.y - 0.45) < 0.01, JSON.stringify(s));
  check('placing hides the hint', (await page.locator('#hint.gone').count()) === 1);

  // 2. rotate it with the knob: drag the knob to the right of the puck (90 degrees)
  const knob = (await page.locator('.pk[data-key="probe"] .knob .kh').boundingBox())!;
  const right = scr(0.4 * W + 200, 0.45 * H);
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2); await page.mouse.down(); await page.mouse.move(right.x, right.y, { steps: 8 }); await page.mouse.up();
  s = (await st()).find((p: any) => p.key === 'probe');
  check('dragging the knob turns the puck (90 degrees)', Math.abs(s.angle - 90) < 1, String(s.angle));

  // 3. keyboard: focus the docked selector, Enter places it; arrows step through its 3 detents
  await page.locator('.pk[data-key="selector"] .disc').focus(); await page.keyboard.press('Enter');
  s = (await st()).find((p: any) => p.key === 'selector');
  check('Enter on a focused docked puck places it', s.on, JSON.stringify(s));
  await page.keyboard.press('ArrowRight'); s = (await st()).find((p: any) => p.key === 'selector');
  check('an arrow key steps a detent puck to its next option (120 degrees, option 1)', s.angle === 120 && s.option === 1 && s.value === 1, JSON.stringify(s));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); s = (await st()).find((p: any) => p.key === 'selector');
  check('and wraps around (option 2)', s.angle === 240 && s.option === 2, JSON.stringify(s));
  check('the selected option label is highlighted on the ring', (await page.locator('.pk[data-key="selector"] .opt.sel').textContent()) === 'Blue');

  // 4. the mouse wheel turns a continuous puck
  c = await discCentre('probe'); await page.mouse.move(c.x, c.y); const before = (await st()).find((p: any) => p.key === 'probe').angle;
  await page.mouse.wheel(0, 100); await sleep(100);
  check('the wheel turns a placed puck', (await st()).find((p: any) => p.key === 'probe').angle !== before);

  // 5. a tap on a docked puck places it at its default spot; six pucks down -> at most 3 label capsules
  for (const key of ['spotlight', 'ripples', 'pin-a', 'pin-b']) { const d = await discCentre(key); await page.mouse.click(d.x, d.y); }
  await sleep(500);
  check('tapping docked pucks places them', (await st()).every((p: any) => p.on), JSON.stringify((await st()).map((p: any) => p.on)));
  check('only the 3 most recently used pucks show their label', (await page.locator('.cap.on').count()) === 3, String(await page.locator('.cap.on').count()));
  const pinLabel = await page.locator('.pk[data-key="pin-b"] .cap span').textContent();
  check('scenes can read each other (pin distance in mm)', /\d+ mm to Pin A/.test(pinLabel ?? ''), pinLabel ?? '');

  // 6. drag the probe back into the dock: lifted
  c = await discCentre('probe'); const dockPt = scr(W / 2, H - 50);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(dockPt.x, dockPt.y, { steps: 12 }); await page.mouse.up();
  check('dragging a puck back into the dock lifts it', !(await st()).find((p: any) => p.key === 'probe').on);

  // 7. a tap on the bare table goes to the background without errors
  const bare = scr(0.9 * W, 0.15 * H); await page.mouse.click(bare.x, bare.y);

  // 8. Reset lifts everything
  await page.click('#bRst'); await sleep(200);
  check('Reset lifts every puck and shows the hint again', (await st()).every((p: any) => !p.on) && (await page.locator('#hint:not(.gone)').count()) === 1);

  // 9. idle reset (?idle=12): countdown, then everything lifted and the attract screen; a touch brings the table back
  await page.evaluate(() => (window as any).__table.place(0, 0.5, 0.5, 0));
  await page.mouse.move(5, 5); // last activity
  await page.waitForSelector('#idlecd.on', { timeout: 15000 });
  check('the idle countdown appears before the reset', true);
  await page.waitForSelector('#attract.on', { timeout: 15000 });
  check('after the idle time the table resets and shows the attract screen', (await st()).every((p: any) => !p.on) && (await page.evaluate(() => (window as any).__table.idle.attract)));
  await page.mouse.click(bare.x, bare.y); await sleep(300);
  check('a touch ends the attract screen', (await page.locator('#attract.on').count()) === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
} catch (e) { check('table e2e run', false, String((e as Error).stack ?? e)); }
await browser.close(); await srv.stop();
finish();
