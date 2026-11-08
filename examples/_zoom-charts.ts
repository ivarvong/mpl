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

const spike = (i: number): number => (i >= 88 && i <= 95 ? 1 : 0);
/** An incident dashboard: four panels over the same day on date axes (not sharex; one with a twin y axis), a histogram
 *  of milliseconds and horizontal bars by endpoint. The first group zooms and hovers together; the last two stay out. */
export function dashboard(): Figure {
  const r = rng(11), t0 = Date.UTC(2026, 10, 5), ts = Array.from({ length: 144 }, (_, i) => new Date(t0 + i * 6e5));
  const [fig, axs] = subplots(3, 2, { figsize: [9.6, 7.2], rc, squeeze: false });
  const [[lat, budget], [tput, hist], [cpu, ends]] = axs;
  const p50 = ts.map((_, i) => 40 + 6 * r() + 30 * spike(i));
  lat.plot(ts, p50, { label: 'p50' });
  lat.plot(ts, p50.map((v, i) => v * 2.4 + 8 * r() + 200 * spike(i)), { label: 'p95' });
  lat.plot(ts, p50.map((v, i) => v * 4.6 + 14 * r() + 500 * spike(i)), { label: 'p99' });
  lat.set_yscale('log'); lat.set_ylabel('ms'); lat.set_title('API latency'); lat.legend({ loc: 'upper left' });
  budget.plot(ts, ts.map((_, i) => 62 - 0.03 * i - (i > 88 ? 6 : 0)));
  budget.set_ylabel('% left'); budget.set_title('Error budget remaining');
  tput.plot(ts, ts.map((_, i) => 1900 + 700 * Math.sin(i / 23) + 60 * r()), { label: 'requests' });
  tput.set_ylabel('requests / s'); tput.set_title('Throughput and 5xx');
  const tw = tput.twinx();
  tw.step(ts, ts.map((_, i) => 0.1 + 0.1 * r() + 2.8 * spike(i)), { color: 'C3', label: '5xx' });
  tw.set_ylabel('5xx (%)');
  hist.hist(Array.from({ length: 2000 }, () => 40 + 260 * r() * r()), { bins: 40, histtype: 'stepfilled', label: 'baseline' });
  hist.set_xlabel('ms'); hist.set_title('Latency distribution');
  cpu.plot(ts, ts.map((_, i) => 44 + 12 * Math.sin(i / 19) + 4 * r() + 34 * spike(i)), { label: 'median' });
  cpu.set_ylabel('%'); cpu.set_title('CPU'); cpu.set_ylim(0, 105);
  ends.barh(['/healthz', '/catalog', '/auth', '/cart', '/checkout', '/search'], [4, 88, 96, 252, 388, 413], { color: 'C0' });
  ends.set_title('p99 by endpoint (ms)');
  for (const a of [lat, budget, tput, cpu]) a.xaxis.set_major_formatter(new ConciseDateFormatter(new AutoDateLocator()));
  fig.tight_layout();
  return fig;
}

/** The demo's charts by id (the page's element ids and idPrefixes). */
export const CHARTS: Readonly<Record<string, () => Figure>> = { lines, logy, dates, shared, dense: () => scatter(2000), dashboard };

/** A chart by id; `scatter-N` is an N-point scatter (the bench's threshold sweep). */
export function build(id: string): Figure {
  const m = /^scatter-(\d+)$/.exec(id);
  if (m !== null) return scatter(Number(m[1]));
  if (id === 'dashboard2') return dashboard();   // a second copy, for sync across figures
  if (!Object.hasOwn(CHARTS, id)) throw new Error(`no chart ${id}`);
  return CHARTS[id]();
}
