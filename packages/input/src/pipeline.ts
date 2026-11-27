import type { InputEvent, InputSource } from './types';
import type { TableConfig, TrackerConfig } from './config';
import { roleMap } from './config';
import { Normalizer } from './normalizer';
import { Tracker, type TrackerLogger } from './tracker';

export interface Pipeline {
  tracker: Tracker;
  /** Events as the app should consume them (normalised, debounced, smoothed). */
  on(fn: (e: InputEvent) => void): () => void;
  /** Events straight from the source, before any processing (dev overlay raw log). */
  onRaw(fn: (e: InputEvent) => void): () => void;
  start(): void;
  stop(): void;
}

export interface PipelineOptions {
  source: InputSource;
  config: TableConfig;
  /** Apply the calibration transform. true for hardware (TUIO) sources; false for PointerSource, which is already in surface space. */
  transform: boolean;
  /** Override tracker settings (e.g. `{ oneEuro: null }` for mouse-driven input). */
  tracker?: Partial<TrackerConfig>;
  now?: () => number;
  log?: TrackerLogger;
  tickMs?: number;
}

export function createPipeline(opts: PipelineOptions): Pipeline {
  const now = opts.now ?? (() => performance.now());
  const tracker = new Tracker({ ...opts.config.tracker, ...opts.tracker }, roleMap(opts.config), opts.log);
  const norm = new Normalizer(opts.config.transform);
  const rawListeners = new Set<(e: InputEvent) => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let off: (() => void) | undefined;

  return {
    tracker,
    on: (fn) => tracker.on(fn),
    onRaw(fn) { rawListeners.add(fn); return () => rawListeners.delete(fn); },
    start() {
      off = opts.source.on((e) => {
        for (const l of rawListeners) l(e);
        tracker.ingest(opts.transform ? norm.apply(e) : e, now());
      });
      timer = setInterval(() => tracker.tick(now()), opts.tickMs ?? 20);
      opts.source.start();
    },
    stop() {
      opts.source.stop();
      off?.(); clearInterval(timer);
    },
  };
}
