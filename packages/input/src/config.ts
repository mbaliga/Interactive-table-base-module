import raw from '../../../config/table.config.json';
import type { Role } from './types';

export interface ObjectDef {
  cid: number; role: Role; key: string; label: string;
  rotation: { meaning: string; min: number; max: number; detents: number | null };
}
export interface TransformConfig {
  flipX: boolean; flipY: boolean; rotate: 0 | 90 | 180 | 270;
  crop: { x: number; y: number; w: number; h: number };
}
export interface TrackerConfig {
  removeHoldMs: number;
  /** One-euro smoothing parameters. `null` turns smoothing off (exact pass-through), e.g. for mouse-driven simulated input. */
  oneEuro: { minCutoff: number; beta: number; dCutoff: number } | null;
}
export interface LinkConfig { udpHost: string; udpPort: number; wsHost: string; wsPort: number; staleMs: number }
export interface TableConfig {
  panel: { widthMm: number; heightMm: number; widthPx: number; heightPx: number };
  transform: TransformConfig;
  tracker: TrackerConfig;
  link: LinkConfig;
  objects: ObjectDef[];
}

export const defaultConfig = raw as unknown as TableConfig;

/** cid -> role lookup built from config. */
export function roleMap(cfg: Pick<TableConfig, 'objects'>): Map<number, Role> {
  return new Map(cfg.objects.map((o) => [o.cid, o.role]));
}
