import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HubConfig } from '../src/config';

export function tmpWebRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
  fs.mkdirSync(path.join(root, 'table'), { recursive: true }); fs.mkdirSync(path.join(root, 'phone'), { recursive: true });
  fs.mkdirSync(path.join(root, 'table', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'table', 'index.html'), '<!doctype html><title>table</title>');
  fs.writeFileSync(path.join(root, 'table', 'assets', 'a.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'phone', 'index.html'), '<!doctype html><title>phone</title>');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'TOP-SECRET');
  return root;
}

export function testConfig(webRoot: string, over: Partial<HubConfig> = {}): HubConfig {
  return {
    host: '127.0.0.1', port: 0, app: { id: 'test-table', name: 'Test Table', version: '0.0.1' }, phoneUrl: null, advertiseHost: null,
    udp: { host: '127.0.0.1', port: 0 }, staleMs: 2000, qrNote: null, idleSeconds: 90,
    webRoot, dataDir: path.join(webRoot, 'data'), offline: false, proxies: {}, ui: {},
    ...over,
  };
}
