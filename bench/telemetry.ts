// Telemetry for the new features: (1) a warm trace of the showcase render as a Honeycomb-style
// waterfall + tree; (2) warm p50 layout+render time per fixture family, charted by mpljs itself.
import { writeFileSync } from 'node:fs';
import { renderTree, subplots, tracer, type Scene } from '../src/index.ts';
import { build, fixtureNames, loadFixture } from '../tools/replay.ts';
import { traceScene } from './trace_png.ts';
import { toPNGSync } from '../src/render/agg.ts';
import { Tracer } from '../src/trace.ts';

const png = (scene: Scene, path: string): void => writeFileSync(path, toPNGSync(scene, new Tracer()));
const OUT = process.argv[2] || '/tmp';

// (1) showcase trace
const fx = loadFixture('showcase');
for (let i = 0; i < 20; i++) build(fx).toSVG();
tracer.enable(); build(fx).toSVG(); const spans = tracer.spans(); tracer.disable(); tracer.clear();
writeFileSync(`${OUT}/showcase-trace.txt`, renderTree(spans, 170));
png(traceScene(spans, 'showcase render: dates × twin log axis × bars × 2 legends (warm)'), `${OUT}/showcase-trace.png`);
console.log(`showcase: ${spans.length} spans, ${spans.find((s) => s.name === 'figure.layout')?.durationMs.toFixed(2)} ms layout`);

// (2) per-family warm timings, PNG path split into stages: layout | raster | encode
import { renderRGBA } from '../src/render/agg.ts';
import { encodePNGSync } from '../src/render/png.ts';
const family = (n: string): string => (n.startsWith('style_') ? 'themes' : n.startsWith('log') ? 'log scale' : n.startsWith('dates') ? 'dates' : n.startsWith('twinx') ? 'twinx'
  : n.startsWith('legend') ? 'legend' : n.startsWith('bar') ? 'bars' : n === 'showcase' ? 'showcase' : 'lines');
const p50 = (v: number[]): number => v.toSorted((a, b) => a - b)[Math.floor(v.length / 2)] as number;
const fams = new Map<string, number[][]>();
const quiet = new Tracer();
for (const name of fixtureNames()) {
  const f = loadFixture(name);
  const run = () => {
    const t0 = performance.now(); const scene = build(f).toScene();
    const t1 = performance.now(); const c = renderRGBA(scene, quiet);
    const t2 = performance.now(); const bytes = encodePNGSync(c);
    const t3 = performance.now();
    return [t1 - t0, t2 - t1, t3 - t2, bytes.length] as number[];
  };
  for (let i = 0; i < 5; i++) run();
  const runs = Array.from({ length: 21 }, run);
  const stage = [0, 1, 2, 3].map((k) => p50(runs.map((r) => r[k] as number)));
  const fam = family(name);
  fams.set(fam, [...(fams.get(fam) || []), stage]);
}
const rows = [...fams].map(([fam, v]) => ({ fam, n: v.length, s: [0, 1, 2, 3].map((k) => p50(v.map((x: number[]) => x[k] as number))) }))
  .toSorted((a, b) => (a.s[0] + a.s[1] + a.s[2]) - (b.s[0] + b.s[1] + b.s[2]));
const [fig, ax] = subplots({ style: 'ggplot', figsize: [8, 4.8], rc: { 'figure.subplot.left': 0.2 } });
const names = rows.map((r) => `${r.fam} (${r.n})`);
const L = rows.map((r) => r.s[0]), R = rows.map((r) => r.s[1]), E = rows.map((r) => r.s[2]);
ax.barh(names, L, { color: 'C0', label: 'layout' });
ax.barh(names, R, { left: L, color: 'C1', label: 'rasterize (Agg port)' });
ax.barh(names, E, { left: L.map((v, i) => v + R[i]), color: 'C2', label: 'PNG encode (sync deflate)' });
ax.set_xlabel('median of per-fixture p50, ms');
ax.set_title(`mpljs → PNG, warm, by fixture family (${fixtureNames().length} fixtures)`);
ax.legend({ loc: 'lower right' });
png(fig.toScene(), `${OUT}/timings.png`);
for (const r of rows) console.log(`${r.fam.padEnd(10)} ${String(r.n).padStart(3)} fixtures  layout ${r.s[0].toFixed(2)}  raster ${r.s[1].toFixed(2)}  encode ${r.s[2].toFixed(2)} ms  png ${(r.s[3] / 1024).toFixed(1)} KiB`);
