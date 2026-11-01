// Replay a fixture spec against any mpljs build: the Node source, dist/browser in Chromium, or a Worker
// bundle. No Node imports, so browsers and workerd load it as is; tools/replay.ts binds it to src/.
import type { Axes, Figure, subplots as SubplotsFn } from '../src/index.ts';

/** A fixture file as matplotlib's generator wrote it (JSON, so deliberately loose). */
// oxlint-disable-next-line typescript/no-explicit-any -- oracle JSON, read key by key
export type Fixture = any;
/** The subplots() of whichever mpljs build is under test. */
export type Subplots = typeof SubplotsFn;
type Dyn = Record<string, (...args: unknown[]) => unknown>;
/** JSON args to mpljs args: {"$dates": [...]} becomes Date[]. */
export const decode = (a: unknown): unknown =>
  (a && typeof a === 'object' && !Array.isArray(a) && '$dates' in a ? (a.$dates as string[]).map((s) => new Date(s + 'Z')) : a);
/** Replay a fixture's [method, args, kwargs] calls: ax[method](...args, kwargs). */
export function buildWith(fx: Fixture, subplots: Subplots): Figure {
  // a leading ['$subplots', [nrows, ncols], kwargs] builds a grid; its Axes are listed row-major, as fig.axes
  const grid = fx.spec.find((c: Fixture) => c[0] === '$subplots');
  const [fig, made] = grid
    ? subplots(grid[1][0] as number, grid[1][1] as number, { ...grid[2], squeeze: false, style: fx.style, rc: fx.rc || {} })
    : subplots({ style: fx.style, rc: fx.rc || {} });
  const axes: Axes[] = Array.isArray(made) ? made.flat() : [made];
  let ax: Axes = axes[0];
  for (const [fn, args0, kwargs] of fx.spec) {
    if (fn === '$subplots') continue;
    const args = args0.map(decode);
    // Figure-level calls are prefixed with 'fig.' in the spec
    if (fn.startsWith('fig.')) {
      const ffn = fn.slice(4);
      const F = fig as unknown as Dyn;
      if (typeof F[ffn] !== 'function') throw new Error(`no Figure.${ffn}`);
      F[ffn]?.(...args, ...(Object.keys(kwargs).length ? [kwargs] : []));
      continue;
    }
    // Runtime rc updates are encoded as a pseudo-call "$rc". Our renderer's theme is built
    // at Figure construction from fx.rc; fixtures that additionally emit a "$rc" step only
    // need it to be accepted during replay. Ignore it here (theme already reflects fx.rc).
    if (fn === '$rc') {
      continue;
    }
    if (fn === 'twinx') { ax = ax.twinx(); axes.push(ax); continue; }
    if (fn === 'sca') { ax = axes[args[0] as number] as Axes; continue; }
    // Spine edits: encoded as ['spine', [side, action, value]]
    if (fn === 'spine') {
      const [side, action, val] = args as [string, string, unknown];
      const spines = (ax as Axes).spines as Record<'left' | 'right' | 'top' | 'bottom',
        { [k: string]: (v: unknown) => void }>;
      // oxlint-disable-next-line typescript/no-unsafe-member-access -- action validated by generator
      const api = (spines as Record<string, { [k: string]: (v: unknown) => void }>)[side];
      if (!api || typeof api[action] !== 'function') throw new Error(`no spines.${side}.${action}`);
      api[action](val);
      continue;
    }
    // Tick label edits: ['ticklabel', [axis, index, setter, value]] is ax.get_{x,y}ticklabels()[index].setter(value)
    if (fn === 'ticklabel') {
      const [which, i, action, val] = args as ['x' | 'y', number, string, unknown];
      const labels = which === 'x' ? ax.get_xticklabels() : ax.get_yticklabels();
      const t = labels[i] as unknown as Record<string, (v: unknown) => void> | undefined;
      if (!t || typeof t[action] !== 'function') throw new Error(`no ticklabel ${which}[${i}].${action}`);
      t[action](val);
      continue;
    }
    if (typeof (ax as unknown as Dyn)[fn] !== 'function') throw new Error(`no Axes.${fn}`);
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : v]));
    (ax as unknown as Dyn)[fn]?.(...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  return fig;
}
