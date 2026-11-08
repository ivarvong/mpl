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

const ROOT = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'examples/interactive.ts')], { stdio: 'pipe' });
const html = readFileSync(join(ROOT, 'examples/out/interactive.html'), 'utf8');
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
  return t && !t.hidden ? (t.innerText ?? '').replace(/\s+/g, ' ').trim() : '(hidden)';
});
const hover = async (page: Page, id: string, k: number, a: number, j: number, dx = 0, dy = 0): Promise<string> => {
  const el = await page.$(`#${id}`);
  await el?.scrollIntoViewIfNeeded();
  const p = await pointAt(page, id, k, a, j);
  await page.mouse.move(p.x + dx, p.y + dy);
  return tipText(page);
};

try {
  for (const width of [1280, 420]) {
    const page = await (await browser.newContext({ viewport: { width, height: 900 }, timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' })).newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => document.querySelectorAll('.mpl-overlay').length === 4);
    const at = `@${width}px`;

    // several SVGs in one page: no id is defined twice
    const dupes = await page.evaluate(() => { const ids = Array.from(document.querySelectorAll('[id]'), (e) => e.id); return ids.filter((v, i) => ids.indexOf(v) !== i); });
    check(dupes.length === 0, `${at} ids unique across inlined SVGs`, dupes.slice(0, 3).join(', '));

    // lines: snap to x; sin at x = 2 is sin(2)
    let t = await hover(page, 'lines', 0, 0, 12, 0, -2);
    check(t.startsWith('sin x 2 y 0.9092974'), `${at} line tooltip`, t);
    check(await page.evaluate(() => document.querySelectorAll('#lines .mpl-dim').length > 0 && !document.querySelector('#lines [data-artist^="artist/0/"]')?.classList.contains('mpl-dim')),
      `${at} hover dims the other artists, not the hovered one`);
    // scatter: nearest 2D point
    t = await hover(page, 'lines', 0, 2, 1, 3, 3);
    check(t.startsWith('samples x 3 y -0.4'), `${at} scatter tooltip`, t);
    // cursor readout: linear to the axis' pixel resolution
    check(/x [\d.-]+ · y [\d.-]+$/.test(t), `${at} cursor readout`, t);

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
    check(t.startsWith('deploys / day x 2026-10-05 y 26'), `${at} date + steps-post tooltip`, t);
    check(/x 2026-10-\d\d \d\d:\d\d · y [\d.]+$/.test(t), `${at} date cursor readout`, t);

    // log bars + twinx: the cursor readout lists both y axes; a bar reports its top and height above its base
    t = await hover(page, 'logtwin', 0, 0, 1, 0, -4);
    check(t.startsWith('requests x 2 y 40'), `${at} log bar tooltip`, t);
    check(/ · y [\d.]+ · y2 [\d.]+$/.test(t), `${at} twinx readout has y and y2`, t);
    t = await hover(page, 'logtwin', 1, 0, 2);
    check(t.startsWith('p99 ms x 3 y 31'), `${at} twin line tooltip`, t);

    // subplots: categories by name (barh snaps on y), inverted y
    t = await hover(page, 'grid', 0, 0, 1, -10, 0);
    check(t.startsWith('score x 9 y beta'), `${at} barh category tooltip`, t);
    t = await hover(page, 'grid', 1, 0, 3);
    check(t.startsWith('depth x 3 y 3'), `${at} inverted-axis tooltip`, t);

    // keyboard: focus a plot, step with the arrow keys (the first press lands on point 0)
    await page.mouse.move(0, 0);
    await page.focus('#lines .mpl-kb');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    t = await tipText(page);
    check(t.startsWith('sin x 0.1666667 y 0.1658961'), `${at} arrow keys step through points`, t);
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
} finally {
  await browser.close();
}
console.log(fails === 0 ? 'interactive: ok' : `interactive: ${fails} failure(s)`);
process.exit(fails === 0 ? 0 : 1);
