// mpl/interactive in real headless Chromium (Playwright): examples/interactive.ts's page, four annotated SVGs inlined
// with prefixed ids and scaled by CSS. Real pointer events at a sidecar point's screen position must produce the
// right tooltip; legend entries toggle by click and keyboard; arrow keys step through points; the mapping holds at
// several viewport widths. `npm run test:interactive` (needs `npx playwright install chromium-headless-shell`).
// SHOTS=dir also writes light and dark screenshots while hovering.
/* oxlint-disable no-await-in-loop -- one browser page, driven step by step */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { dashboard } from '../examples/_zoom-charts.ts';

const ROOT = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'examples/interactive.ts')], { stdio: 'pipe' });
// the example page, with attach()'s argument taken from the test (window.mplAttach, set before the page loads)
const html = readFileSync(join(ROOT, 'examples/out/interactive.html'), 'utf8')
  .replace(/attach\(document\);(?=\s*<\/script>)/, "attach(document, window.mplFormat ? (v) => 'F' + v : window.mplAttach || {});");
const shots = process.env['SHOTS'] ?? '';

const executablePath = process.env['CHROMIUM_PATH'];
const browser = await chromium.launch(typeof executablePath === 'string' && executablePath !== '' ? { executablePath } : {});
let fails = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${detail === '' ? '' : `: ${detail}`}`);
};

/** Screen position of artist `a`'s point `j` in Axes `k` of SVG `#id`, read from its sidecar and getScreenCTM. */
const pointAt = (page: Page, id: string, k: number, a: number, j: number): Promise<{ x: number; y: number }> =>
  page.evaluate(([sid, ax, ai, pj]) => {
    const svg = document.querySelector<SVGSVGElement>(`#${String(sid)}`);
    if (!svg) throw new Error(`no svg #${String(sid)}`);
    const md = svg.querySelector(`g[data-mpl-axes="${ax}"] > metadata`);
    const art = JSON.parse(md?.textContent ?? '{}').a[ai];
    const p = new DOMPoint(art.p[2 * Number(pj)], art.p[2 * Number(pj) + 1]).matrixTransform(svg.getScreenCTM() ?? new DOMMatrix());
    return { x: p.x, y: p.y };
  }, [id, k, a, j] as const);
const tipText = (page: Page): Promise<string> => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const t = document.querySelector<HTMLElement>('.mpl-tip');
  // every row, whatever the compact styles show
  return t && !t.hidden ? Array.from(t.children, (c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim() : '(hidden)';
});
const hover = async (page: Page, id: string, k: number, a: number, j: number, dx = 0, dy = 0): Promise<string> => {
  const el = await page.$(`#${id}`);
  await el?.scrollIntoViewIfNeeded();
  const p = await pointAt(page, id, k, a, j);
  await page.mouse.move(p.x + dx, p.y + dy);
  return tipText(page);
};

type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const rectOf = (page: Page, sel: string): Promise<Box> => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) throw new Error(`no ${s}`);
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
}, sel);
const settle = (page: Page): Promise<unknown> => page.evaluate(() => new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); }));
/** A client position inside Axes 0 of `id`: fx, fy are fractions across its box. */
const inAxes = (page: Page, id: string, fx: number, fy: number): Promise<{ x: number; y: number }> => page.evaluate(([sid, a, b]) => {
  const svg = document.querySelector<SVGSVGElement>(`#${String(sid)}`);
  if (!svg) throw new Error('no svg');
  const box: number[] = JSON.parse(svg.querySelector('g[data-mpl-axes="0"] > metadata')?.textContent ?? '{}').box;
  const q = new DOMPoint(box[0] + (box[2] - box[0]) * Number(a), box[1] + (box[3] - box[1]) * Number(b)).matrixTransform(svg.getScreenCTM() ?? new DOMMatrix());
  return { x: q.x, y: q.y };
}, [id, fx, fy] as const);
type Sync = { line: boolean; dots: number; x: number };
const synced = (page: Page, id: string, k: number): Promise<Sync> => page.evaluate(async ([sid, ax]) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const svg = document.querySelector(`#${String(sid)}`), order = Array.from(svg?.querySelectorAll('g[data-mpl-axes]') ?? []).map((g) => Number(g.getAttribute('data-mpl-axes')));
  const gs = Array.from(svg?.querySelectorAll<SVGGElement>('.mpl-ghost') ?? []).toReversed();   // prepended: last Axes first
  const g = gs[order.indexOf(Number(ax))];
  const shown = !!g && g.style.display === '', line = g?.querySelector<SVGLineElement>('line');
  return { line: shown && !!line && line.style.display === '', dots: shown ? Array.from(g.querySelectorAll<SVGElement>('circle')).filter((c) => c.style.display === '').length : 0, x: Number(line?.getAttribute('x1') ?? 0) };
}, [id, k] as const);
const dataX = (page: Page, id: string, k: number, px: number): Promise<number> => page.evaluate(([sid, ax, p]) => {
  const j = JSON.parse(document.querySelector(`#${String(sid)} g[data-mpl-axes="${ax}"] > metadata`)?.textContent ?? '{}');
  return j.x.lim[0] + ((Number(p) - j.box[0]) / (j.box[2] - j.box[0])) * (j.x.lim[1] - j.x.lim[0]);
}, [id, k, px] as const);
const two = (id: string): string => dashboard().toSVG({ interactive: true, idPrefix: `${id}-` }).replace(/^<svg([^>]*) width="[^"]*" height="[^"]*"/, `<svg$1 id="${id}"`);

try {
  for (const width of [1280, 420]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.mpl-overlay').length === 5);
    const at = `@${width}px`;

    // several SVGs in one page: no id is defined twice
    const dupes = await page.evaluate(() => { const ids = Array.from(document.querySelectorAll('[id]'), (e) => e.id); return ids.filter((v, i) => ids.indexOf(v) !== i); });
    check(dupes.length === 0, `${at} ids unique across inlined SVGs`, dupes.slice(0, 3).join(', '));

    // lines: snap to x; sin at x = 2 is sin(2)
    let t = await hover(page, 'lines', 0, 0, 12, 0, -2);
    check(t === 'sin 0.909 2', `${at} line tooltip: series, value, muted position; no x/y letters`, t);
    check(await page.evaluate(() => document.querySelectorAll('#lines .mpl-dim').length > 0 && !document.querySelector('#lines [data-artist^="artist/0/"]')?.classList.contains('mpl-dim')),
      `${at} hover dims the other artists, not the hovered one`);
    // scatter: nearest 2D point
    t = await hover(page, 'lines', 0, 2, 1, 3, 3);
    check(t === 'samples -0.4 3', `${at} scatter tooltip, no cursor line by default`, t);

    // legend: click 'cos' off, its groups hide and hover skips it; Enter turns it back on
    const lg = await page.evaluate(() => {
      const r = document.querySelectorAll('#lines .mpl-lg')[1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.click(lg.x, lg.y);
    const hidden = await page.evaluate(() => Array.from(document.querySelectorAll('#lines [data-artist^="artist/1/"]')).every((e) => getComputedStyle(e).display === 'none'));
    check(hidden, `${at} legend click hides the artist`);
    t = await hover(page, 'lines', 0, 1, 30);
    check(!t.startsWith('cos'), `${at} a hidden artist is never the nearest`, t);
    await page.focus('#lines .mpl-lg:nth-of-type(2)');
    await page.keyboard.press('Enter');
    const back = await page.evaluate(() => ({
      shown: Array.from(document.querySelectorAll('#lines [data-artist^="artist/1/"]')).every((e) => getComputedStyle(e).display !== 'none'),
      pressed: document.querySelectorAll('#lines .mpl-lg')[1].getAttribute('aria-pressed'),
    }));
    check(back.shown && back.pressed === 'true', `${at} legend Enter shows it again`, JSON.stringify(back));

    // date axis, steps-post: between points 4 and 5 (nearer 5) the value shown is point 4's
    const p4 = await pointAt(page, 'dates', 0, 0, 4), p5 = await pointAt(page, 'dates', 0, 0, 5);
    await page.mouse.move(p4.x + 0.7 * (p5.x - p4.x), p4.y);
    t = await tipText(page);
    check(t === 'deploys / day 26 Oct 5', `${at} date + steps-post tooltip: daily data reads as a day`, t);

    // log bars + twinx: the cursor readout lists both y axes; a bar reports its top and height above its base
    t = await hover(page, 'logtwin', 0, 0, 1, 0, -4);
    check(t === 'requests 40 2', `${at} log bar tooltip`, t);
    t = await hover(page, 'logtwin', 1, 0, 2);
    check(t === 'p99 ms 31 3', `${at} twin line tooltip`, t);

    // subplots: categories by name (barh snaps on y), inverted y
    t = await hover(page, 'grid', 0, 0, 1, -10, 0);
    check(t === 'score 9 beta', `${at} barh: value along x, category below`, t);
    t = await hover(page, 'grid', 1, 0, 3);
    check(t === 'depth 3 3', `${at} inverted-axis tooltip`, t);
    // highlight stays inside the hovered Axes: its neighbour keeps full strength, the highlighted Axes only dims series
    check(await page.evaluate(() => document.querySelectorAll('#grid g[data-mpl-axes="0"] .mpl-dim, #lines .mpl-dim, #dates .mpl-dim, #logtwin .mpl-dim').length === 0),
      `${at} other panels are not dimmed`);

    // keyboard: focus a plot, step with the arrow keys (the first press lands on point 0)
    await page.mouse.move(0, 0);
    await page.focus('#lines .mpl-kb');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    t = await tipText(page);
    check(t === 'sin 0.166 0.167', `${at} arrow keys step through points`, t);
    await page.keyboard.press('Escape');
    check(await tipText(page) === '(hidden)', `${at} Escape hides the tooltip`);

    // leaving the SVG hides everything
    await hover(page, 'lines', 0, 0, 12);
    await page.mouse.move(2, 2);
    check(await tipText(page) === '(hidden)' && await page.evaluate(() => document.querySelectorAll('.mpl-dim').length === 0), `${at} pointerleave clears`);

    if (shots !== '') {
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await hover(page, 'lines', 0, 0, 12, 0, -2);
        await page.screenshot({ path: join(shots, `interactive-${width}-${scheme}.png`), fullPage: false });
      }
    }
    check(errors.length === 0, `${at} no page errors`, errors.join('; '));
    await page.close();
  }

  // ------------------------------------------------------------------ the tooltip: box, touch, options, several SVGs
  const open = async (width: number, touch: boolean, config: unknown = {}, format = false): Promise<{ page: Page; errors: string[] }> => {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: touch, timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluate(([c, f]) => { const w = window as unknown as Record<string, unknown>; w['mplAttach'] = c; w['mplFormat'] = f; }, [config, format] as const);   // setContent keeps this window
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.mpl-overlay').length === 5);
    return { page, errors };
  };
  const within = (t: Box, c: Box, m = 4): boolean => t.left >= c.left + m - 1 && t.right <= c.right - m + 1 && t.top >= c.top + m - 1 && t.bottom <= c.bottom - m + 1;
  const EDGES: readonly [string, number, number][] = [['left', 0.01, 0.5], ['right', 0.99, 0.5], ['top', 0.5, 0.01], ['bottom', 0.5, 0.99], ['top-left', 0.01, 0.01], ['bottom-right', 0.99, 0.99]];

  for (const width of [1280, 390]) {
    const { page, errors } = await open(width, false);
    const at = `@${width}px`;
    await (await page.$('#lines'))?.scrollIntoViewIfNeeded();
    for (const [name, fx, fy] of EDGES) {
      const p = await inAxes(page, 'lines', fx, fy);
      await page.mouse.move(p.x, p.y);
      await settle(page);
      const tip = await rectOf(page, '.mpl-tip'), svg = await rectOf(page, '#lines');
      check(within(tip, svg), `${at} mouse at the ${name} edge: the tooltip stays in the chart`, JSON.stringify(tip));
    }
    await page.mouse.move(2, 2);
    check(errors.length === 0, `${at} clamping: no page errors`, errors.join('; '));
    await page.close();
  }

  {
    const { page, errors } = await open(390, true);
    const at = '@390px touch';
    await (await page.$('#lines'))?.scrollIntoViewIfNeeded();
    const tap = async (p: { x: number; y: number }): Promise<void> => { await page.touchscreen.tap(p.x, p.y); await settle(page); };

    // a tapped value stays after the finger lifts
    const p12 = await pointAt(page, 'lines', 0, 0, 12);
    await tap(p12);
    await page.waitForTimeout(200);
    check(await tipText(page) === 'sin 0.909 2', `${at} a tapped value survives the finger lifting`, await tipText(page));
    check(await page.evaluate(() => document.querySelector<SVGElement>('#lines .mpl-cross')?.style.display === ''), `${at} and its crosshair`);
    // above the finger: low on the chart there is room for it
    const p30 = await pointAt(page, 'lines', 0, 0, 30);
    await tap(p30);
    const tip = await rectOf(page, '.mpl-tip');
    check(tip.bottom <= p30.y - 31 && Math.abs((tip.left + tip.right) / 2 - p30.x) <= 2, `${at} sits above the finger`, JSON.stringify({ tip, finger: p30 }));
    // compact on a narrow chart: the case that covered a third of a 375 px chart
    const sv = await rectOf(page, '#lines'), cls = await page.evaluate(() => document.querySelector('.mpl-tip')?.classList.contains('mpl-tip-compact'));
    const share = (tip.width * tip.height) / (sv.width * sv.height);
    check(cls === true && share < 0.08, `${at} compact by default on a narrow chart`, `${(100 * share).toFixed(1)}% of the chart, ${tip.width.toFixed(0)}x${tip.height.toFixed(0)}`);
    // the next tap replaces it
    await tap(await pointAt(page, 'lines', 0, 0, 30));
    check((await tipText(page)).startsWith('sin -0.9'), `${at} the next tap replaces it`, await tipText(page));
    // a tap inside the SVG but outside the axes
    const out = await inAxes(page, 'lines', 0.5, 1.09);
    await tap(out);
    check(await tipText(page) === '(hidden)', `${at} a tap outside the axes dismisses`);
    // a tap outside the chart
    await tap(p12);
    const h1 = await rectOf(page, 'h1');
    await tap({ x: h1.left + 20, y: h1.top + h1.height / 2 });
    check(await tipText(page) === '(hidden)' && await page.evaluate(() => document.querySelectorAll('.mpl-dim').length === 0), `${at} a tap on the page dismisses`);
    // Escape
    await tap(p12);
    await page.keyboard.press('Escape');
    check(await tipText(page) === '(hidden)', `${at} Escape dismisses`);
    // near the top of the chart the tooltip goes below the finger, and every edge clamps
    for (const [name, fx, fy] of EDGES) {
      const p = await inAxes(page, 'lines', fx, fy);
      await tap(p);
      const t = await rectOf(page, '.mpl-tip'), svg = await rectOf(page, '#lines');
      check(within(t, svg), `${at} tap at the ${name} edge: inside the chart`, JSON.stringify(t));
      check(!(t.left <= p.x && p.x <= t.right && t.top <= p.y && p.y <= t.bottom), `${at} tap at the ${name} edge: not under the finger`, JSON.stringify({ t, p }));
    }
    // a scroll carries the readout with its chart
    await tap(p12);
    const b0 = await rectOf(page, '.mpl-tip');
    await page.evaluate(() => { window.scrollBy(0, 60); });
    await settle(page);
    const b1 = await rectOf(page, '.mpl-tip');
    check(Math.abs(b1.top - (b0.top - 60)) <= 1.5 || await page.evaluate(() => scrollY === 0), `${at} scrolling moves the readout with the chart`, JSON.stringify([b0.top, b1.top]));
    await page.evaluate(() => { window.scrollTo(0, 0); });

    // several SVGs on a page: one readout at a time, in the chart that has it
    await (await page.$('#dates'))?.scrollIntoViewIfNeeded();
    await tap(await pointAt(page, 'dates', 0, 0, 10));
    check((await tipText(page)).startsWith('deploys / day'), `${at} tapped the second chart`, await tipText(page));
    const db = await rectOf(page, '.mpl-tip'), dsv = await rectOf(page, '#dates');
    check(within(db, dsv), `${at} clamped to that chart, not the first`, JSON.stringify(db));
    await (await page.$('#logtwin'))?.scrollIntoViewIfNeeded();
    await tap(await pointAt(page, 'logtwin', 0, 0, 1));
    const st = await page.evaluate(() => ({
      tips: document.querySelectorAll('.mpl-tip').length,
      first: document.querySelector<SVGElement>('#dates .mpl-cross')?.style.display,
      second: document.querySelector<SVGElement>('#logtwin .mpl-cross')?.style.display,
    }));
    check(st.tips === 1 && st.first === 'none' && st.second === '', `${at} a tap on another chart moves the readout, one crosshair at a time`, JSON.stringify(st));

    // nothing to read (every series toggled off): the crosshair alone, no empty box
    const off = await (await page.$('#dates .mpl-lg'))?.boundingBox();
    await (await page.$('#dates'))?.scrollIntoViewIfNeeded();
    if (off) await tap({ x: off.x + off.width / 2, y: off.y + off.height / 2 });
    const mid = await inAxes(page, 'dates', 0.3, 0.3);
    await tap(mid);
    check(await tipText(page) === '(hidden)' && await page.evaluate(() => document.querySelector<SVGElement>('#dates .mpl-cross')?.style.display === ''), `${at} no point to report: crosshair only`, await tipText(page));
    check(errors.length === 0, `${at} no page errors`, errors.join('; '));
    await page.close();
  }

  // the options: size, position and the cursor readout
  {
    const { page, errors } = await open(1280, false, { compact: 1e9, gap: 40, margin: 12, placement: 'above', cursor: true });
    await (await page.$('#lines'))?.scrollIntoViewIfNeeded();
    const p = await pointAt(page, 'lines', 0, 0, 30);
    await page.mouse.move(p.x, p.y);
    const t = await tipText(page);
    check(/^sin -?[\d.]+ [\d.]+ [\d.-]+ · [\d.-]+$/.test(t), 'option cursor: the cursor line comes back, without x/y letters', t);
    const tip = await rectOf(page, '.mpl-tip');
    check(await page.evaluate(() => document.querySelector('.mpl-tip')?.classList.contains('mpl-tip-compact')) === true, 'option compact: always');
    check(Math.abs(tip.bottom - (p.y - 40)) <= 1.5 && Math.abs((tip.left + tip.right) / 2 - p.x) <= 2, 'option placement above, gap 40', JSON.stringify({ tip, p }));
    const corner = await inAxes(page, 'lines', 0.99, 0.5);
    await page.mouse.move(corner.x, corner.y);
    await settle(page);
    const t2 = await rectOf(page, '.mpl-tip'), svg = await rectOf(page, '#lines');
    check(t2.right <= svg.right - 11, 'option margin 12', JSON.stringify([t2.right, svg.right]));
    // CSS custom properties reach the tooltip
    await page.addStyleTag({ content: ':root{--mpl-tip-compact-padding:9px 13px;--mpl-tip-shadow:none;--mpl-tip-small-size:9px;--mpl-tip-max-width:90px}' });
    await page.mouse.move(p.x + 3, p.y);
    await settle(page);
    const cs = await page.evaluate(() => { const e = document.querySelector('.mpl-tip'), g = e ? getComputedStyle(e) : getComputedStyle(document.body), sm = e?.querySelector('small'); return { pad: g.paddingLeft, shadow: g.boxShadow, small: sm ? getComputedStyle(sm).fontSize : '', w: e?.getBoundingClientRect().width ?? 0 }; });
    check(cs.pad === '13px' && cs.shadow === 'none' && cs.small === '9px' && cs.w <= 90.5, 'CSS custom properties tune it', JSON.stringify(cs));
    check(errors.length === 0, 'options: no page errors', errors.join('; '));
    await page.close();
  }
  // ------------------------------------------------------------------ sync across panels
  for (const width of [1280, 390]) {
    const touch = width === 390, { page, errors } = await open(width, touch), at = `sync @${width}px${touch ? ' touch' : ''}`;
    await (await page.$('#dash'))?.scrollIntoViewIfNeeded();
    const pt = await pointAt(page, 'dash', 0, 2, 60);
    if (touch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.move(pt.x, pt.y);
    await settle(page);
    const t = await tipText(page), dated = await dataX(page, 'dash', 0, (await page.evaluate(([x, y]) => new DOMPoint(Number(x), Number(y)).matrixTransform(document.querySelector<SVGSVGElement>('#dash')?.getScreenCTM()?.inverse() ?? new DOMMatrix()).x, [pt.x, pt.y] as const)));
    check(t.startsWith('p99 '), `${at} the hovered panel has the tooltip`, t);
    for (const [k, name, dots] of [[1, 'budget', 1], [2, 'throughput', 1], [4, 'cpu', 1]] as const) {
      const s = await synced(page, 'dash', k), x = await dataX(page, 'dash', k, s.x);
      check(s.line && s.dots === dots && Math.abs(x - dated) < 1e-4, `${at} ${name}: crosshair at the same x, a dot per series`, JSON.stringify(s));
    }
    const twin = await synced(page, 'dash', 6);
    check(twin.dots === 1, `${at} the twin's series gets its dot too`, JSON.stringify(twin));
    for (const [k, name] of [[3, 'histogram'], [5, 'categorical bars']] as const) {
      const s = await synced(page, 'dash', k);
      check(!s.line && s.dots === 0, `${at} ${name} stays out of sync`, JSON.stringify(s));
    }
    const own = await synced(page, 'dash', 0);
    check(!own.line && own.dots === 2, `${at} the hovered panel: no second line, a dot on its other series`, JSON.stringify(own));
    check(await page.evaluate(() => document.querySelectorAll('.mpl-tip:not([hidden])').length === 1 && document.querySelectorAll('#dash .mpl-cross line[y1]').length >= 2), `${at} one tooltip`);
    check(await page.evaluate(() => Array.from(document.querySelectorAll('#dash [data-mpl-axes]')).filter((g) => g.getAttribute('data-mpl-axes') !== '0').every((g) => g.querySelectorAll('.mpl-dim').length === 0)), `${at} other panels not dimmed`);
    if (touch) {
      await page.waitForTimeout(200);
      check((await synced(page, 'dash', 1)).line, `${at} a tapped value's crosshairs stay`);
      const h1 = await rectOf(page, 'h1');
      await page.touchscreen.tap(h1.left + 20, h1.top + h1.height / 2);
      await settle(page);
      check(!(await synced(page, 'dash', 1)).line, `${at} and go with it`);
    } else {
      await page.mouse.move(2, 2);
      await settle(page);
      check(!(await synced(page, 'dash', 1)).line, `${at} leaving clears the other panels`);
    }
    check(errors.length === 0, `${at} no page errors`, errors.join('; '));
    await page.close();
  }
  // the tooltip describes the crosshair's x: an outlier wins only under the pointer
  {
    const { page, errors } = await open(1280, false);
    await (await page.$('#dash'))?.scrollIntoViewIfNeeded();
    const crossX = (): Promise<{ line: number; dot: number }> => page.evaluate(() => {
      const c = document.querySelector('#dash .mpl-cross'), l = c?.querySelector('line'), d = c?.querySelector('circle');
      return { line: Number(l?.getAttribute('x1')), dot: Number(d?.getAttribute('cx')) };
    });
    const out = await pointAt(page, 'dash', 0, 3, 2);   // the third outlier (ts[60] = 10:00)
    // 14 screen px left of it (and 6 down): near, but off the marker: the tooltip is a line's, at the crosshair
    await page.mouse.move(out.x - 14, out.y + 6);
    let t = await tipText(page);
    check(/^p(50|95|99) /.test(t) && / Nov 5, \d\d:\d0$/.test(t), 'near an outlier, not on it: the tooltip is a line point', t);
    let c = await crossX();
    check(Math.abs(c.line - c.dot) < 0.01, 'the crosshair snaps to the reported point', JSON.stringify(c));
    const cl = await page.evaluate(() => { const svg = document.querySelector<SVGSVGElement>('#dash'), line = svg?.querySelector('.mpl-cross line'), j = JSON.parse(svg?.querySelector('g[data-mpl-axes="0"] > metadata')?.textContent ?? '{}'); const p = (Number(line?.getAttribute('x1')) - j.box[0]) / (j.box[2] - j.box[0]); return j.x.lim[0] + p * (j.x.lim[1] - j.x.lim[0]); });
    const stamp = new Date(Math.round(cl * 86400) * 1000);
    const hhmm = `${String(stamp.getUTCHours()).padStart(2, '0')}:${String(stamp.getUTCMinutes()).padStart(2, '0')}`;
    check(t.endsWith(hhmm), 'the tooltip time is the crosshair time', `${t} vs ${hhmm}`);
    const peer = await synced(page, 'dash', 1), peerX = await dataX(page, 'dash', 1, peer.x);
    check(Math.abs(peerX - cl) < 1e-4, 'the other panels sit at that same x', `${peerX} vs ${cl}`);
    // directly on it (hit radius: the marker's, plus a few px): the marker's value, its time, named by the fallback
    await page.mouse.move(out.x + 1, out.y);
    t = await tipText(page);
    check(/^API latency 3[3-9]\d ms Nov 5, 10:00$/.test(t), 'on an outlier: its value and time, named by the Axes title', t);
    c = await crossX();
    check(Math.abs(c.line - (await page.evaluate(() => JSON.parse(document.querySelector('#dash g[data-mpl-axes="0"] > metadata')?.textContent ?? '{}').a[3].p[4]))) < 0.01, 'the crosshair snaps to the marker too', JSON.stringify(c));
    check(await page.evaluate(() => { const u = document.querySelector('.mpl-tip u'); return !!u && getComputedStyle(u).opacity !== '1'; }), 'the fallback name is muted');
    check(errors.length === 0, 'outliers: no page errors', errors.join('; '));
    await page.close();
  }
  // opt out; and a name links separate figures (with idPrefix)
  {
    const { page } = await open(1280, false, { sync: false });
    await (await page.$('#dash'))?.scrollIntoViewIfNeeded();
    await hover(page, 'dash', 0, 2, 60);
    check(!(await synced(page, 'dash', 1)).line, 'sync: false turns it off');
    await page.close();
  }
  {
    const client = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 800 } })).newPage();
    await page.evaluate(() => { (window as unknown as Record<string, unknown>)['mplAttach'] = { sync: 'ops' }; });
    await page.setContent(`<!doctype html><style>svg{display:block;width:900px;height:auto}</style>${two('one')}${two('two')}<script type="module">${client}</script>`, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.mpl-overlay').length === 2);
    await hover(page, 'one', 0, 2, 60);
    const a = await synced(page, 'two', 0), b = await synced(page, 'two', 3);
    check(a.line && a.dots === 3 && !b.line, "sync: 'ops' links two figures by the same rule, across idPrefixes", JSON.stringify([a, b]));
    await page.close();
  }

  // attach(root, format) still takes a bare formatter, whose text is used as is
  {
    const { page } = await open(1280, false, {}, true);
    const t = await hover(page, 'lines', 0, 0, 12);
    check(t.startsWith('sin F0.909') && !t.includes(' ms'), 'attach(root, format): the formatter is used', t);
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(fails === 0 ? 'interactive: ok' : `interactive: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
