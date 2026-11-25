import type { HubInfo } from './types';

/* The hub's /api/config, fetched once at start and every minute after (follows a changed Wi-Fi address, recovers after a hub
   restart). Listeners get null while the hub cannot be reached, e.g. when the table app is opened from the Vite dev server alone. */
type Listener = (h: HubInfo | null) => void;
const listeners = new Set<Listener>();
let current: HubInfo | null = null;
let started = false;

export async function refreshHub(): Promise<HubInfo | null> {
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    current = (await r.json()) as HubInfo;
  } catch { current = null; }
  for (const l of listeners) { try { l(current); } catch (e) { console.warn('[hub] listener failed', e); } }
  return current;
}

/** Subscribe to hub info. Starts polling on first use. */
export function onHub(fn: Listener): () => void {
  listeners.add(fn);
  if (!started) { started = true; void refreshHub(); setInterval(() => { void refreshHub(); }, 60_000); }
  else fn(current);
  return () => listeners.delete(fn);
}

export const hubInfo = () => current;

/**
 * Read a configured data source through the hub's proxy (`proxies.<source>` in hub.config.json): GET /proxy/<source>/<endpoint>.
 * `how` tells the page how fresh the data is, so it can label it honestly: live (just fetched), fresh (cached within its TTL),
 * stale (the last good copy, upstream unreachable). Returns null when nothing is available; show bundled sample data then.
 */
export async function fetchData<T = unknown>(source: string, endpoint: string): Promise<{ data: T; how: 'live' | 'fresh' | 'stale'; at: Date } | null> {
  try {
    const r = await fetch(`/proxy/${encodeURIComponent(source)}/${endpoint.replace(/^\/+/, '')}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const how = (r.headers.get('x-hub-cache') ?? 'live') as 'live' | 'fresh' | 'stale';
    return { data: (await r.json()) as T, how, at: new Date(r.headers.get('x-hub-data-at') ?? Date.now()) };
  } catch { return null; }
}
