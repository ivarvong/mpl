// Warm benchmark: N iterations of a representative chart, p50/p95 per span name.
import { subplots, tracer } from '../src/index.ts';
const N = Number(process.env['N'] || 30);
const x = Array.from({ length: 200 }, (_, i) => i / 20);
function build() {
  const [fig, ax] = subplots({ style: 'seaborn-v0_8-darkgrid' });
  for (let i = 0; i < 6; i++) ax.plot(x, x.map(v => Math.sin(v + i / 2) + i * 0.4), i % 2 ? 'o-' : '--', { label: `series ${i}` });
  ax.bar([0, 2, 4, 6, 8], [1, 2, 1.5, 2.5, 1], { label: 'bars' });
  ax.legend(); ax.set_title('traced render'); ax.set_xlabel('x'); ax.set_ylabel('y');
  return fig;
}
for (let i = 0; i < 5; i++) build().toSVG();           // warm up
tracer.enable();
let bytes = 0;
for (let i = 0; i < N; i++) bytes = build().toSVG().length;
const by = new Map<string, number[]>();
for (const s of tracer.spans()) { const d = s.durationMs; const a = by.get(s.name) ?? []; a.push(d); by.set(s.name, a); }
const q = (a: number[], p: number): number => a.toSorted((u, v) => u - v)[Math.min(a.length - 1, Math.floor(p * a.length))] as number;
console.log(`${N} warm runs, svg ${(bytes / 1024).toFixed(1)} KiB, ${tracer.spans().length / N} spans/run`);
console.log('span'.padEnd(22) + 'count'.padStart(6) + 'p50 ms'.padStart(10) + 'p95 ms'.padStart(10));
for (const [name, ds] of [...by].toSorted((a, b) => q(b[1], 0.5) * b[1].length - q(a[1], 0.5) * a[1].length)) console.log(name.padEnd(22) + String(ds.length / N).padStart(6) + q(ds, 0.5).toFixed(3).padStart(10) + q(ds, 0.95).toFixed(3).padStart(10));
