import type { InputEvent, ObjectDef } from '@itable/input';
import type { InputSetup } from './input';

/** What /api/config on the hub reports (see packages/hub/src/server.ts). */
export interface HubInfo {
  version: string;
  app: { id: string; name: string; version: string };
  phoneUrl: string;
  phoneUrlSource: 'configured' | 'advertiseHost' | 'lan' | 'localhost';
  phonesCanReach: boolean;
  qrNote: string | null;
  ui: Record<string, unknown> & { idleSeconds?: number };
  proxies: Record<string, { base: string; ready: boolean }>;
  offline: boolean;
}

/** One physical object (puck) as the app sees it. Positions are in stage pixels; the kit keeps this up to date. */
export interface Puck {
  readonly role: number;
  readonly def: ObjectDef;
  /** On the table (placed) or in the dock / lifted. */
  on: boolean;
  /** Stage pixels (0..W, 0..H). */
  x: number;
  y: number;
  /** Rotation in degrees 0..360, clockwise from "up", already snapped to the detents if the object has them. */
  angle: number;
  /** The rotation mapped onto `def.rotation.min..max` (continuous), or the option's value for a detent object. */
  value: number;
  /** Detent index 0..detents-1 for objects with detents, else null. */
  option: number | null;
  /** performance.now() when it was placed (0 when lifted). */
  placedAt: number;
  /** performance.now() of the last deliberate move (not sensor jitter). Used to decide which labels to show. */
  touchedAt: number;
  /** Scratch space for the puck's scene. Cleared when the puck is placed. */
  state: Record<string, unknown>;
}

/** Everything a scene can use. One instance per table. */
export interface TableContext {
  /** Logical stage size in pixels (the canvas is scaled to the screen; draw in these units). */
  readonly W: number;
  readonly H: number;
  readonly g: CanvasRenderingContext2D;
  /** Physical size helpers from config/table.config.json `panel`: millimetres <-> stage pixels. */
  mm(mm: number): number;
  toMm(px: number): number;
  /** Seconds since start (advances only while the page is visible). */
  readonly time: number;
  readonly pucks: readonly Puck[];
  puck(key: string): Puck | undefined;
  readonly input: InputSetup;
  /** null until the hub answered (or when running without a hub). */
  readonly hub: HubInfo | null;
  /** The app's own event bus: the kit emits puck:place, puck:move, puck:remove, table:reset, idle:attract; scenes may emit their own. */
  emit(type: string, data?: unknown): void;
  on(type: string, fn: (data: unknown) => void): () => void;
  /** Short UI sound (no-op when muted or before the first touch). */
  beep(freq?: number, seconds?: number): void;
  /** Lift a puck from the app side (the physical object is then ignored until it is picked up). */
  release(key: string): void;
}

/**
 * What a puck does. One scene per object `key` in config/table.config.json. Every hook is optional.
 * Draw in stage pixels with `t.g`; the kit has already cleared the frame and drawn the background.
 */
export interface Scene {
  /** Matches `objects[].key` in config/table.config.json. */
  key: string;
  /** Accent colour of the puck's ring and label. */
  color?: string;
  /** Labels for detent positions (e.g. ["Red", "Green", "Blue"] for a 3-detent object). Drawn around the ring. */
  options?: string[];
  place?(p: Puck, t: TableContext): void;
  move?(p: Puck, t: TableContext): void;
  remove?(p: Puck, t: TableContext): void;
  /** Every frame while placed, before drawing. dt in seconds. */
  tick?(p: Puck, t: TableContext, dt: number): void;
  /** Every frame while placed: draw under the puck rings. */
  draw?(p: Puck, t: TableContext): void;
  /** The text in the puck's label capsule (plain text; refreshed a few times per second). null hides it. */
  label?(p: Puck, t: TableContext): string | null;
  /** The table is starting over (Reset button or idle reset). */
  reset?(t: TableContext): void;
}

/** The backdrop drawn under every scene, e.g. a map, a floor plan, a starfield. */
export interface Background {
  /** Called once with the context, before the first frame. */
  init?(t: TableContext): void;
  draw(t: TableContext, dt: number): void;
  /** A tap / click on the table surface that no puck or button consumed. Stage pixels. */
  tap?(x: number, y: number, t: TableContext): void;
  /** Called every few seconds while the attract screen is showing (step counts up). */
  attract?(step: number, t: TableContext): void;
  reset?(t: TableContext): void;
}

export interface TableOptions {
  scenes: Scene[];
  background?: Background;
  /** Logical stage size. Default 1920 x 1080 (16:9). Everything is laid out in these units and scaled to the screen. */
  width?: number;
  height?: number;
  /** Words on the attract screen. */
  attract?: { title?: string; titleTuio?: string; subtitle?: string };
  /** Hint shown until the first puck is placed. */
  hint?: { sim?: string; tuio?: string };
  /** How many pucks may show their label capsule at once (most recently used first). Default 3. */
  maxLabels?: number;
  /** Finger touches from the table's own sensor (TUIO cursors). Pointer/touch events on the page work as usual. */
  onCursor?(e: Extract<InputEvent, { c: unknown }>, t: TableContext): void;
}
