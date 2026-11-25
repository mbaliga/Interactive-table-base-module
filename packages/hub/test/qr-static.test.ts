import { describe, it, expect } from 'vitest';
import jsQR from 'jsqr';
import path from 'node:path';
import { qrSvg } from '../src/qr';
import { safeResolve } from '../src/static';

/** Rasterise our own SVG (a rect plus one path of `M x y h w v1 h-w z` runs) so jsQR can decode it: an independent check. */
function raster(svg: string, scale = 6) {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!; const n = +vb[1]!;
  const px = new Uint8ClampedArray(n * scale * n * scale * 4).fill(255);
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, w] = [+m[1]!, +m[2]!, +m[3]!];
    for (let yy = 0; yy < scale; yy++) for (let xx = 0; xx < w * scale; xx++) { const o = (((y * scale + yy) * n * scale) + x * scale + xx) * 4; px[o] = px[o + 1] = px[o + 2] = 0; px[o + 3] = 255; }
  }
  return { data: px, size: n * scale };
}

describe('qrSvg', () => {
  for (const url of ['http://192.168.1.20:8080/phone/?src=table', 'https://phone.example.org/app?src=table&x=1', 'http://[fe80::1]:8080/phone/?src=table', 'http://exhibit.local/phone/?src=table']) {
    it(`decodes back to the URL: ${url}`, () => {
      const { data, size } = raster(qrSvg(url, { margin: 4 }));
      const r = jsQR(data, size, size);
      expect(r?.data).toBe(url);
    });
  }
  it('is a self-contained svg with no scripts or external references', () => {
    const s = qrSvg('http://x/');
    expect(s.startsWith('<svg')).toBe(true); expect(s).not.toMatch(/<script|href=|http:\/\/(?!www\.w3\.org)/);
  });
});

describe('qrSvg input hardening', () => {
  it('ignores colours that are not plain hex (no attribute or markup injection)', () => {
    const evil = '#000" onload="alert(1)';
    const s = qrSvg('http://x/', { dark: evil, light: '"><script>alert(1)</script>' });
    expect(s).not.toMatch(/onload|<script|alert/);
    expect(s).toContain('fill="#ffffff"'); expect(s).toContain('fill="#000000"');
    expect(qrSvg('http://x/', { dark: '#04101c' })).toContain('fill="#04101c"');
  });
  it('clamps the margin', () => { expect(qrSvg('http://x/', { margin: 9999 })).toContain('viewBox="0 0 '); expect(+qrSvg('http://x/', { margin: -5 }).match(/viewBox="0 0 (\d+)/)![1]!).toBeLessThan(60); });
});

describe('safeResolve (static file path safety)', () => {
  const root = path.resolve('/srv/www');
  it('allows normal paths', () => { expect(safeResolve(root, 'a/b.js')).toBe(path.join(root, 'a', 'b.js')); expect(safeResolve(root, '')).toBe(root); });
  for (const bad of ['../secret', 'a/../../secret', '%2e%2e/secret', '..%2fsecret', 'a%2f..%2f..%2fsecret', '..\\secret', 'a\\..\\..\\secret', 'C:/Windows/win.ini', 'c:\\x', 'a\0b', '%00', '%E0%A4%A']) {
    it(`rejects ${JSON.stringify(bad)}`, () => { expect(safeResolve(root, bad)).toBeNull(); });
  }
  it('treats a leading slash as relative to the root, never the filesystem root', () => { expect(safeResolve(root, '/etc/passwd')).toBe(path.join(root, 'etc', 'passwd')); });
});
