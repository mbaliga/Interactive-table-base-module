import './style.css';

/* The phone companion: what a visitor sees after scanning the table's QR code. Each entry in ACTIVITIES is one page (a game, a quiz,
   extra reading). They run entirely on the phone; the hub only serves the files and, optionally, data through /proxy/<source>/. */
interface Activity { id: string; title: string; blurb: string; render(el: HTMLElement): void | (() => void) }

const ACTIVITIES: Activity[] = [
  {
    id: 'tap', title: 'Tap race', blurb: 'How many taps in ten seconds?',
    render(el) {
      el.innerHTML = '<h2>Tap race</h2><p class="big" id="n">0</p><button class="primary" id="go">Start</button><p class="note" id="msg"></p>';
      const n = el.querySelector<HTMLElement>('#n')!, go = el.querySelector<HTMLButtonElement>('#go')!, msg = el.querySelector<HTMLElement>('#msg')!;
      let count = 0, end = 0, timer = 0;
      go.addEventListener('click', () => {
        if (!end) { count = 0; end = performance.now() + 10_000; go.textContent = 'Tap!'; msg.textContent = '';
          timer = window.setInterval(() => { if (performance.now() >= end) { clearInterval(timer); end = 0; go.textContent = 'Again'; msg.textContent = `${count} taps. Nice!`; } }, 100); return; }
        n.textContent = String(++count);
      });
      return () => clearInterval(timer);
    },
  },
  {
    id: 'quiz', title: 'Quick quiz', blurb: 'Three questions about the table.',
    render(el) {
      const Q = [
        ['What makes the table respond?', ['Objects and touch', 'Voice', 'A keyboard'], 0],
        ['How do you change a value?', ['Shake the table', 'Turn the object', 'Blow on it'], 1],
        ['What happens when nobody plays for a while?', ['It shuts down', 'It starts over', 'Nothing'], 1],
      ] as const;
      let i = 0, score = 0;
      const show = () => {
        if (i >= Q.length) { el.innerHTML = `<h2>Done</h2><p class="big">${score} / ${Q.length}</p>`; return; }
        const [q, opts] = Q[i]!;
        el.innerHTML = `<h2>${q}</h2><div class="opts">${opts.map((o, k) => `<button data-k="${k}">${o}</button>`).join('')}</div>`;
        el.querySelectorAll<HTMLButtonElement>('.opts button').forEach((b) => b.addEventListener('click', () => { if (+b.dataset.k! === Q[i]![2]) score++; i++; show(); }));
      };
      show();
    },
  },
];

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const menu = $('#menu'), home = $('#home'), view = $('#view'), content = $('#content');
let cleanup: void | (() => void);

menu.innerHTML = ACTIVITIES.map((a) => `<a class="card" href="#${a.id}"><b>${a.title}</b><span>${a.blurb}</span></a>`).join('');
function route() {
  if (typeof cleanup === 'function') cleanup(); cleanup = undefined;
  const a = ACTIVITIES.find((x) => '#' + x.id === location.hash);
  home.hidden = !!a; view.hidden = !a;
  if (a) cleanup = a.render(content); else content.innerHTML = '';
}
$('#back').addEventListener('click', () => { history.length > 1 ? history.back() : (location.hash = ''); });
addEventListener('hashchange', route); route();

// name and settings come from the hub; the page also works without it (e.g. hosted publicly with phoneUrl)
fetch('/api/config', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((c: { app?: { name?: string } } | null) => {
  if (c?.app?.name) { $('#name').textContent = c.app.name; document.title = c.app.name; }
}).catch(() => { /* standalone */ });
$('#foot').textContent = new URLSearchParams(location.search).get('src') === 'table' ? 'Opened from the table' : '';
