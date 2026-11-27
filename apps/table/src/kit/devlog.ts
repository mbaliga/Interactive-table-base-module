import type { InputEvent } from '@itable/input';

/* Dev panel: every input event as it arrives from the source, before debounce and smoothing. Shown with ?dev=1 (or in `pnpm dev`)
   and the >_ button. Useful on the real table to see what the sensor actually sends. */
interface Line { k: string; id: number; txt: string }

export function createDevLog(el: HTMLElement, header: string) {
  const lines: Line[] = [];
  let dirty = true;
  return {
    event(e: InputEvent) {
      const obj = 'o' in e, b = obj ? e.o : e.c, m = e.t.split(':')[1]!;
      const line: Line = { k: m, id: obj ? b.sid : -b.sid, txt: (obj ? '2Dobj ' : '2Dcur ') + m.padEnd(3) + ' s=' + String(b.sid).padStart(3) + (obj ? ' i=' + e.o.cid : '') + ' x=' + b.x.toFixed(3) + ' y=' + b.y.toFixed(3) + (obj ? ' a=' + e.o.angle.toFixed(2) : '') };
      const last = lines[lines.length - 1];
      if (m === 'set' && last && last.k === 'set' && last.id === line.id) lines[lines.length - 1] = line; else lines.push(line);
      if (lines.length > 9) lines.shift();
      dirty = true;
    },
    /** Called from the frame loop; repaints at most when something changed. */
    flush() {
      if (!dirty || el.classList.contains('off')) return;
      dirty = false;
      el.innerHTML = `<h5>TUIO · ${header}</h5>` + lines.map((l) => `<div class="ln ${l.k}">${l.txt}</div>`).join('');
    },
  };
}
