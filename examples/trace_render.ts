// Trace a render of the Twitter chart and draw a span waterfall.
// Produces: examples/out/twitter_trace.png and examples/out/twitter_trace.spans.jsonl
import { mkdirSync, writeFileSync } from 'node:fs';
import { subplots, tracer, renderTree } from '../src/index.ts';
import type { FinishedSpan, Option } from '../src/index.ts';

// The same grouped speedup-dumbbell figure as twitter_pro.ts Variant B, without saving.
function buildTwitterFigure() {
  const rows = [
    { name: 'plot · 1M points', before: 938, after: 65, x: 938 / 65 },
    { name: 'markers · 100k',   before: 60,  after: 5,  x: 60 / 5 },
    { name: 'bar · 100k bars',  before: 151, after: 41, x: 151 / 41 },
    { name: '256 lines + legend', before: 57, after: 18, x: 57 / 18 },
  ].toSorted((a, b) => b.x - a.x);

  const ACCENT = '#1565c0', INK = '#1a1a1a', MUTED = '#6b7280';
  const [fig, ax] = subplots({
    figsize: [16, 9], dpi: 150,
    rc: {
      'font.size': 24, 'figure.facecolor': 'white', 'axes.facecolor': 'white',
      'axes.spines.left': false, 'axes.spines.right': false, 'axes.spines.top': false, 'axes.spines.bottom': false,
      'axes.grid': false, 'xtick.bottom': false, 'xtick.labelbottom': false, 'ytick.left': false, 'ytick.labelleft': false,
      'figure.subplot.left': 0.27, 'figure.subplot.right': 0.72, 'figure.subplot.bottom': 0.11, 'figure.subplot.top': 0.70,
    },
  });
  const n = rows.length, ys = rows.map((_, i) => n - 1 - i);
  ax.set_xlim(-30, 1000); ax.set_ylim(-0.6, n - 0.2);
  rows.forEach((r, i) => {
    const y = ys[i];
    ax.plot([r.after, r.before], [y, y], { color: '#d5d9df', linewidth: 6 });
    ax.plot([r.before], [y], 'o', { color: '#c4c9d0', markersize: 20, markeredgewidth: 0 });
    ax.plot([r.after], [y], 'o', { color: ACCENT, markersize: 20, markeredgewidth: 0 });
    ax.text(r.before + 26, y, `${r.before} ms`, { va: 'center', fontsize: 22, color: MUTED });
    ax.text(r.after, y + 0.27, (i === 0 ? 'after ' : '') + `${r.after} ms`,
            { ha: 'center', va: 'bottom', fontsize: 22, fontweight: 'bold', color: ACCENT });
    if (i === 0) ax.text(r.before, y + 0.27, 'before',
            { ha: 'center', va: 'bottom', fontsize: 22, fontweight: 'bold', color: MUTED });
    ax.text(-70, y, r.name, { ha: 'right', va: 'center', fontsize: 26, color: INK });
  });
  return fig;
}

function parentId(opt: Option<string>): string | undefined {
  return (opt as { kind: 'some'; value: string } | { kind: 'none' }).kind === 'some'
    ? (opt as { kind: 'some'; value: string }).value
    : undefined;
}
const pid = (s: FinishedSpan): string | undefined => parentId(s.parent);

function renderBoth() {
  const f = buildTwitterFigure();
  // Produce both formats; each recomputes layout by design.
  f.toSVG();
  f.toPNGSync();
}

// Warm up
for (let i = 0; i < 6; i++) renderBoth();

// Warm stats across 40 traced runs
const per = new Map<string, number[]>();
tracer.enable();
for (let i = 0; i < 40; i++) {
  tracer.clear();
  renderBoth();
  const byName = new Map<string, number>();
  for (const s of tracer.spans()) byName.set(s.name, (byName.get(s.name) ?? 0) + s.durationMs);
  for (const [k, v] of byName) {
    const arr = per.get(k) ?? (per.set(k, []).get(k) as number[] | undefined);
    if (arr) arr.push(v);
  }
}
const q = (a: number[], p: number) => {
  const b = [...a].toSorted((x, y) => x - y);
  return b[Math.min(b.length - 1, Math.floor(p * b.length))];
};
console.log('== warm per-render totals by span name (40 iters, ms) ==');
[...per].toSorted((a, b) => q(b[1], 0.5) - q(a[1], 0.5)).forEach(([k, v]) =>
  console.log(`${k.padEnd(28)} p50 ${q(v, 0.5).toFixed(2).padStart(8)}  p95 ${q(v, 0.95).toFixed(2).padStart(8)}`));

// Final single traced render, dump spans and draw a waterfall
tracer.clear();
renderBoth();
const spans = tracer.spans();
console.log(`\n== span tree (${spans.length} spans) ==`);
console.log(renderTree(spans, 150));

const OUT = new URL('./out/', import.meta.url);
mkdirSync(OUT, { recursive: true });
// Export OTLP spans as JSON lines
await tracer.flush(new URL('twitter_trace.spans.jsonl', OUT).pathname);
tracer.disable();

// Waterfall for top-level and first-level spans
const byId = new Map(spans.map((s) => [s.spanId, s] as const));
const depth = (s: FinishedSpan): number => {
  let d = 0;
  let p = pid(s);
  while (p && byId.has(p)) {
    d++;
    const v = byId.get(p);
    if (!v) break;
    p = pid(v);
  }
  return d;
};
const t0 = Math.min(...spans.map((s) => s.startMs));
type Row = { name: string; start: number; end: number; dur: number; n: number; d: number };
const rows: Row[] = [];
for (const top of spans.filter((s) => depth(s) === 0).toSorted((x, y) => x.startMs - y.startMs)) {
  rows.push({ name: top.name, start: top.startMs - t0, end: top.endMs - t0, dur: top.durationMs, n: 1, d: 0 });
  const g = new Map<string, Row>();
  for (const c of spans.filter((s) => pid(s) === top.spanId).toSorted((x, y) => x.startMs - y.startMs)) {
    const r = g.get(c.name);
    if (r) { r.end = Math.max(r.end, c.endMs - t0); r.dur += c.durationMs; r.n++; }
    else g.set(c.name, { name: c.name, start: c.startMs - t0, end: c.endMs - t0, dur: c.durationMs, n: 1, d: 1 });
  }
  rows.push(...g.values());
}
const labels = rows.map((r) => (r.d ? '· ' + r.name.replace(/^(render|raster)\\./, '') : r.name) + (r.n > 1 ? ` ×${r.n}` : ''));
const [fig, ax] = subplots({
  style: 'seaborn-v0_8-whitegrid', figsize: [16, 9], dpi: 150,
  rc: { 'font.size': 20, 'axes.titlesize': 28, 'axes.labelsize': 22, 'xtick.labelsize': 19, 'ytick.labelsize': 19 },
});
const ys = rows.map((_, i) => rows.length - 1 - i);
ax.barh(ys, rows.map((r) => Math.max(r.end - r.start, 0.04)), {
  left: rows.map((r) => r.start), height: 0.7,
  color: rows.map((r) => (r.d ? '#5dade2' : '#1f3a5f')),
});
const end = Math.max(...rows.map((r) => r.end));
rows.forEach((r, i) => ax.text(r.end + end * 0.008, ys[i], `${r.dur.toFixed(2)} ms`, {
  va: 'center', fontsize: 17, fontweight: r.d ? 'normal' : 'bold',
}));
ax.set_yticks(ys); ax.set_yticklabels(labels);
ax.set_xlim(0, end * 1.12);
ax.set_xlabel('time since first span (ms)');
ax.set_title('mpljs trace: Twitter chart render (warm, SVG + PNG)', { fontweight: 'bold' });
writeFileSync(new URL('twitter_trace.png', OUT), fig.toPNGSync());
console.log('wrote examples/out/twitter_trace.png and twitter_trace.spans.jsonl');

