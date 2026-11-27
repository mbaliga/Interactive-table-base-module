import fs from 'node:fs';

export interface RecLine { t: number; msg: any }

export const parseJsonl = (text: string): RecLine[] =>
  text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as RecLine);
export const loadJsonl = (file: string) => parseJsonl(fs.readFileSync(file, 'utf8'));
