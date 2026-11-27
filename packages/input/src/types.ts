/** Normalised 0..1, origin top-left of the table surface. */
export type Vec = { x: number; y: number };
/** Index of a puck kind ("what this object means to the app"), from config `objects[].role`. */
export type Role = number;

export type Cursor = { sid: number; x: number; y: number };

export type TableObject = {
  /** Session id, unique per placement. Stable across short dropouts (see Tracker). */
  sid: number;
  /** Class id from the hardware (fiducial / tag). */
  cid: number;
  /** Mapped via config; null if unmapped. */
  role: Role | null;
  x: number;
  y: number;
  /** Radians, wrapped to [0, 2π). TUIO native: clockwise from "up". */
  angle: number;
  /** Continuous angle (no 0/2π jump). Use this for rotation controls. Optional on raw input. */
  angleUnwrapped?: number;
};

export type InputEvent =
  | { t: 'cursor:add' | 'cursor:set' | 'cursor:del'; c: Cursor }
  | { t: 'object:add' | 'object:set' | 'object:del'; o: TableObject };

export interface InputSource {
  start(): void;
  stop(): void;
  on(fn: (e: InputEvent) => void): () => void;
}

export const TAU = Math.PI * 2;
export const wrapAngle = (a: number): number => ((a % TAU) + TAU) % TAU;
