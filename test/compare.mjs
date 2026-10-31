// Compare mpljs output against matplotlib fixtures.
//  1. exact: xlim/ylim, tick locations, tick label strings, offset text, legend box
//  2. pixels: our own Agg/FreeType rasterization vs matplotlib's Agg PNG, byte for byte.
//     Allowed residual: max |Δ| ≤ 2 (libm ulp differences in log10 under log scales).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { subplots } from '../src/index.ts';
import { renderRGBA } from '../src/render/agg.ts';
import { checkBlocks } from '../src/render/agg/canvas.ts';
import { encodePNGSync } from '../src/render/png.ts';
import { Tracer } from '../src/trace.ts';
import { compare, readPNG } from './png-oracle.mjs';

const REF = new URL('../fixtures/ref/', import.meta.url).pathname;
const OUT = new URL('../fixtures/out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const names = JSON.parse(readFileSync(REF + '_index.json', 'utf8'));
const only = process.argv[2];
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
const arrEq = (a, b, f = close) => a.length === b.length && a.every((v, i) => f(v, b[i]));

// Replay the fixture's spec: [method, args, kwargs] -> ax[method](...args, kwargs)
const decode = (a) => (a && typeof a === 'object' && !Array.isArray(a) && '$dates' in a ? a.$dates.map((s) => new Date(s + 'Z')) : a);
function render(fx) {
  const [fig, first] = subplots({ style: fx.style, rc: fx.rc || {} });
  const axes = [first];
  let ax = first;
  for (const [fn, args0, kwargs] of fx.spec) {
    const args = args0.map(decode);
    if (fn === 'twinx') { ax = ax.twinx(); axes.push(ax); continue; }
    if (fn === 'sca') { ax = axes[args[0]]; continue; }
    if (typeof ax[fn] !== 'function') throw new Error(`no Axes.${fn}`);
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : v]));
    ax[fn](...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  const scene = fig.toScene();
  const svg = fig.toSVG();
  const all = fig.meta;
  const m = fig.meta[0];
  const meta = { xlim: m.x.lim, ylim: m.y.lim, xticks: m.x.ticks, yticks: m.y.ticks, xticklabels: m.x.labels, yticklabels: m.y.labels,
                 xoffset: m.x.offset, yoffset: m.y.offset, legend: m.legend.kind === 'some' ? m.legend.value : null };   // fixture JSON encodes absence as null
  return { meta: { ...meta, axes: all }, svg, scene };
}

let pass = 0, fail = 0; const rows = [];
for (const name of names) {
  if (only && name !== only) continue;
  const fx = JSON.parse(readFileSync(REF + name + '.json', 'utf8'));
  let got, svg, scene;
  try { ({ meta: got, svg, scene } = render(fx)); } catch (e) { console.log(`FAIL ${name.padEnd(20)} threw: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); fail++; continue; }
  writeFileSync(OUT + name + '.svg', svg);
  const problems = [];
  if ((fx.legend === null) !== (got.legend === null)) problems.push(`legend presence: got ${JSON.stringify(got.legend)} want ${JSON.stringify(fx.legend)}`);
  else if (fx.legend) {
    if (got.legend.loc !== fx.legend.loc) problems.push(`legend loc: got ${got.legend.loc} want ${fx.legend.loc}`);
    for (const k of ['x0', 'x1', 'top', 'bottom']) if (Math.abs(got.legend[k] - fx.legend[k]) > 0.05) problems.push(`legend ${k}: got ${got.legend[k].toFixed(3)} want ${fx.legend[k].toFixed(3)}`);
  }
  for (const k of ['xlim', 'ylim', 'xticks', 'yticks']) if (!arrEq(got[k], fx[k])) problems.push(`${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(fx[k])}`);
  for (const k of ['xticklabels', 'yticklabels']) if (!arrEq(got[k], fx[k], (a, b) => a === b)) problems.push(`${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(fx[k])}`);
  for (const k of ['xoffset', 'yoffset']) if (got[k] !== fx[k]) problems.push(`${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(fx[k])}`);
  // every axes (twins too), including minor ticks and labels
  (fx.axes || []).forEach((want, i) => {
    const g = got.axes[i];
    if (!g) { problems.push(`axes[${i}] missing`); return; }
    for (const a of ['x', 'y']) {
      const W = want[a], G = g[a];
      if (!arrEq(G.lim, W.lim)) problems.push(`axes[${i}].${a}.lim: got ${JSON.stringify(G.lim)} want ${JSON.stringify(W.lim)}`);
      if (!arrEq(G.ticks, W.ticks)) problems.push(`axes[${i}].${a}.ticks: got ${JSON.stringify(G.ticks)} want ${JSON.stringify(W.ticks)}`);
      if (!arrEq(G.labels, W.labels, (p, q) => p === q)) problems.push(`axes[${i}].${a}.labels: got ${JSON.stringify(G.labels)} want ${JSON.stringify(W.labels)}`);
      if (!arrEq(G.minor, W.minor)) problems.push(`axes[${i}].${a}.minor: got ${JSON.stringify(G.minor)} want ${JSON.stringify(W.minor)}`);
      if (!arrEq(G.minorLabels, W.minorlabels, (p, q) => p === q)) problems.push(`axes[${i}].${a}.minorlabels: got ${JSON.stringify(G.minorLabels)} want ${JSON.stringify(W.minorlabels)}`);
      if (G.offset !== W.offset) problems.push(`axes[${i}].${a}.offset: got ${JSON.stringify(G.offset)} want ${JSON.stringify(W.offset)}`);
    }
  });

  const ref = readPNG(readFileSync(REF + name + '.png'));
  const ours = renderRGBA(scene, new Tracer());
  const px = compare(ref, ours);
  // the canvas' uniform-block claims must match its pixels (the PNG encoder trusts them)
  const badBlock = checkBlocks(ours);
  if (badBlock >= 0) problems.push(`block state: block ${badBlock} claims uniform but is not`);
  const png = encodePNGSync(ours), back = readPNG(Buffer.from(png));
  if (back.px.some((v, i) => v !== ours.px[i])) problems.push('encodePNGSync does not round-trip');
  writeFileSync(OUT + name + '.png', png);
  if (px.maxd > 2) problems.push(`pixels: max |Δ| ${px.maxd}, ${px.diff} px differ, rms ${px.rms.toFixed(4)}`);
  const ok = problems.length === 0;
  if (ok) pass++; else fail++;
  rows.push({ name, ok, rms: px.rms, exact: px.diff === 0, diff: px.diff });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(36)} ${px.diff === 0 ? 'pixel-exact' : `${px.diff} px within ±${px.maxd}`}`);
  for (const p of problems) console.log('     ' + p);
}
console.log(`\n${pass} pass, ${fail} fail; ${rows.filter((r) => r.exact).length}/${rows.length} pixel-exact vs Agg; mean rms ${(rows.reduce((s, r) => s + r.rms, 0) / rows.length).toFixed(4)}`);
if (fail > 0) process.exitCode = 1;
writeFileSync(OUT + '_results.json', JSON.stringify(rows, null, 1));
