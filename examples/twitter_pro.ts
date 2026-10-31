// Twitter-ready (2400x1350) pro charts with explicit baseline.
// Baseline: vs mpljs BEFORE the performance rewrite, using bench/sweep.ts layout timings.
// Each variant writes PNG + SVG into examples/out/.
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

type Row = { name: string; before: number; after: number; x: number };
const rows: Row[] = [
  { name: 'plot · 1M points', before: 938, after: 65, x: 938 / 65 },
  { name: 'markers · 100k',   before: 60,  after: 5,  x: 60 / 5 },
  { name: 'bar · 100k bars',  before: 151, after: 41, x: 151 / 41 },
  { name: '256 lines + legend', before: 57, after: 18, x: 57 / 18 },
].toSorted((a, b) => b.x - a.x);

const ACCENT = '#1565c0', INK = '#1a1a1a', MUTED = '#6b7280';
const SOURCE = 'baseline: bench/sweep.ts (vs earlier mpljs) · github.com/ivarvong/mpl';
const fmtX = (x: number) => (x >= 10 ? x.toFixed(0) : x.toFixed(1)) + '×';

function frame(L: number, R: number, B: number, T: number) {
  const [fig, ax] = subplots({
    figsize: [16, 9], dpi: 150,
    rc: {
      'font.size': 24, 'figure.facecolor': 'white', 'axes.facecolor': 'white',
      'axes.spines.left': false, 'axes.spines.right': false, 'axes.spines.top': false, 'axes.spines.bottom': false,
      'axes.grid': false, 'xtick.bottom': false, 'xtick.labelbottom': false, 'ytick.left': false, 'ytick.labelleft': false,
      'figure.subplot.left': L, 'figure.subplot.right': R, 'figure.subplot.bottom': B, 'figure.subplot.top': T,
    },
  });
  // Convert figure coords -> axes coords for headline/footer placement.
  const fx = (x: number) => (x - L) / (R - L), fy = (y: number) => (y - B) / (T - B);
  const at = { transform: ax.transAxes };
  const head = (title: string, sub: string) => {
    ax.text(fx(0.045), fy(0.915), title, { ...at, fontsize: 38, fontweight: 'bold', color: INK, va: 'baseline' });
    ax.text(fx(0.045), fy(0.855), sub,   { ...at, fontsize: 24, color: MUTED, va: 'baseline' });
    ax.text(fx(0.045), fy(0.040), SOURCE,{ ...at, fontsize: 17, color: MUTED, va: 'baseline' });
  };
  return { fig, ax, fx, head, at };
}

// Variant A: horizontal speedup bars (higher is better)
{
  const { fig, ax, head } = frame(0.30, 0.86, 0.11, 0.75);
  const n = rows.length, ys = rows.map((_, i) => n - 1 - i);
  ax.barh(ys, rows.map((r) => r.x), { height: 0.62, color: rows.map((_, i) => (i === 0 ? ACCENT : '#90b4e0')) });
  ax.set_xlim(0, 16.5); ax.set_ylim(-0.6, n - 0.4);
  rows.forEach((r, i) => {
    const y = ys[i];
    ax.text(-0.35, y + 0.10, r.name, { ha: 'right', va: 'baseline', fontsize: 26, color: INK });
    ax.text(-0.35, y - 0.26, `${r.before} → ${r.after} ms`, { ha: 'right', va: 'baseline', fontsize: 20, color: MUTED });
    ax.text(r.x + 0.25, y, `${fmtX(r.x)} faster`, { va: 'center', fontsize: 26, fontweight: 'bold', color: i === 0 ? ACCENT : INK });
  });
  head('mpljs lays out 1M points 14× faster',
       'Layout-time speedup per figure vs earlier mpljs (perf rewrite). Higher is better.');
  save('twitter_speedup', fig);
}

// Variant B: dumbbell, linear milliseconds (lower is better)
{
  const { fig, ax, head } = frame(0.27, 0.72, 0.11, 0.70);
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
  // Ratio column on the right edge
  rows.forEach((r, i) => ax.text(1190, ys[i], `${fmtX(r.x)} faster`,
                                 { va: 'center', fontsize: 26, fontweight: 'bold', color: i === 0 ? ACCENT : INK }));
  head('mpljs lays out 1M points in 65 ms, not 938',
       'Layout time per figure (ms), vs earlier mpljs before the perf rewrite. Lower is better.');
  save('twitter_dumbbell', fig);
}

