// Parametric sweeps: time layout and render vs N, report log-log slope (1.0 = linear).
import { subplots, tracer, type Figure } from '../src/index.ts';
import { toSVG } from '../src/render/svg.ts';
const REPS = Number(process.env['REPS'] || 5);
const timeIt = (fn: () => void): number => { let best = Infinity; for (let i = 0; i < REPS; i++) { const t = performance.now(); fn(); best = Math.min(best, performance.now() - t); } return best; };
const lin = (n: number, a: number, b: number): number[] => Array.from({ length: n }, (_, i) => a + (b - a) * i / Math.max(1, n - 1));
type Sweep = { Ns: number[]; build: (n: number) => Figure };
const SWEEPS: Record<string, Sweep> = {
  points:  { Ns: [1e3, 1e4, 1e5, 1e6], build: (n) => { const [fig, ax] = subplots(); const x = lin(n, 0, 10); ax.plot(x, x.map(Math.sin)); return fig; } },
  markers: { Ns: [1e3, 1e4, 1e5], build: (n) => { const [fig, ax] = subplots(); const x = lin(n, 0, 10); ax.plot(x, x.map(Math.sin), 'o'); return fig; } },
  lines_legend_best: { Ns: [4, 16, 64, 256], build: (n) => { const [fig, ax] = subplots(); const x = lin(200, 0, 10); for (let i = 0; i < n; i++) ax.plot(x, x.map(v => Math.sin(v + i / n) + i / n), { label: `s${i}` }); ax.legend(); return fig; } },
  lines_no_legend: { Ns: [4, 16, 64, 256], build: (n) => { const [fig, ax] = subplots(); const x = lin(200, 0, 10); for (let i = 0; i < n; i++) ax.plot(x, x.map(v => Math.sin(v + i / n) + i / n)); return fig; } },
  bars:    { Ns: [1e2, 1e3, 1e4, 1e5], build: (n) => { const [fig, ax] = subplots(); ax.bar(lin(n, 0, n), lin(n, 1, 5).map((v, i) => v * (1 + Math.sin(i)))); return fig; } },
  categories: { Ns: [1e2, 1e3, 1e4], build: (n) => { const [fig, ax] = subplots(); ax.bar(Array.from({ length: n }, (_, i) => `c${i}`), lin(n, 1, 5)); return fig; } },
  ticks_fixed: { Ns: [1e2, 1e3, 1e4], build: (n) => { const [fig, ax] = subplots(); ax.plot([0, 1], [0, 1]); ax.set_xticks(lin(n, 0, 1)); return fig; } },
};
const only = process.argv[2];
for (const [name, sw] of Object.entries(SWEEPS)) {
  if (only && name !== only) continue;
  const rows: { n: number; tBuild: number; tLayout: number; tRender: number; bytes: number }[] = [];
  for (const n of sw.Ns) {
    let fig = sw.build(n); const tBuild = timeIt(() => { fig = sw.build(n); });
    let scene = fig.toScene(); const tLayout = timeIt(() => { scene = fig.toScene(); });
    let svg = toSVG(scene, tracer); const tRender = timeIt(() => { svg = toSVG(scene, tracer); });
    rows.push({ n, tBuild, tLayout, tRender, bytes: svg.length });
  }
  const slope = (k: 'tBuild' | 'tLayout' | 'tRender'): number => { const a = rows[0] as (typeof rows)[number], b = rows[rows.length - 1] as (typeof rows)[number]; return Math.log(b[k] / a[k]) / Math.log(b.n / a.n); };
  console.log(`\n${name}  (slopes: build ${slope('tBuild').toFixed(2)}  layout ${slope('tLayout').toFixed(2)}  render ${slope('tRender').toFixed(2)})`);
  console.log('N'.padStart(9) + 'build ms'.padStart(11) + 'layout ms'.padStart(11) + 'render ms'.padStart(11) + 'KiB'.padStart(9));
  for (const r of rows) console.log(String(r.n).padStart(9) + r.tBuild.toFixed(2).padStart(11) + r.tLayout.toFixed(2).padStart(11) + r.tRender.toFixed(2).padStart(11) + (r.bytes / 1024).toFixed(0).padStart(9));
}
