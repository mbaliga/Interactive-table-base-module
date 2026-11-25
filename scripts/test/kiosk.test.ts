import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs module without types
import { browserCandidates, findBrowser, kioskArgs, tableUrl } from '../kiosk-lib.mjs';

describe('kiosk browser discovery', () => {
  const win = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Exhibit\\AppData\\Local' };
  it('Windows: finds per-user Chrome, then falls back to Edge (always present on Windows 10/11)', () => {
    const has = (set: string[]) => (p: string) => set.includes(p);
    const chrome = 'C:\\Users\\Exhibit\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
    expect(findBrowser({ platform: 'win32', env: win, which: () => null, exists: has([chrome]) })).toEqual({ kind: 'chrome', path: chrome });
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(findBrowser({ platform: 'win32', env: win, which: () => null, exists: has([edge]) })).toEqual({ kind: 'edge', path: edge });
    expect(findBrowser({ platform: 'win32', env: win, which: () => null, exists: () => false })).toBeNull();
  });
  it('Windows: tolerates missing environment variables', () => {
    expect(() => browserCandidates({ platform: 'win32', env: {}, which: () => null })).not.toThrow();
  });
  it('Linux: prefers Chrome, then Chromium, then Edge, found on PATH', () => {
    const which = (n: string) => (n === 'chromium' ? '/usr/bin/chromium' : n === 'microsoft-edge' ? '/usr/bin/microsoft-edge' : null);
    expect(findBrowser({ platform: 'linux', env: {}, which, exists: () => true })).toEqual({ kind: 'chromium', path: '/usr/bin/chromium' });
  });
  it('an explicit --browser path wins, and must exist', () => {
    expect(findBrowser({ platform: 'linux', env: {}, which: () => '/x', exists: (p: string) => p === '/opt/c', override: '/opt/c' })).toEqual({ kind: 'custom', path: '/opt/c' });
    expect(findBrowser({ platform: 'linux', env: {}, which: () => '/x', exists: () => false, override: '/nope' })).toBeNull();
  });
});

describe('kiosk command line', () => {
  it('is a real kiosk: fullscreen, no first-run, no pinch, no swipe-back, sound without a click; URL is last', () => {
    const a: string[] = kioskArgs({ url: 'http://localhost:8080/table/', userDataDir: 'D:\\tmp\\k', platform: 'win32' });
    for (const f of ['--kiosk', '--no-first-run', '--disable-pinch', '--overscroll-history-navigation=0', '--autoplay-policy=no-user-gesture-required', '--user-data-dir=D:\\tmp\\k']) expect(a).toContain(f);
    expect(a.at(-1)).toBe('http://localhost:8080/table/');
    expect(a).not.toContain('--password-store=basic');
  });
  it('Linux adds the password-store flag; windowed mode drops --kiosk', () => {
    const a: string[] = kioskArgs({ url: 'u', userDataDir: '/tmp/k', platform: 'linux', windowed: true });
    expect(a).toContain('--password-store=basic'); expect(a).not.toContain('--kiosk'); expect(a).toContain('--start-maximized');
  });
  it('builds the table URL from the hub base, with TUIO mode on request', () => {
    expect(tableUrl('http://localhost:8080/')).toBe('http://localhost:8080/table/'); expect(tableUrl('http://h:1')).toBe('http://h:1/table/');
    expect(tableUrl('http://h:1', { tuio: true })).toBe('http://h:1/table/?source=tuio');
  });
});
