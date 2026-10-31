// End-to-end benchmark of the live page in headless Chromium, read from its own traces.
//   node scripts/build_browser.ts tools/live/lib && node bench/bench_live.ts [--runs 15] [--out file.json]
// 1. Cold start: N fresh browser contexts (empty cache); the page's startup trace per load.
// 2. Input → rendered: real wheel input (CDP-dispatched, so event.timeStamp is the browser's), in
//    three configurations; every frame's trace from the input event to the end of browser.render.
// 3. Validation: browser.render against Chromium's own timeline (devtools.timeline) for the same
//    frames: how much of the renderer main thread's rendering work falls inside our span.
// Serves tools/live itself (node:http), so it needs nothing running.
// oxlint-disable no-await-in-loop -- a benchmark drives the browser one step at a time on purpose
import { createServer } from 'node:http';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
// --flags: extra Chromium flags. Default --disable-gpu: this container has no GPU, and GPU raster on
// SwiftShader saturates the GPU process (97 % busy) and queues input for ~1.3 s; that measures the
// emulator, not the page. Pass --flags '' to see it.
const FLAGS = arg('--flags', '--disable-gpu').split(' ').filter(Boolean);
const RTT = Number(arg('--rtt', '0'));             // emulated round-trip latency per request (CDP), ms
const RUNS = Number(arg('--runs', '15')), OUT = arg('--out', ''), PHASE = arg('--phase', 'all'), STEPS = Number(arg('--steps', '40'));
const ROOT = new URL('../tools/live/', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  try { const f = statSync(p).isDirectory() ? join(p, 'index.html') : p; res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(readFileSync(f)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const URL_ = `http://localhost:${server.address().port}/${arg('--page', 'index.html')}`;
const exe = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const browser = await chromium.launch({ executablePath: exe, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', ...FLAGS] });

const q = (a, p) => { const s = a.toSorted((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '–');
const table = (rows) => { const w = rows[0].map((_, i) => Math.max(...rows.map((r) => String(r[i]).length))); return rows.map((r) => r.map((c, i) => (i ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  ')).join('\n'); };
const result = { env: { chromium: browser.version(), flags: FLAGS, rtt: RTT, webgl: 'SwiftShader (software)', runs: RUNS, host: 'localhost' } };

// ---- 1. cold start
const TOP = ['document.fetch', 'document.parse', 'modules.fetch', 'modules.compile+evaluate', 'font.build', 'script.init', 'gl.init', 'dom.first-layout', 'data.generate', 'frame', 'figure.layout', 'render.svg', 'dom.commit', 'browser.render', 'startup'];
const cold = Object.fromEntries(TOP.map((k) => [k, []]));
for (let r = 0; r < (PHASE === 'latency' ? 0 : RUNS); r++) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const p = await ctx.newPage();
  if (RTT > 0) await (await ctx.newCDPSession(p)).send('Network.emulateNetworkConditions', { offline: false, latency: RTT, downloadThroughput: -1, uploadThroughput: -1 });
  await p.goto(URL_);
  await p.waitForFunction(() => window.__live && window.__live.startup && window.__live.startup.length > 0, null, { timeout: 30000 });
  const spans = await p.evaluate(() => window.__live.startup.map((s) => ({ name: s.name, d: s.durationMs })));
  for (const k of TOP) cold[k].push(spans.filter((s) => s.name === k).reduce((a, s) => a + s.d, 0));
  await ctx.close();
}
result.cold = Object.fromEntries(TOP.map((k) => [k, { p50: q(cold[k], 0.5), p90: q(cold[k], 0.9) }]));
if (PHASE !== 'latency') console.log(`\n1. Cold start, ${RUNS} fresh contexts (ms; localhost, empty cache)\n`);
if (PHASE !== 'latency') console.log(table([['span', 'p50', 'p90'], ...TOP.map((k) => [k, f1(result.cold[k].p50), f1(result.cold[k].p90)])]));

// ---- 2 + 3. input → rendered, with Chromium's timeline for validation
if (PHASE === 'cold') { if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2)); await browser.close(); server.close(); process.exit(0); }
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
await page.goto(URL_);
await page.waitForFunction(() => window.__live && window.__live.view.home);
const box = await page.evaluate(() => { const r = document.getElementById('chart').getBoundingClientRect(); return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.5 }; });
const row = (f) => ({ wait: f.wait, js: f.workEnd - f.workStart, browser: f.browser, total: f.end - f.start });
async function drive(label, setup) {
  await setup();
  await page.focus('#chart'); await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, i % 2 ? 60 : -60); await page.waitForTimeout(30); }   // warm-up
  await page.evaluate(() => { window.__frames.length = 0; performance.mark('bench-start'); });
  for (let i = 0; i < STEPS; i++) { await page.mouse.wheel(0, i % 20 < 10 ? -60 : 60); await page.waitForTimeout(45); }
  await page.waitForTimeout(800);
  const fr = await page.evaluate(() => window.__frames.slice());
  const inp = fr.filter((f) => f.input);
  const rs = inp.map(row), all = fr.map(row);
  const s = (k, a = rs) => ({ p50: q(a.map((x) => x[k]), 0.5), p95: q(a.map((x) => x[k]), 0.95) });
  return { label, frames: fr.length, inputFrames: inp.length, wait: s('wait'), js: s('js'), browser: s('browser'), total: s('total'), jsAll: s('js', all), raw: fr };
}
await browser.startTracing(page, { categories: ['devtools.timeline', 'blink.user_timing'] });
const daily = await drive('daily · SVG · 3,285 pts', async () => {});
const traceBuf = await browser.stopTracing();
const hourlySvg = await drive('hourly · SVG · 78,840 pts', async () => { await page.check('#dense'); await page.waitForFunction(() => window.__stats.mode === 'gl'); await page.click('[name=marks][value=svg]'); await page.waitForTimeout(300); });
const hourlyGl = await drive('hourly · WebGL · 78,840 pts', async () => { await page.click('[name=marks][value=gl]'); await page.waitForTimeout(300); });
result.latency = [daily, hourlySvg, hourlyGl].map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'raw')));
console.log(`\nChromium ${browser.version()} · flags: ${FLAGS.join(' ') || '(none)'} · WebGL on SwiftShader`);
console.log('\n2. Input → rendered, per wheel-driven frame (ms; p50 / p95)\n');
console.log(table([['config', 'frames', 'input.wait', 'JS work', 'browser.render', 'input → rendered'],
  ...result.latency.map((l) => [l.label, l.inputFrames, `${f1(l.wait.p50)} / ${f1(l.wait.p95)}`, `${f1(l.js.p50)} / ${f1(l.js.p95)}`, `${f1(l.browser.p50)} / ${f1(l.browser.p95)}`, `${f1(l.total.p50)} / ${f1(l.total.p95)}`])]));

// ---- 3. validation: align Chromium's clock to performance.now() with the 'bench-start' mark
const ev = JSON.parse(traceBuf.toString()).traceEvents;
const mark = ev.find((e) => e.name === 'bench-start' && e.cat.includes('blink.user_timing'));
const main = ev.find((e) => e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain' && ev.some((x) => x.pid === e.pid && x.name === 'bench-start'));
const RENDER = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'UpdateLayer', 'PaintImage', 'RasterTask', 'CompositeLayers', 'UpdateLayerTree']);
let validation = { note: 'no bench-start mark in the trace' };
// Chromium trace ts (µs) of the mark ↔ the mark's performance.now() startTime, read back from the page.
const markStart = await page.evaluate(() => { const m = performance.getEntriesByName('bench-start'); return m.length ? m[0].startTime : NaN; });
if (mark && main && Number.isFinite(markStart)) {
  const off = mark.ts / 1000 - markStart;                                  // trace ms − performance ms
  const evs = ev.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && RENDER.has(e.name));
  let inside = 0, ours = 0, total = 0;
  const per = [];
  for (const f of daily.raw) {
    const a = f.workEnd + off, b = f.end + off;                            // our browser.render window, trace ms
    const s = evs.filter((e) => e.ts / 1000 >= a - 0.05 && (e.ts + e.dur) / 1000 <= b + 0.05);
    const top = s.filter((e) => !s.some((o) => o !== e && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur));   // drop nested
    const sum = top.reduce((x, e) => x + e.dur / 1000, 0);
    per.push({ ours: f.browser, chromium: sum });
    inside += sum; ours += f.browser;
  }
  const lo = Math.min(...daily.raw.map((f) => f.start)) + off, hi = Math.max(...daily.raw.map((f) => f.end)) + off;
  const inWin = evs.filter((e) => e.ts / 1000 >= lo && e.ts / 1000 <= hi);
  const topAll = inWin.filter((e) => !inWin.some((o) => o !== e && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur));
  total = topAll.reduce((x, e) => x + e.dur / 1000, 0);
  const byName = {};
  for (const f of daily.raw) {
    const a = f.workEnd + off, b = f.end + off;
    for (const e of evs) if (e.ts / 1000 >= a - 0.05 && (e.ts + e.dur) / 1000 <= b + 0.05) byName[e.name] = (byName[e.name] || 0) + e.dur / 1000;
  }
  validation = {
    frames: daily.raw.length,
    covered: inside / total,                    // share of Chromium's rendering work that lands inside our browser.render spans
    explained: inside / ours,                   // share of our browser.render time that Chromium attributes to rendering
    p50: { ours: q(per.map((x) => x.ours), 0.5), chromium: q(per.map((x) => x.chromium), 0.5) },
    byName: Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, v / daily.raw.length]).toSorted((a, b) => b[1] - a[1])),
  };
  console.log(`\n3. browser.render vs Chromium's timeline (daily · SVG, ${daily.raw.length} frames)\n`);
  console.log(`   Chromium rendering work (main thread) inside our browser.render spans: ${(validation.covered * 100).toFixed(1)} %`);
  console.log(`   our browser.render time that Chromium attributes to rendering work:    ${(validation.explained * 100).toFixed(1)} %`);
  console.log(`   per frame p50: ours ${f1(validation.p50.ours)} ms, Chromium ${f1(validation.p50.chromium)} ms`);
  console.log(`   per frame mean by phase: ${Object.entries(validation.byName).slice(0, 6).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}`);
}
result.validation = validation;
if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 2));
await browser.close(); server.close();
