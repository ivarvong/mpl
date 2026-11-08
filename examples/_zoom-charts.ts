// The charts of examples/zoom.ts, as builders: the server renders them once (the first paint), the page's lazily loaded
// chunk builds the same figures in the browser for mpl/zoom, and test/zoom.test.ts builds them in Node to check that
// every zoomed frame equals a Node render with the same limits. Deterministic data (a seeded generator), no Date.now().
import type { Figure } from '../src/index.ts';
import { AutoDateLocator, ConciseDateFormatter, registerSidecar, subplots } from '../src/index.ts';
import { sidecar } from '../src/annotate.ts';

registerSidecar(sidecar);   // toSVG({ interactive: true }) in this bundle too

// glyph outlines (svg.fonttype 'path'): the page shows the same text whatever fonts the viewer has
const rc = { 'svg.fonttype': 'path' } as const;

/** A small seeded generator (LCG), so the browser and Node build the same data. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Lines and a scatter with a legend (linear axes). */
export function lines(): Figure {
  const xs = Array.from({ length: 400 }, (_, i) => i / 20);
  const [fig, ax] = subplots({ figsize: [6.4, 3.2], rc });
  ax.plot(xs, xs.map((x) => Math.sin(x) * Math.exp(-x / 12)), { label: 'damped sin' });
  ax.plot(xs, xs.map((x) => Math.cos(x * 1.7) * 0.6), { label: 'cos', ls: '--' });
  ax.scatter([1, 4, 7, 10, 13, 16], [0.5, -0.4, 0.8, -0.6, 0.2, 0.1], { label: 'samples', color: 'C3', zorder: 3 });
  ax.set_title('Lines and points');
  ax.legend({ loc: 'upper right' });
  fig.tight_layout();
  return fig;
}

/** Latency percentiles on a log y axis. */
export function logy(): Figure {
  const r = rng(7), xs = Array.from({ length: 120 }, (_, i) => i);
  const p50 = xs.map((i) => 20 + 6 * Math.sin(i / 9) + 4 * r());
  const p99 = p50.map((v, i) => v * (4 + 3 * r()) + (i % 37 === 0 ? 900 : 0));
  const [fig, ax] = subplots({ figsize: [6.4, 3.2], rc });
  ax.plot(xs, p50, { label: 'p50' });
  ax.plot(xs, p99, { label: 'p99' });
  ax.set_yscale('log');
  ax.set_ylabel('ms (log)');
  ax.set_xlabel('minute');
  ax.set_title('Log axis: zoom works in log space');
  ax.legend({ loc: 'upper left' });
  fig.tight_layout();
  return fig;
}

/** A step series on a date axis. */
export function dates(): Figure {
  const day = 864e5, t0 = Date.UTC(2026, 6, 1);
  const ds = Array.from({ length: 120 }, (_, i) => new Date(t0 + i * day));
  const [fig, ax] = subplots({ figsize: [6.4, 3.2], rc });
  ax.step(ds, ds.map((_, i) => 20 + ((i * 7) % 11) + (i % 30 === 0 ? 9 : 0)), { where: 'post', label: 'deploys / day' });
  ax.xaxis.set_major_formatter(new ConciseDateFormatter(new AutoDateLocator()));
  ax.set_title('Date axis: ticks re-locate as you zoom');
  ax.legend({ loc: 'upper left' });
  fig.tight_layout();
  return fig;
}

/** Two rows sharing x, the top one with a twin y axis: all three move together in x. */
export function shared(): Figure {
  const xs = Array.from({ length: 200 }, (_, i) => i / 10);
  const [fig, [top, bottom]] = subplots(2, 1, { figsize: [6.4, 4.4], sharex: true, rc });
  top.plot(xs, xs.map((x) => Math.sin(x)), { label: 'sin' });
  top.set_ylabel('sin');
  const tw = top.twinx();
  tw.plot(xs, xs.map((x) => 100 + 40 * Math.cos(x / 2)), { color: 'C1', label: 'level' });
  tw.set_ylabel('level');
  bottom.bar(xs.filter((_, i) => i % 5 === 0), xs.filter((_, i) => i % 5 === 0).map((x) => 1 + Math.abs(Math.sin(x / 3)) * 4), { width: 0.4, color: 'C2', label: 'count' });
  bottom.set_ylabel('count');
  bottom.set_xlabel('t');
  top.set_title('sharex + twinx: one pan moves all three');
  fig.tight_layout();
  return fig;
}

/** A dense scatter with a colorbar: past the SVG threshold, gestures render to canvas. */
export function scatter(n = 2000): Figure {
  const r = rng(42), x: number[] = [], y: number[] = [], c: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * 2 * Math.PI, d = Math.sqrt(-2 * Math.log(r() || 1e-12));
    x.push(d * Math.cos(a)); y.push(d * Math.sin(a) * 0.6 + 0.3 * x[i]); c.push(Math.hypot(x[i], y[i]));
  }
  const [fig, ax] = subplots({ figsize: [6.4, 4], rc });
  const sc = ax.scatter(x, y, { c, cmap: 'viridis', s: 8, edgecolors: 'none' });
  fig.colorbar(sc, { ax, label: 'radius' });
  ax.set_title(`${n} points: canvas frames while zooming`);
  fig.tight_layout();
  return fig;
}

/** The demo's charts by id (the page's element ids and idPrefixes). */
export const CHARTS: Readonly<Record<string, () => Figure>> = { lines, logy, dates, shared, dense: () => scatter(2000) };

/** A chart by id; `scatter-N` is an N-point scatter (the bench's threshold sweep). */
export function build(id: string): Figure {
  const m = /^scatter-(\d+)$/.exec(id);
  if (m !== null) return scatter(Number(m[1]));
  if (!Object.hasOwn(CHARTS, id)) throw new Error(`no chart ${id}`);
  return CHARTS[id]();
}
