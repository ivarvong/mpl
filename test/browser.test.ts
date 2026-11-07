// dist/browser (the published ES modules, unbundled) in real headless Chromium via Playwright: each runtime
// case renders toSVG() and toPNGSync() in the page, and both must equal mpl-on-Node byte for byte and
// match matplotlib's Agg PNG pixel for pixel. `npm run test:browser` (needs `npx playwright install chromium-headless-shell`).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { chromium } from 'playwright';
import { check, fixtures, PALETTE, type RuntimeOutput } from './runtime/common.ts';

const ROOT = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'scripts/build_package.ts')], { stdio: 'pipe' });
const DIST = join(ROOT, 'dist/browser');
const replayJs = stripTypeScriptTypes(readFileSync(join(ROOT, 'tools/replay-core.ts'), 'utf8'), { mode: 'strip' });
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html' };

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>mpl</title>'); return; }
  if (url.pathname === '/replay-core.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(replayJs); return; }
  const p = normalize(join(DIST, url.pathname.replace(/^\/lib\//, '/')));
  if (!url.pathname.startsWith('/lib/') || !p.startsWith(DIST)) { res.writeHead(404); res.end(); return; }
  try { statSync(p); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
  res.end(readFileSync(p));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

// CHROMIUM_PATH runs a system or pre-installed Chromium when Playwright's own build is not downloaded
const executablePath = process.env['CHROMIUM_PATH'];
const browser = await chromium.launch(typeof executablePath === 'string' && executablePath !== '' ? { executablePath } : {});
let fails = 0;
try {
  // an unusual time zone and locale: output must not depend on either
  const page = await (await browser.newContext({ timezoneId: 'Pacific/Kiritimati', locale: 'de-DE' })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(origin + '/');
  const ua = await page.evaluate(() => navigator.userAgent);
  // main entry: DejaVu Sans is built in; bold without its face fails typed
  const main = await page.evaluate(async () => {
    const lib: string = '/lib/index.js';
    const m = await import(lib) as typeof import('../src/index.ts');
    const [fig, ax] = m.subplots(); ax.plot([1, 2, 3], [1, 4, 9]);
    const ok = fig.toSVG().startsWith('<svg') && fig.toPNGSync().length > 100;
    ax.set_title('bold', { fontweight: 'bold' });
    let err = 'rendered';
    try { fig.toSVG(); } catch (e) { err = e instanceof m.FontNotLoadedError ? `${e.name} ${e.face} ${e.module}` : String(e); }
    const fetched = performance.getEntriesByType('resource').map((r) => new URL(r.name).pathname).filter((p) => p.startsWith('/lib/fonts/'));
    return { ok, err, fetched };
  });
  const mainOk = main.ok && main.err === 'FontNotLoadedError DejaVu Sans:700 mpl/fonts/dejavu-sans-bold' && JSON.stringify(main.fetched) === '["/lib/fonts/dejavu-sans.js"]';
  if (!mainOk) fails++;
  console.log(`${mainOk ? 'PASS' : 'FAIL'} chromium main entry: fetched ${main.fetched.join(', ')}; bold without its face → ${main.err}`);

  // lean entry: nothing registered; default face and default cmap throw
  await page.reload();
  const lean2 = await page.evaluate(async () => {
    const corePath: string = '/lib/core.js';
    const m = await import(corePath) as typeof import('../src/core.ts');
    const [fig, ax] = m.subplots(); ax.plot([1, 2], [1, 2]);
    let fontErr = 'rendered';
    try { fig.toSVG(); } catch (e) { fontErr = e instanceof m.FontNotLoadedError ? e.name : String(e); }
    const faceMod = '/lib/fonts/dejavu-sans.js';
    const { dejavuSans } = await import(faceMod) as typeof import('../src/fonts/dejavu-sans.ts');
    m.registerFonts(dejavuSans);
    fig.toSVG();
    let cmapErr = 'rendered';
    try { ax.imshow([[0, 1], [2, 3]]); } catch (e) { cmapErr = e instanceof m.ColormapNotLoadedError ? `${e.name} ${e.cmap}` : String(e); }
    return { fontErr, cmapErr };
  });
  const leanOk = lean2.fontErr === 'FontNotLoadedError' && lean2.cmapErr === 'ColormapNotLoadedError viridis';
  if (!leanOk) fails++;
  console.log(`${leanOk ? 'PASS' : 'FAIL'} chromium mpl/core: font→${lean2.fontErr}; imshow default cmap→${lean2.cmapErr}`);

  type Out = { name: string; svg: string; png64: string; pal64: string; ms: number };
  const outs: Out[] = await page.evaluate(async ([fx, palette]: readonly [Record<string, unknown>, typeof PALETTE]) => {
    // served paths, typed as the sources they are built from
    const lib: string = '/lib/index.js', core: string = '/replay-core.js', fonts: string = '/lib/fonts/all.js';
    const m = await import(lib) as typeof import('../src/index.ts');
    m.registerFonts(...(await import(fonts) as typeof import('../src/fonts/all.ts')).allFonts);
    const r = await import(core) as typeof import('../tools/replay-core.ts');
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- this body runs in the page; it cannot see the outer scope
    const b64 = (u: Uint8Array): string => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
    const res: Out[] = [];
    for (const [name, spec] of Object.entries(fx)) {
      const t0 = performance.now();
      const fig = r.buildWith(spec, m.subplots);
      const svg = fig.toSVG(), png = fig.toPNGSync(), pal = fig.toPNGSync(palette);
      res.push({ name, svg, png64: b64(png), pal64: b64(pal), ms: performance.now() - t0 });
    }
    return res;
  }, [fixtures(), PALETTE] as const);
  if (errors.length > 0) { fails++; console.log(`FAIL page errors: ${errors.join('; ')}`); }
  console.log(`browser: ${browser.browserType().name()} ${browser.version()} (${ua.includes('Headless') ? 'headless' : 'headed'}, TZ Pacific/Kiritimati, locale de-DE)`);
  const got: RuntimeOutput[] = outs.map((o) => ({ name: o.name, svg: o.svg, png: Buffer.from(o.png64, 'base64'), palette: Buffer.from(o.pal64, 'base64'), ms: o.ms }));
  fails += check('chromium', got);
} finally {
  await browser.close();
  server.close();
}
console.log(fails === 0 ? 'browser: every case pixel-exact, output identical to Node' : `browser: ${fails} failure(s)`);
if (fails > 0) process.exitCode = 1;
