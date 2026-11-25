import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record, serveReplay, loadJsonl } from '../src';

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/return-100.jsonl');

describe('record / replay', () => {
  it('replaying a recording and re-recording it gives identical messages with matching timing', async () => {
    const srv = await serveReplay(fixture, 0);
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), 'again.jsonl');
    const rec = record(`ws://127.0.0.1:${srv.port}`, tmp);
    const original = loadJsonl(fixture);
    await new Promise((r) => setTimeout(r, (original.at(-1)!.t) + 600));
    await rec.stop(); await srv.stop();

    const again = loadJsonl(tmp);
    expect(again.map((l) => l.msg)).toEqual(original.map((l) => l.msg));
    // timing: each message within 60 ms of the original offset
    const off = again[0]!.t - original[0]!.t;
    again.forEach((l, i) => expect(Math.abs(l.t - off - original[i]!.t)).toBeLessThan(60));
  });

  it('speed multiplier compresses time', async () => {
    const { play } = await import('../src');
    const lines = [{ t: 0, msg: 1 }, { t: 400, msg: 2 }];
    const t0 = Date.now(); const got: unknown[] = [];
    await play(lines, (m) => got.push(m), { speed: 4 });
    expect(got).toEqual([1, 2]);
    expect(Date.now() - t0).toBeLessThan(250);
  });
});
