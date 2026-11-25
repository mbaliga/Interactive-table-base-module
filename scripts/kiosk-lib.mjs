// Pure helpers for the kiosk launcher (unit-tested for Windows and Linux layouts in scripts/test/kiosk.test.ts).
import path from 'node:path';

/** Candidate browser executables, best first. `env` and `which` are injected so tests can fake either OS. */
export function browserCandidates({ platform, env, which }) {
  const out = [];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    const j = (...p) => path.win32.join(...p);
    for (const r of roots) out.push({ kind: 'chrome', path: j(r, 'Google', 'Chrome', 'Application', 'chrome.exe') });
    for (const r of roots) out.push({ kind: 'chromium', path: j(r, 'Chromium', 'Application', 'chrome.exe') });
    // Edge ships with Windows 10/11 and supports the same --kiosk flag, so there is always a fallback
    for (const r of [env['PROGRAMFILES(X86)'], env.PROGRAMFILES].filter(Boolean)) out.push({ kind: 'edge', path: j(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe') });
  } else if (platform === 'darwin') {
    out.push({ kind: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }, { kind: 'edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' });
  } else {
    for (const [kind, names] of [['chrome', ['google-chrome-stable', 'google-chrome']], ['chromium', ['chromium', 'chromium-browser']], ['edge', ['microsoft-edge-stable', 'microsoft-edge']]])
      for (const n of names) { const p = which(n); if (p) out.push({ kind, path: p }); }
    for (const p of ['/snap/bin/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']) out.push({ kind: 'chromium', path: p });
  }
  return out;
}

export function findBrowser({ platform, env, which, exists, override }) {
  if (override) return exists(override) ? { kind: 'custom', path: override } : null;
  return browserCandidates({ platform, env, which }).find((c) => exists(c.path)) ?? null;
}

/** Chromium command line for a touch-table kiosk. */
export function kioskArgs({ url, userDataDir, platform, windowed = false }) {
  const a = [
    windowed ? '--start-maximized' : '--kiosk',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--noerrdialogs', '--disable-infobars',
    '--disable-session-crashed-bubble', '--hide-crash-restore-bubble',
    '--disable-features=Translate,TranslateUI,InfiniteSessionRestore',
    '--autoplay-policy=no-user-gesture-required', // sound cues work without a first click after an idle reset
    '--overscroll-history-navigation=0', '--disable-pinch', // no swipe-back, no browser zoom on a table
    '--check-for-update-interval=31536000', '--disable-component-update',
  ];
  if (platform === 'linux') a.push('--password-store=basic', '--use-gl=angle', '--ozone-platform-hint=auto');
  a.push(url);
  return a;
}

/** Table URL from the hub base URL. `tuio` opens the app in TUIO mode (physical pucks) instead of the on-screen dock. */
export const tableUrl = (hub, { tuio = false } = {}) => hub.replace(/\/+$/, '') + '/table/' + (tuio ? '?source=tuio' : '');
