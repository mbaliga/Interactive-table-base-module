/* The table kit: everything an interactive-table app needs that is not the app itself.
   An app is a list of scenes (what each physical object does) plus an optional background; see src/main.ts and docs/NEW-APP.md. */
import './kit.css';
export { createTable } from './table';
export { fetchData, onHub, hubInfo, refreshHub } from './hub';
export { rotationValue } from './pucks';
export type { Background, HubInfo, Puck, Scene, TableContext, TableOptions } from './types';
