import { createPipeline, defaultConfig, TuioWsSource, type InputEvent, type InputSource, type Pipeline, type Role, type TableConfig } from '@itable/input';
import { PuckController, type PuckHost } from './puck-controller';
import { SimDockSource } from './sim-dock';

export * from './puck-controller';
export * from './sim-dock';

export type InputMode = 'sim' | 'tuio';
export interface InputSetup {
  mode: InputMode;
  pipeline: Pipeline;
  source: InputSource;
  /** Present in sim mode: the on-screen dock pushes its gestures here. */
  dock: SimDockSource | null;
  tuio: TuioWsSource | null;
  controller: PuckController;
  /** Short label for the dev log header. */
  label: string;
}

/** The hub relays TUIO at /tuio on the same origin as the page (the dev server proxies it to the hub). */
export function defaultTuioUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss:' : 'ws:'}//${loc.host || `127.0.0.1:${defaultConfig.link.wsPort}`}/tuio`;
}

/**
 * `?source=tuio[&ws=ws://host:8080][&smooth=0]` reads physical objects over TUIO; anything else is the simulated on-screen dock.
 * `smooth=0` is a dev switch that turns the one-euro filter off.
 */
export function readMode(search: string, loc: { protocol: string; host: string } = location): { mode: InputMode; wsUrl: string; smooth: boolean } {
  const q = new URLSearchParams(search);
  const mode: InputMode = q.get('source') === 'tuio' ? 'tuio' : 'sim';
  return { mode, wsUrl: q.get('ws') ?? defaultTuioUrl(loc), smooth: q.get('smooth') !== '0' };
}

/**
 * One input path for the whole app: source -> (calibration) -> tracker (debounce, smoothing) -> PuckController -> host.
 * The simulated dock uses the same pipeline with smoothing and removal debounce off, so mouse input is exact and instant.
 */
export function createAppInput(host: PuckHost, opts: { mode: InputMode; wsUrl: string; smooth?: boolean; config?: TableConfig; onLog?: (m: string) => void }): InputSetup {
  const config = opts.config ?? defaultConfig;
  const detents = (r: Role) => config.objects.find((o) => o.role === r)?.rotation.detents ?? null;
  const dock = opts.mode === 'sim' ? new SimDockSource(config) : null;
  const tuio = opts.mode === 'tuio' ? new TuioWsSource({ url: opts.wsUrl }) : null;
  const source = (dock ?? tuio) as InputSource;
  const pipeline = createPipeline({
    source, config, transform: opts.mode === 'tuio',
    tracker: opts.mode === 'sim' ? { oneEuro: null, removeHoldMs: 0 } : opts.smooth === false ? { oneEuro: null } : undefined,
    log: opts.onLog,
  });
  const controller = new PuckController(host, { detents, log: opts.onLog });
  pipeline.on((e: InputEvent) => controller.handle(e));
  return { mode: opts.mode, pipeline, source, dock, tuio, controller, label: opts.mode === 'sim' ? 'SIMULATED' : 'LIVE TUIO' };
}
