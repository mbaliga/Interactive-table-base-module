import qrcode from 'qrcode-generator';

const HEX = /^#[0-9a-fA-F]{3,8}$/;
/** Colours go into SVG attributes: accept hex only, otherwise fall back, so a crafted query string cannot inject markup. */
const colour = (v: string | undefined, fallback: string) => (v !== undefined && HEX.test(v) ? v : fallback);

/** QR code as a self-contained SVG string (crisp, scalable). `margin` is the quiet zone in modules (4 is the spec). */
export function qrSvg(text: string, o: { dark?: string; light?: string; margin?: number; ecc?: 'L' | 'M' | 'Q' | 'H' } = {}): string {
  const qr = qrcode(0, o.ecc ?? 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount(), m = Math.max(0, Math.min(16, Math.trunc(o.margin ?? 4))), size = n + 2 * m;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let e = c; while (e < n && qr.isDark(r, e)) e++;
      d += `M${c + m} ${r + m}h${e - c}v1h-${e - c}z`;
      c = e;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="${colour(o.light, '#ffffff')}"/><path d="${d}" fill="${colour(o.dark, '#000000')}"/></svg>`;
}
