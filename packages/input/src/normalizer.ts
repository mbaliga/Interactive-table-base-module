import type { InputEvent } from './types';
import { wrapAngle } from './types';
import type { TransformConfig } from './config';

/**
 * Applies the calibration transform: crop -> flipX -> flipY -> rotate (clockwise, 90° steps).
 * Angles follow TUIO (clockwise from up), so a mirror negates and a rotation adds.
 */
export class Normalizer {
  constructor(private cfg: TransformConfig) {}

  point(x: number, y: number): { x: number; y: number } {
    const { crop, flipX, flipY, rotate } = this.cfg;
    let px = (x - crop.x) / crop.w;
    let py = (y - crop.y) / crop.h;
    if (flipX) px = 1 - px;
    if (flipY) py = 1 - py;
    for (let i = 0; i < rotate / 90; i++) [px, py] = [1 - py, px];
    return { x: px, y: py };
  }

  angle(a: number): number {
    const { flipX, flipY, rotate } = this.cfg;
    let r = a;
    if (flipX) r = -r;
    if (flipY) r = Math.PI - r;
    return wrapAngle(r + (rotate * Math.PI) / 180);
  }

  apply(e: InputEvent): InputEvent {
    if ('c' in e) return { t: e.t, c: { ...e.c, ...this.point(e.c.x, e.c.y) } };
    return { t: e.t, o: { ...e.o, ...this.point(e.o.x, e.o.y), angle: this.angle(e.o.angle) } };
  }
}
