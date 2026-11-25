import os from 'node:os';
import { parseAdvertiseHost } from './config';

export interface Candidate { address: string; iface: string; rank: number }

type Ifaces = ReturnType<typeof os.networkInterfaces>;

/** Names of adapters that phones on the visitor Wi-Fi cannot reach (virtual switches, containers, VPNs). */
const VIRTUAL = /(vethernet|virtualbox|vmware|vmnet|hyper-v|wsl|docker|^br-|^veth|^virbr|^lxc|^tun|^tap|tailscale|zerotier|loopback|bluetooth|isatap|teredo)/i;
const WIRELESS = /(wi-?fi|wlan|wlp|wireless|wl[0-9])/i;

const isLinkLocal = (a: string) => a.startsWith('169.254.');
const isPrivate = (a: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a);

/**
 * Candidate IPv4 addresses phones could use to reach this machine, best first.
 * Private ranges beat public ones, physical adapters beat virtual ones, and Wi-Fi/LAN beat everything else.
 * Pure function of the interface table so it can be tested for Windows and Linux layouts.
 */
export function lanCandidates(ifaces: Ifaces = os.networkInterfaces()): Candidate[] {
  const out: Candidate[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      if (a.internal || (a.family !== 'IPv4' && (a.family as unknown) !== 4)) continue;
      if (isLinkLocal(a.address)) continue;
      let rank = 0;
      if (isPrivate(a.address)) rank += 10;
      if (!VIRTUAL.test(name)) rank += 20;
      if (/^172\.(1[6-9]|2\d|3[01])\./.test(a.address) && VIRTUAL.test(name)) rank -= 5; // docker-style 172.x bridges
      if (WIRELESS.test(name) || /^(eth|en|ethernet)/i.test(name)) rank += 5;
      out.push({ address: a.address, iface: name, rank });
    }
  }
  return out.sort((x, y) => y.rank - x.rank || x.address.localeCompare(y.address));
}

export interface UrlPlan {
  phoneUrl: string;
  source: 'configured' | 'advertiseHost' | 'lan' | 'localhost';
  candidates: string[];
  /** false when phones cannot possibly connect (the hub only listens on this computer). The table then shows no QR. */
  phonesCanReach: boolean;
}

const isLoopbackHost = (h: string) => h === 'localhost' || h === '::1' || /^127\./.test(h);
const isWildcardHost = (h: string) => h === '0.0.0.0' || h === '::' || h === '';

/** The URL the QR code should carry, and the alternatives to show an operator. */
export function planPhoneUrl(opts: { phoneUrl: string | null; advertiseHost: string | null; port: number; candidates: Candidate[]; bindHost?: string }): UrlPlan {
  const withSrc = (u: string) => { try { const x = new URL(u); if (!x.searchParams.has('src')) x.searchParams.set('src', 'table'); return x.toString(); } catch { return u; } };
  const bind = opts.bindHost ?? '0.0.0.0';
  const bracket = (h: string) => (h.includes(':') && !h.startsWith('[') ? `[${h}]` : h);
  // advertiseHost may carry its own port ("192.168.1.20:8080"); otherwise the hub's port is used
  const mk = (h: string) => { const a = parseAdvertiseHost(h); const port = a.port ?? opts.port; return `http://${bracket(a.host)}${port === 80 ? '' : ':' + port}/phone/?src=table`; };
  // A hub bound to one address is reachable only there; bound to loopback it is reachable only from this computer.
  const usable = isWildcardHost(bind) ? opts.candidates : opts.candidates.filter((c) => c.address === bind);
  const cands = usable.map((c) => mk(c.address));
  if (opts.phoneUrl) return { phoneUrl: withSrc(opts.phoneUrl), source: 'configured', candidates: cands, phonesCanReach: true }; // public hosting does not depend on the bind address
  if (isLoopbackHost(bind)) return { phoneUrl: mk('localhost'), source: 'localhost', candidates: [], phonesCanReach: false };
  if (opts.advertiseHost) return { phoneUrl: mk(opts.advertiseHost), source: 'advertiseHost', candidates: cands, phonesCanReach: true };
  if (cands[0]) return { phoneUrl: cands[0], source: 'lan', candidates: cands, phonesCanReach: true };
  return { phoneUrl: mk('localhost'), source: 'localhost', candidates: [], phonesCanReach: false };
}
