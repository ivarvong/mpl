// mpl/zoom in real headless Chromium (Playwright) on examples/zoom.ts's page: real wheel, drag, Shift+drag, double-click,
// keys and two-finger touch must give the right view limits, move shared and twin axes together, reset to the server's
// first paint, keep hover tooltips and legend toggles working on the zoomed view, and never render twice in one
// animation frame. The unique property: every frame the page shows is a real mpljs render, so each one must equal a
// Node render of the same chart with the same set_xlim / set_ylim calls (SVG frames: the same text, and the DOM equal
// to parsing it; canvas frames: the same RGBA bytes as Node's toRGBA at that scale). `npm run test:zoom`
// (needs `npx playwright install chromium-headless-shell`). SHOTS=dir writes zoomed screenshots, light and dark.
/* oxlint-disable no-await-in-loop, unicorn/consistent-function-scoping, promise/always-return -- one browser page driven step by step; helpers inside page.evaluate run in the page and cannot be hoisted */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { build, CHARTS } from '../examples/_zoom-charts.ts';
import type { Figure } from '../src/index.ts';

const ROOT = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'examples/zoom.ts')], { stdio: 'pipe' });
const html = readFileSync(join(ROOT, 'examples/out/zoom.html'), 'utf8');
const URL0 = 'http://localhost/zoom.html';   // localhost: a secure context (crypto.subtle)
const shots = process.env['SHOTS'] ?? '';

let fails = 0, checks = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  checks++;
  if (!ok) fails++;
  if (!ok || process.env['VERBOSE'] === '1') console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : `: ${detail}`}`);
};
/** Equal to 1e-9 of `scale` (float noise of the zoom arithmetic). */
const near = (a: number, b: number, scale: number): boolean => Math.abs(a - b) <= 1e-9 * Math.abs(scale);

type Lim = readonly [number, number];
type AxView = { readonly x: Lim; readonly y: Lim; readonly set: { readonly x: boolean; readonly y: boolean } };
type Frame = { readonly id: string; readonly kind: 'svg' | 'canvas'; readonly scale: number; readonly svg: string; readonly settle: boolean; readonly view: readonly AxView[]; readonly tick: number; readonly hash: string; readonly dom: boolean };

// ------------------------------------------------------------------ Node side: the same chart, the same limits
const figWith = (id: string, view: readonly AxView[]): Figure => {
  const fig = build(id);
  view.forEach((v, k) => { if (v.set.x) fig.axes[k].set_xlim(v.x[0], v.x[1]); if (v.set.y) fig.axes[k].set_ylim(v.y[0], v.y[1]); });
  return fig;
};
const nodeSVG = (id: string, view: readonly AxView[]): string => figWith(id, view).toSVG({ interactive: true, idPrefix: `${id}-` });
const nodeRGBA = (id: string, view: readonly AxView[], scale: number): string => {
  const c = figWith(id, view).toRGBA({ scale });
  return createHash('sha256').update(c.px.subarray(0, c.w * c.h * 4)).digest('hex');
};
const xLabels = (id: string, view: readonly AxView[], k = 0): string => figWith(id, view).axes[k].get_xticklabels().map((t) => t.get_text()).join('|');

// ------------------------------------------------------------------ page helpers
async function open(browser: Browser, width: number, opts: { readonly touch: boolean; readonly config: Readonly<Record<string, unknown>> }, body = html, charts = Object.keys(CHARTS).length): Promise<{ page: Page; errors: string[] }> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: opts.touch, timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route(URL0, (r) => r.fulfill({ body, contentType: 'text/html' }));
  await page.addInitScript((config) => {
    const w = window as unknown as Record<string, unknown>;
    w['mplZoomConfig'] = config;
    // an animation-frame counter, and every frame zoom draws, with its canvas pixels hashed while they are up
    let tick = 0;
    const loop = (): void => { tick++; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    const frames: unknown[] = [], pending: Promise<unknown>[] = [];
    w['zoomFrames'] = frames; w['zoomPending'] = pending;
    w['mplZoomFrame'] = (id: string, f: { kind: string; scale: number; svg: string; settle: boolean; view: unknown }, svg: SVGSVGElement) => {
      const rec: Record<string, unknown> = { id, kind: f.kind, scale: f.scale, svg: f.svg, settle: f.settle, view: f.view, tick, hash: '', dom: false };
      frames.push(rec);
      if (f.kind === 'canvas') {
        const cv = svg.querySelector('canvas'), cx = cv && cv.getContext('2d');
        if (cv && cx) {
          const px = cx.getImageData(0, 0, cv.width, cv.height).data;
          pending.push(crypto.subtle.digest('SHA-256', px).then((d) => { rec['hash'] = Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join(''); }));
        }
      } else if (f.svg !== '') {
        // the DOM shown is exactly the parsed render (zoom's and the hover client's overlays aside)
        const t = document.createElement('template');
        t.innerHTML = f.svg;
        const want = Array.from(t.content.querySelector('svg')?.childNodes ?? []);
        // (the hover client's state classes aside: it dims the other artists under a resting pointer)
        const got = Array.from(svg.childNodes).filter((n) => !(n instanceof Element && /mpl-(zoom-)?overlay/.test(n.getAttribute('class') ?? ''))).map((n) => {
          const c = n.cloneNode(true);
          if (c instanceof Element) for (const e of [c, ...Array.from(c.querySelectorAll('.mpl-dim, .mpl-off'))]) {
            e.classList.remove('mpl-dim', 'mpl-off');
            if (e.getAttribute('class') === '') e.removeAttribute('class');
          }
          return c;
        });
        rec['dom'] = want.length === got.length && want.every((n, i) => n.isEqualNode(got[i]));
      }
    };
  }, opts.config);
  await page.goto(URL0, { waitUntil: 'load' });
  await page.waitForFunction((n) => document.querySelectorAll('.mpl-overlay').length === n && typeof (window as unknown as { mplZoom: unknown }).mplZoom === 'object', charts);
  return { page, errors };
}

const idle = (page: Page, id: string): Promise<void> => page.evaluate(async (i) => {
  const w = window as unknown as { mplZoom: Record<string, { idle: () => Promise<void> }>; zoomPending: Promise<unknown>[] };
  await w.mplZoom[i].idle();
  await Promise.all(w.zoomPending);
}, id);
const view = (page: Page, id: string): Promise<readonly AxView[]> => page.evaluate((i) => (window as unknown as { mplZoom: Record<string, { view: () => readonly AxView[] }> }).mplZoom[i].view(), id);
const frames = (page: Page): Promise<readonly Frame[]> => page.evaluate(() => (window as unknown as { zoomFrames: readonly Frame[] }).zoomFrames);
const clearFrames = (page: Page): Promise<void> => page.evaluate(() => { (window as unknown as { zoomFrames: unknown[] }).zoomFrames.length = 0; });

/** Screen position of the data point (x, y) in Axes k of chart id: the live sidecar's box and the controller's view. */
const screenOf = (page: Page, id: string, k: number, x: number, y: number): Promise<{ x: number; y: number }> => page.evaluate(([i, ak, dx, dy]) => {
  const svg = document.getElementById(String(i)) as unknown as SVGSVGElement;
  const sc = JSON.parse(svg.querySelector(`g[data-mpl-axes="${ak}"] > metadata`)?.textContent ?? '{}');
  const v = (window as unknown as { mplZoom: Record<string, { view: () => readonly AxView[] }> }).mplZoom[String(i)].view()[Number(ak)];
  const f = (s: { s: string; b: number }, n: number): number => (s.s === 'log' ? Math.log(n) / Math.log(s.b || 10) : n);
  const tx = (f(sc.x, Number(dx)) - f(sc.x, v.x[0])) / (f(sc.x, v.x[1]) - f(sc.x, v.x[0])), ty = (f(sc.y, Number(dy)) - f(sc.y, v.y[0])) / (f(sc.y, v.y[1]) - f(sc.y, v.y[0]));
  const p = new DOMPoint(sc.box[0] + tx * (sc.box[2] - sc.box[0]), sc.box[3] - ty * (sc.box[3] - sc.box[1])).matrixTransform(svg.getScreenCTM() ?? new DOMMatrix());
  return { x: p.x, y: p.y };
}, [id, k, x, y] as const);
/** The data point under screen (sx, sy) in Axes k of chart id (inverse of screenOf). */
const dataAt = (page: Page, id: string, k: number, sx: number, sy: number): Promise<{ x: number; y: number }> => page.evaluate(([i, ak, px, py]) => {
  const svg = document.getElementById(String(i)) as unknown as SVGSVGElement;
  const sc = JSON.parse(svg.querySelector(`g[data-mpl-axes="${ak}"] > metadata`)?.textContent ?? '{}');
  const v = (window as unknown as { mplZoom: Record<string, { view: () => readonly AxView[] }> }).mplZoom[String(i)].view()[Number(ak)];
  const p = new DOMPoint(Number(px), Number(py)).matrixTransform((svg.getScreenCTM() ?? new DOMMatrix()).inverse());
  const f = (s: { s: string; b: number }, n: number): number => (s.s === 'log' ? Math.log(n) / Math.log(s.b || 10) : n);
  const g = (s: { s: string; b: number }, u: number): number => (s.s === 'log' ? (s.b || 10) ** u : u);
  const tx = (p.x - sc.box[0]) / (sc.box[2] - sc.box[0]), ty = (sc.box[3] - p.y) / (sc.box[3] - sc.box[1]);
  return { x: g(sc.x, f(sc.x, v.x[0]) + tx * (f(sc.x, v.x[1]) - f(sc.x, v.x[0]))), y: g(sc.y, f(sc.y, v.y[0]) + ty * (f(sc.y, v.y[1]) - f(sc.y, v.y[0]))) };
}, [id, k, sx, sy] as const);
/** The centre of Axes k's plot box on screen, offset by a fraction of its size. */
const boxPoint = (page: Page, id: string, k: number, fx = 0.5, fy = 0.5): Promise<{ x: number; y: number }> => page.evaluate(([i, ak, ax, ay]) => {
  const svg = document.getElementById(String(i)) as unknown as SVGSVGElement;
  const b = JSON.parse(svg.querySelector(`g[data-mpl-axes="${ak}"] > metadata`)?.textContent ?? '{}').box;
  const p = new DOMPoint(b[0] + Number(ax) * (b[2] - b[0]), b[1] + Number(ay) * (b[3] - b[1])).matrixTransform(svg.getScreenCTM() ?? new DOMMatrix());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}, [id, k, fx, fy] as const);
const tipText = (page: Page): Promise<string> => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t = document.querySelector<HTMLElement>('.mpl-tip');
  return t && !t.hidden ? (t.innerText ?? '').replace(/\s+/g, ' ').trim() : '(hidden)';
});
const scrollTo = async (page: Page, id: string): Promise<void> => {
  await page.evaluate((i) => document.getElementById(i)?.scrollIntoView({ block: 'center' }), id);
  await page.waitForTimeout(30);
};
const span = (l: Lim): number => l[1] - l[0];
const lspan = (l: Lim): number => Math.log10(l[1]) - Math.log10(l[0]);

/** Every frame recorded so far equals the Node render with the same view; returns how many were checked. */
async function pixelExact(page: Page, at: string): Promise<{ svg: number; canvas: number }> {
  const fs = await frames(page);
  let svg = 0, canvas = 0;
  for (const f of fs) {
    if (f.kind === 'svg' && f.svg === '') continue;   // a reset: the server's own first paint
    if (f.kind === 'svg') {
      svg++;
      const want = nodeSVG(f.id, f.view);
      check(f.svg === want, `${at} ${f.id} svg frame ${svg} equals the Node render of its view`, `${f.svg.length} vs ${want.length} chars`);
      check(f.dom, `${at} ${f.id} svg frame ${svg}: the DOM is the parsed render`);
    } else {
      canvas++;
      check(f.hash !== '' && f.hash === nodeRGBA(f.id, f.view, f.scale), `${at} ${f.id} canvas frame ${canvas} (${f.scale}x) has the Node toRGBA bytes of its view`);
    }
  }
  return { svg, canvas };
}

const executablePath = process.env['CHROMIUM_PATH'];
const browser = await chromium.launch(typeof executablePath === 'string' && executablePath !== '' ? { executablePath } : {});
const total = { svg: 0, canvas: 0 };
try {
  // the static first paint: the page inlines exactly the server render, and without JS it is all there is
  for (const id of Object.keys(CHARTS)) {
    const s = CHARTS[id]().toSVG({ interactive: true, idPrefix: `${id}-` });
    check(html.includes(s.slice(s.indexOf('>') + 1)), `page inlines ${id}'s server render unchanged`);
  }
  {
    const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    await page.route(URL0, (r) => r.fulfill({ body: html, contentType: 'text/html' }));
    await page.goto(URL0);
    const n = await page.evaluate(() => Array.from(document.querySelectorAll('svg[data-chart]')).filter((s) => s.getBoundingClientRect().height > 100 && s.querySelectorAll('path').length > 20).length);
    check(n === Object.keys(CHARTS).length, 'no JS: every chart is drawn', `${n} of ${Object.keys(CHARTS).length}`);
    await ctx.close();
  }

  for (const width of [1280, 420]) {
    const at = `@${width}px`;
    const { page, errors } = await open(browser, width, { touch: false, config: {} });
    const loads = (): Promise<number> => page.evaluate(() => Number((window as unknown as { mplChunkLoads: number }).mplChunkLoads || 0));
    check(await loads() === 0, `${at} nothing loads before a gesture`);
    const orig: Record<string, readonly AxView[]> = {};
    for (const id of Object.keys(CHARTS)) orig[id] = await view(page, id);
    const firstPaint = await page.evaluate(() => document.getElementById('lines')?.innerHTML ?? '');

    // ---- wheel zoom about the pointer (linear): the point under it stays put, the span shrinks by exp(-0.2) per notch
    await scrollTo(page, 'lines');
    let p = await boxPoint(page, 'lines', 0, 0.3, 0.4);
    const d0 = await dataAt(page, 'lines', 0, p.x, p.y);
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
    await idle(page, 'lines');
    let v = await view(page, 'lines');
    const d1 = await dataAt(page, 'lines', 0, p.x, p.y);
    check(await loads() === 1, `${at} the first gesture loads the chart chunk once`);
    check(near(span(v[0].x), span(orig['lines'][0].x) * Math.exp(-0.6), span(v[0].x)) && near(span(v[0].y), span(orig['lines'][0].y) * Math.exp(-0.6), span(v[0].y)),
      `${at} wheel: 3 notches zoom both axes by exp(-0.6)`, JSON.stringify(v[0]));
    check(near(d0.x, d1.x, span(v[0].x)) && near(d0.y, d1.y, span(v[0].y)), `${at} wheel: the data point under the pointer stays under it`, `${JSON.stringify(d0)} → ${JSON.stringify(d1)}`);
    check(xLabels('lines', v) !== xLabels('lines', orig['lines']), `${at} wheel: tick labels re-located`, xLabels('lines', v));

    // ---- tooltips on the zoomed view: hover a point of the new sidecar
    const pt = await page.evaluate(() => {
      const a = JSON.parse(document.querySelector('#lines g[data-mpl-axes="0"] > metadata')?.textContent ?? '{}').a[0];
      const j = Math.floor(a.d.length / 4);
      return { x: a.d[2 * j], y: a.d[2 * j + 1] };
    });
    p = await screenOf(page, 'lines', 0, pt.x, pt.y);
    await page.mouse.move(p.x, p.y - 1);
    let t = await tipText(page);
    // series name, value, then the position under it, read from the new sidecar to the zoomed axes' resolution
    const shown = /^damped sin (-?[\d.]+) (-?[\d.]+)/.exec(t);
    check(shown !== null && Math.abs(Number(shown[1]) - pt.y) <= span(v[0].y) / 50 && Math.abs(Number(shown[2]) - pt.x) <= span(v[0].x) / 50, `${at} tooltip reads the zoomed sidecar`, `${t} (${pt.x}, ${pt.y})`);
    // and stays inside the chart in the zoomed view, at a corner
    const corner = await boxPoint(page, 'lines', 0, 0.99, 0.02);
    await page.mouse.move(corner.x, corner.y);
    await tipText(page);
    const inChart = await page.evaluate(() => {
      const r = document.querySelector('.mpl-tip')?.getBoundingClientRect(), b = document.querySelector('#lines')?.getBoundingClientRect();
      return !!r && !!b && r.right <= b.right && r.left >= b.left && r.top >= b.top && r.bottom <= b.bottom;
    });
    check(inChart, `${at} zoomed: the tooltip stays in the chart at a corner`);

    // ---- legend toggle survives re-renders
    const lg = async (): Promise<{ x: number; y: number }> => page.evaluate(() => {
      const r = document.querySelectorAll('#lines .mpl-lg')[1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    let q = await lg();
    await page.mouse.click(q.x, q.y);
    p = await boxPoint(page, 'lines', 0, 0.5, 0.6);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, 100);
    await idle(page, 'lines');
    const hidden = await page.evaluate(() => {
      const es = Array.from(document.querySelectorAll('#lines [data-artist^="artist/1/"]'));
      return es.length > 0 && es.every((e) => getComputedStyle(e).display === 'none');
    });
    check(hidden, `${at} a legend-hidden artist stays hidden in the re-rendered frame`);
    q = await lg();
    await page.mouse.click(q.x, q.y);

    // ---- double-click resets to the server's first paint
    p = await boxPoint(page, 'lines', 0);
    await page.mouse.dblclick(p.x, p.y);
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(JSON.stringify(v) === JSON.stringify(orig['lines']), `${at} double-click resets the view`, JSON.stringify(v));
    const after = await page.evaluate(() => {
      const s = document.getElementById('lines');
      if (!s) return '';
      const c = s.cloneNode(true) as Element;
      for (const o of Array.from(c.querySelectorAll('.mpl-overlay, .mpl-zoom-overlay'))) o.remove();
      return c.innerHTML;
    });
    const before = await page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = `<svg>${h}</svg>`; for (const o of Array.from(d.querySelectorAll('.mpl-overlay, .mpl-zoom-overlay'))) o.remove(); return d.firstElementChild?.innerHTML ?? ''; }, firstPaint);
    check(after === before, `${at} reset restores the first paint's DOM exactly`);

    // ---- Shift+drag box zoom: the view becomes the box; a thin box zooms x only
    const a0 = await boxPoint(page, 'lines', 0, 0.2, 0.3), a1 = await boxPoint(page, 'lines', 0, 0.6, 0.7);
    const da = await dataAt(page, 'lines', 0, a0.x, a0.y), db = await dataAt(page, 'lines', 0, a1.x, a1.y);
    await page.keyboard.down('Shift');
    await page.mouse.move(a0.x, a0.y);
    await page.mouse.down();
    await page.mouse.move((a0.x + a1.x) / 2, (a0.y + a1.y) / 2, { steps: 3 });
    const boxShown = await page.evaluate(() => getComputedStyle(document.querySelector('#lines .mpl-zoom-box') ?? document.body).display !== 'none');
    await page.mouse.move(a1.x, a1.y, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(boxShown, `${at} box zoom draws its rectangle while dragging`);
    check(near(v[0].x[0], da.x, span(v[0].x)) && near(v[0].x[1], db.x, span(v[0].x)) && near(v[0].y[0], db.y, span(v[0].y)) && near(v[0].y[1], da.y, span(v[0].y)),
      `${at} box zoom: the view is the box`, `${JSON.stringify(v[0])} vs x ${da.x}..${db.x} y ${db.y}..${da.y}`);
    const yBefore = v[0].y;
    await page.keyboard.down('Shift');
    p = await boxPoint(page, 'lines', 0, 0.3, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 60, p.y + 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(v[0].y[0] === yBefore[0] && v[0].y[1] === yBefore[1] && span(v[0].x) < span(orig['lines'][0].x) / 2, `${at} a thin box zooms x only`, JSON.stringify(v[0]));

    // ---- wheel over the x tick strip zooms x only
    await page.keyboard.press('Escape');
    await idle(page, 'lines');
    p = await boxPoint(page, 'lines', 0, 0.5, 1.06);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -200);
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(v[0].y[0] === orig['lines'][0].y[0] && v[0].y[1] === orig['lines'][0].y[1] && span(v[0].x) < span(orig['lines'][0].x), `${at} wheel on the x tick strip zooms x only`, JSON.stringify(v[0]));

    // ---- keys: focus the chart; + zooms about the centre, ArrowRight pans 10%, Escape resets
    await page.evaluate(() => (document.getElementById('lines') as unknown as SVGSVGElement).focus());
    let w0 = await view(page, 'lines');
    await page.keyboard.press('ArrowRight');
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(near(v[0].x[0], w0[0].x[0] + 0.1 * span(w0[0].x), span(w0[0].x)) && near(v[0].x[1], w0[0].x[1] + 0.1 * span(w0[0].x), span(w0[0].x)), `${at} ArrowRight pans x by 10%`, JSON.stringify(v[0].x));
    w0 = v;
    await page.keyboard.press('+');
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(near(span(v[0].x), 0.8 * span(w0[0].x), span(v[0].x)) && near(v[0].x[0] + v[0].x[1], w0[0].x[0] + w0[0].x[1], span(v[0].x)), `${at} + zooms 0.8x about the centre`, JSON.stringify(v[0].x));
    await page.keyboard.press('Escape');
    await idle(page, 'lines');
    check(JSON.stringify(await view(page, 'lines')) === JSON.stringify(orig['lines']), `${at} Escape resets`);
    // a plot the hover client focused: plain arrows step through points, Shift+arrows pan
    await page.focus('#lines .mpl-kb');
    await page.keyboard.press('ArrowRight');
    t = await tipText(page);
    check(/^damped sin -?[\d.]+ 0( |$)/.test(t), `${at} arrows on a focused plot still step points`, t);
    await page.keyboard.press('Shift+ArrowLeft');
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(near(v[0].x[0], orig['lines'][0].x[0] - 0.1 * span(orig['lines'][0].x), span(v[0].x)), `${at} Shift+ArrowLeft on a focused plot pans`, JSON.stringify(v[0].x));
    check(await page.evaluate(() => document.activeElement?.classList.contains('mpl-kb') ?? false), `${at} focus stays on the plot across the re-render`);
    await page.keyboard.press('Escape');
    await idle(page, 'lines');

    // ---- drag pans (date axis): the date under the press follows the pointer
    await scrollTo(page, 'dates');
    const s0 = await boxPoint(page, 'dates', 0, 0.6, 0.5), s1 = { x: s0.x - Math.round(width / 6), y: s0.y + 20 };
    const dd0 = await dataAt(page, 'dates', 0, s0.x, s0.y);
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    await page.mouse.move(s1.x, s1.y, { steps: 8 });
    await page.mouse.up();
    await idle(page, 'dates');
    v = await view(page, 'dates');
    const dd1 = await dataAt(page, 'dates', 0, s1.x, s1.y);
    check(near(dd0.x, dd1.x, span(v[0].x)) && near(dd0.y, dd1.y, span(v[0].y)), `${at} drag pans the date axis with the pointer`, `${JSON.stringify(dd0)} → ${JSON.stringify(dd1)}`);
    check(near(span(v[0].x), span(orig['dates'][0].x), span(v[0].x)), `${at} a pan keeps the span`);
    check(xLabels('dates', v) !== xLabels('dates', orig['dates']), `${at} date tick labels re-located`, xLabels('dates', v));

    // ---- log axis: wheel zooms in log space about the pointer
    await scrollTo(page, 'logy');
    p = await boxPoint(page, 'logy', 0, 0.5, 0.35);
    const l0 = await dataAt(page, 'logy', 0, p.x, p.y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -150);
    await page.mouse.wheel(0, -150);
    await idle(page, 'logy');
    v = await view(page, 'logy');
    const l1 = await dataAt(page, 'logy', 0, p.x, p.y);
    check(v[0].y[0] > 0 && near(lspan(v[0].y), lspan(orig['logy'][0].y) * Math.exp(-0.6), lspan(v[0].y)), `${at} log y zooms by exp(-0.6) in log space`, JSON.stringify(v[0].y));
    check(near(Math.log10(l0.y), Math.log10(l1.y), lspan(v[0].y)), `${at} log y: the value under the pointer stays`, `${l0.y} → ${l1.y}`);

    // ---- shared x + twin: a drag in the bottom Axes moves every x, only the bottom y
    await scrollTo(page, 'shared');
    const b0 = await boxPoint(page, 'shared', 1, 0.5, 0.5);
    await page.mouse.move(b0.x, b0.y);
    await page.mouse.down();
    await page.mouse.move(b0.x + 80, b0.y - 15, { steps: 5 });
    await page.mouse.up();
    await idle(page, 'shared');
    v = await view(page, 'shared');
    const o = orig['shared'];
    check(v[0].x[0] === v[1].x[0] && v[1].x[0] === v[2].x[0] && v[0].x[1] === v[2].x[1] && v[0].x[0] < o[0].x[0], `${at} sharex + twinx: one pan moves all three x axes`, JSON.stringify(v.map((a) => a.x)));
    check(v[1].y[0] !== o[1].y[0] && v[0].y[0] === o[0].y[0] && v[2].y[0] === o[2].y[0], `${at} the drag moves only its own y`, JSON.stringify(v.map((a) => a.y)));
    p = await boxPoint(page, 'shared', 0, 0.5, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.mouse.wheel(0, -100);
    await idle(page, 'shared');
    const v2 = await view(page, 'shared');
    check(near(span(v2[0].y), span(o[0].y) * Math.exp(-0.2), span(v2[0].y)) && near(span(v2[2].y), span(o[2].y) * Math.exp(-0.2), span(v2[2].y)) && v2[1].y[0] === v[1].y[0],
      `${at} wheel over host + twin zooms both y axes, not the other row's`, JSON.stringify(v2.map((a) => a.y)));
    check(v2[1].x[0] === v2[0].x[0] && near(span(v2[1].x), span(v[1].x) * Math.exp(-0.2), span(v2[1].x)), `${at} ... and the shared x, in every row`);

    // ---- dense chart: canvas frames while the wheel turns, then one settled SVG frame
    await scrollTo(page, 'dense');
    await clearFrames(page);
    p = await boxPoint(page, 'dense', 0, 0.4, 0.4);
    await page.mouse.move(p.x, p.y);
    for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(20); }
    await idle(page, 'dense');
    const fd = (await frames(page)).filter((f) => f.id === 'dense');
    const kinds = fd.map((f) => f.kind[0]).join('');
    check(fd.some((f) => f.kind === 'canvas') && fd[fd.length - 1].kind === 'svg' && fd[fd.length - 1].settle, `${at} dense: canvas while zooming, then a settled SVG frame`, kinds);
    v = await view(page, 'dense');
    check(v[1].set.x === false && v[1].set.y === false, `${at} the colorbar's Axes never zooms`);
    if (shots !== '') {
      for (const id of ['lines', 'dates', 'logy', 'shared', 'dense']) {
        await scrollTo(page, id);
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await page.screenshot({ path: join(shots, `zoom-${id}-${width}-${scheme}.png`) });
        }
      }
      await page.emulateMedia({ colorScheme: 'light' });
    }

    // ---- coalescing: 30 wheel events in one task render once; never two frames in one animation frame
    await scrollTo(page, 'lines');
    await clearFrames(page);
    p = await boxPoint(page, 'lines', 0, 0.5, 0.5);
    await page.evaluate(([x, y]) => {
      const s = document.getElementById('lines');
      for (let i = 0; i < 30; i++) s?.dispatchEvent(new WheelEvent('wheel', { deltaY: -20, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    }, [p.x, p.y] as const);
    await idle(page, 'lines');
    const fl = (await frames(page)).filter((f) => f.id === 'lines');
    check(fl.length === 1, `${at} 30 wheel events in one task: one frame`, `${fl.length}`);
    const all = await frames(page);
    check(new Set(all.map((f) => `${f.id}/${f.tick}`)).size === all.length, `${at} never two frames of a chart in one animation frame`);

    check(errors.length === 0, `${at} no page errors`, errors.join('; '));
    await page.close();
  }

  // ---- pixel-exact, frame by frame: a scripted session on each chart with every frame recorded and compared
  for (const [width, config] of [[1280, {}], [1280, { renderer: 'canvas' }], [420, {}]] as const) {
    const at = `@${width}px ${JSON.stringify(config)}`;
    const { page, errors } = await open(browser, width, { touch: false, config });
    for (const id of Object.keys(CHARTS)) {
      await scrollTo(page, id);
      const p = await boxPoint(page, id, 0, 0.45, 0.45);
      await page.mouse.move(p.x, p.y);
      for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(10); }
      await page.mouse.down();
      await page.mouse.move(p.x + 40, p.y + 10, { steps: 6 });
      await page.mouse.up();
      await idle(page, id);
    }
    const n = await pixelExact(page, at);
    total.svg += n.svg; total.canvas += n.canvas;
    check(n.svg >= 5 && (JSON.stringify(config).includes('canvas') ? n.canvas >= 5 : n.canvas >= 1), `${at} frames compared`, `${n.svg} svg, ${n.canvas} canvas`);
    check(errors.length === 0, `${at} no page errors`, errors.join('; '));
    await page.close();
  }

  // ---- sync: x zooms together on the panels that show the same x; the histogram and the bars by endpoint do not
  {
    const SYNCED = [0, 1, 2, 4, 6], APART = [3, 5];
    const { page, errors } = await open(browser, 1280, { touch: false, config: { renderer: 'svg' } });
    await scrollTo(page, 'dashboard');
    const orig = await view(page, 'dashboard');
    const m = await boxPoint(page, 'dashboard', 0, 0.5, 0.5);
    await page.mouse.move(m.x, m.y);
    await page.evaluate(() => { (window as unknown as { zoomFrames: unknown[] }).zoomFrames.length = 0; });
    for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(16); }
    await idle(page, 'dashboard');
    let v = await view(page, 'dashboard');
    check(SYNCED.every((k) => v[k].x[0] === v[0].x[0] && v[k].x[1] === v[0].x[1] && v[k].set.x) && span(v[0].x) < span(orig[0].x), 'sync: a wheel zoom gives every date panel the same x-limits', JSON.stringify(v.map((a) => a.x)));
    check(APART.every((k) => JSON.stringify(v[k].x) === JSON.stringify(orig[k].x) && !v[k].set.x), 'sync: the histogram and the categorical panel do not move');
    check([1, 2, 4, 6].every((k) => JSON.stringify(v[k].y) === JSON.stringify(orig[k].y) && !v[k].set.y) && v[0].set.y, 'sync: y stays each panel\'s own (only the hovered panel zooms y; the rest keep their limits)');
    const fr = await page.evaluate(() => (window as unknown as { zoomFrames: { id: string; tick: number }[] }).zoomFrames.filter((f) => f.id === 'dashboard').map((f) => f.tick));
    check(fr.length > 0 && new Set(fr).size === fr.length, 'sync: one figure render per animation frame', JSON.stringify(fr));
    // a drag in another panel moves the group the same way
    const c = await boxPoint(page, 'dashboard', 4, 0.5, 0.5), w0 = v;
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x - 40, c.y, { steps: 3 });
    await page.mouse.up();
    await idle(page, 'dashboard');
    v = await view(page, 'dashboard');
    check(v[0].x[0] > w0[0].x[0] && SYNCED.every((k) => v[k].x[0] === v[4].x[0]), 'sync: a pan in the CPU panel moves all of them', JSON.stringify(v[0].x));
    const n = await pixelExact(page, 'sync');
    total.svg += n.svg; total.canvas += n.canvas;
    // a hover in the zoomed view still reads the shared x
    await page.evaluate(() => (window as unknown as { mplZoom: Record<string, { reset: () => void }> }).mplZoom['dashboard'].reset());
    await idle(page, 'dashboard');
    check(JSON.stringify(await view(page, 'dashboard')) === JSON.stringify(orig), 'sync: reset resets every panel');
    check(errors.length === 0, 'sync: no page errors', errors.join('; '));
    await page.close();

    const off = await open(browser, 1280, { touch: false, config: { renderer: 'svg', sync: false } });
    await scrollTo(off.page, 'dashboard');
    const o0 = await view(off.page, 'dashboard'), b = await boxPoint(off.page, 'dashboard', 0, 0.5, 0.5);
    await off.page.mouse.move(b.x, b.y);
    await off.page.mouse.wheel(0, -200);
    await idle(off.page, 'dashboard');
    const o1 = await view(off.page, 'dashboard');
    check(span(o1[0].x) < span(o0[0].x) && JSON.stringify(o1[1].x) === JSON.stringify(o0[1].x), 'sync: false zooms one panel');
    await off.page.close();

    // two figures with one name: the same limits in both, each its own render
    const two = join(ROOT, 'examples/out/zoom-two.html');
    execFileSync(process.execPath, [join(ROOT, 'examples/zoom.ts'), two, 'dashboard', 'dashboard2'], { stdio: 'pipe' });
    const pair = await open(browser, 1280, { touch: false, config: { renderer: 'svg', sync: 'ops' } }, readFileSync(two, 'utf8'), 2);
    await scrollTo(pair.page, 'dashboard');
    const p0 = await view(pair.page, 'dashboard2'), q = await boxPoint(pair.page, 'dashboard', 0, 0.5, 0.5);
    await pair.page.mouse.move(q.x, q.y);
    await pair.page.mouse.wheel(0, -200);
    await idle(pair.page, 'dashboard');
    await idle(pair.page, 'dashboard2');
    const a1 = await view(pair.page, 'dashboard'), a2 = await view(pair.page, 'dashboard2');
    check(a2[1].x[0] === a1[0].x[0] && a2[1].x[1] === a1[0].x[1] && span(a2[1].x) < span(p0[1].x) && JSON.stringify(a2[3].x) === JSON.stringify(p0[3].x), "sync: 'ops' zooms the other figure's date panels, and not its histogram", JSON.stringify([a1[0].x, a2[1].x]));
    const n2 = await pixelExact(pair.page, 'sync across figures');
    total.svg += n2.svg; total.canvas += n2.canvas;
    await pair.page.evaluate(() => (window as unknown as { mplZoom: Record<string, { reset: () => void }> }).mplZoom['dashboard'].reset());
    await idle(pair.page, 'dashboard2');
    check(JSON.stringify(await view(pair.page, 'dashboard2')) === JSON.stringify(p0), 'sync: reset reaches the other figure');
    check(pair.errors.length === 0, 'sync across figures: no page errors', pair.errors.join('; '));
    await pair.page.close();
  }

  // ---- touch: two-finger pinch zooms about the midpoint; one finger pans x
  {
    const { page, errors } = await open(browser, 420, { touch: true, config: {} });
    const cdp = await page.context().newCDPSession(page);
    await scrollTo(page, 'lines');
    const orig = await view(page, 'lines');
    const m = await boxPoint(page, 'lines', 0, 0.5, 0.5), dm = await dataAt(page, 'lines', 0, m.x, m.y);
    const tp = (dx: number, dy: number, id: number): { x: number; y: number; id: number } => ({ x: m.x + dx, y: m.y + dy, id });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(-20, -10, 1), tp(20, 10, 2)] });
    for (let s = 1; s <= 4; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(-20 - 5 * s, -10 - 2.5 * s, 1), tp(20 + 5 * s, 10 + 2.5 * s, 2)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await idle(page, 'lines');
    let v = await view(page, 'lines');
    const dm1 = await dataAt(page, 'lines', 0, m.x, m.y);
    check(near(span(v[0].x), span(orig[0].x) / 2, span(v[0].x)) && near(span(v[0].y), span(orig[0].y) / 2, span(v[0].y)), 'touch: spreading two fingers to twice the distance zooms 2x', JSON.stringify(v[0]));
    check(near(dm.x, dm1.x, span(v[0].x)) && near(dm.y, dm1.y, span(v[0].y)), 'touch: the point between the fingers stays put');
    const w0 = v;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(0, 0, 3)] });
    for (let s = 1; s <= 5; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(-10 * s, 0, 3)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await idle(page, 'lines');
    v = await view(page, 'lines');
    check(v[0].x[0] > w0[0].x[0] && near(span(v[0].x), span(w0[0].x), span(v[0].x)), 'touch: one finger dragged left pans x right', JSON.stringify(v[0].x));
    // a tap on a zoomable chart: no pan, and the value shows on lift, and stays (#49 hid it under the press)
    const v1 = await view(page, 'lines');
    await page.touchscreen.tap(m.x, m.y);
    await idle(page, 'lines');
    await page.waitForTimeout(150);
    let tapped = await tipText(page);
    check(tapped !== '(hidden)', 'touch: a tap on a zoomable chart shows the value', tapped);
    check(JSON.stringify(await view(page, 'lines')) === JSON.stringify(v1), 'touch: a tap does not move the view');
    check(await page.evaluate(() => {
      const r = document.querySelector('.mpl-tip')?.getBoundingClientRect(), b = document.querySelector('#lines')?.getBoundingClientRect();
      return !!r && !!b && r.right <= b.right && r.left >= b.left && r.top >= b.top && r.bottom <= b.bottom;
    }), 'touch: the tapped value stays inside the zoomed chart');
    // panning takes it away; a second tap brings it back
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(0, 0, 4)] });
    for (let s = 1; s <= 3; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(-12 * s, 0, 4)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await idle(page, 'lines');
    check(await tipText(page) === '(hidden)', 'touch: a pan clears the readout and does not leave one');
    await page.touchscreen.tap(m.x + 8, m.y);
    await idle(page, 'lines');
    tapped = await tipText(page);
    check(tapped !== '(hidden)', 'touch: the next tap shows it again', tapped);
    await page.keyboard.press('Escape');
    await idle(page, 'lines');
    const n = await pixelExact(page, 'touch');
    total.svg += n.svg; total.canvas += n.canvas;
    check(errors.length === 0, 'touch: no page errors', errors.join('; '));
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`zoom: ${checks - fails}/${checks} checks; frames pixel-exact vs Node: ${total.svg} svg, ${total.canvas} canvas`);
console.log(fails === 0 ? 'zoom: ok' : `zoom: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
