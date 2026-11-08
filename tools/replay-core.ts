// Replay a fixture spec against any mpl build: the Node source, dist/browser in Chromium, or a Worker
// bundle. No Node imports, so browsers and workerd load it as is; tools/replay.ts binds it to src/.
import type { Axes, Figure, subplots as SubplotsFn } from '../src/index.ts';
import type { ConciseDateFormatterInit } from '../src/core/date-formatters.ts';

/** Date-axis constructors from the mpl build under test (src, dist/browser, or page bundle), by their exported names:
 *  AutoDateLocator, ConciseDateFormatter, DateFormatter and the Year/Month/Day/Hour/Minute/SecondLocator classes. */
export type DateCtors = Readonly<Record<string, unknown>>;
type Ctor = new (...args: unknown[]) => unknown;
const ctor = (dates: DateCtors, name: string): Ctor => {
  const c = dates[name];
  if (typeof c !== 'function') throw new Error(`replay: no date constructor ${name}`);
  return c as Ctor;
};

/** A fixture file as matplotlib's generator wrote it (JSON, so deliberately loose). */
// oxlint-disable-next-line typescript/no-explicit-any -- oracle JSON, read key by key
export type Fixture = any;
/** The subplots() of whichever mpl build is under test. */
export type Subplots = typeof SubplotsFn;
type Dyn = Record<string, (...args: unknown[]) => unknown>;
/** JSON args to mpl args, at any depth: {"$dates": [...]} becomes Date[], {"$date": s} one Date (UTC, as numpy's naive datetime64). */
export const decode = (a: unknown): unknown => {
  if (Array.isArray(a)) return a.map(decode);
  if (a && typeof a === 'object' && '$dates' in a) return (a.$dates as string[]).map((s) => new Date(s + 'Z'));
  if (a && typeof a === 'object' && '$date' in a) return new Date((a.$date as string) + 'Z');
  if (a && typeof a === 'object' && '$float' in a) {
    const s = String((a as { $float: string }).$float);
    if (s === 'nan') return NaN;
    if (s === 'inf') return Infinity;
    if (s === '-inf') return -Infinity;
    return Number(s);
  }
  // {"$arange": [n, step]} → [i * step for i < n] (numpy: np.arange(n, dtype=float) * step, the same products)
  if (a && typeof a === 'object' && '$arange' in a) {
    const [n, step] = (a as { $arange: [number, number] }).$arange;
    return Array.from({ length: n }, (_, i) => i * step);
  }
  // {"$array": rows} → nested list (imshow); hist must keep bare list-of-lists as lists
  if (a && typeof a === 'object' && '$array' in a) return decode((a as { $array: unknown }).$array);
  // {"$uint8rgb": rows} passes through for Axes.imshow to build a uint8 buffer
  return a;
};
/** Replay a fixture's [method, args, kwargs] calls: ax[method](...args, kwargs). */
export function buildWith(fx: Fixture, subplots: Subplots, dates?: DateCtors): Figure {
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
      if (ffn === 'colorbar') {
        // last mappable on current Axes: prefer image, else numeric-c scatter
        let mappable: unknown = undefined;
        for (let i = ax.artists.length - 1; i >= 0; i--) {
          const a = ax.artists[i];
          if (a.kind === 'image') { mappable = a; break; }
          if (a.kind === 'scatter' && a.mappable.kind === 'some') { mappable = a; break; }
        }
        if (mappable === undefined) throw new Error('fig.colorbar: no mappable on current Axes');
        F['colorbar']?.(mappable, kwargs);
        continue;
      }
      F[ffn]?.(...args, ...(Object.keys(kwargs).length ? [kwargs] : []));
      continue;
    }
    // Runtime rc updates are encoded as a pseudo-call "$rc". Our renderer's theme is built
    // at Figure construction from fx.rc; fixtures that additionally emit a "$rc" step only
    // need it to be accepted during replay. Ignore it here (theme already reflects fx.rc).
    if (fn === '$rc') {
      continue;
    }
    if (fn === '$concise_x') {
      if (dates === undefined) throw new Error('$concise_x: DateCtors not provided to buildWith');
      const loc = new (ctor(dates, 'AutoDateLocator'))();
      const init: ConciseDateFormatterInit = kwargs && typeof kwargs === 'object' && 'show_offset' in (kwargs as object)
        ? { show_offset: Boolean((kwargs as { show_offset?: unknown }).show_offset) }
        : {};
      ax.xaxis.set_major_locator(loc);
      ax.xaxis.set_major_formatter(new (ctor(dates, 'ConciseDateFormatter'))(loc, init));
      continue;
    }
    // ['$date_x', [locator, locatorKwargs, formatter]]: ax.xaxis.set_major_locator(mdates.<locator>(**kwargs)), then
    // formatter null (the default AutoDateFormatter), {"DateFormatter": fmt} or {"ConciseDateFormatter": kwargs}
    if (fn === '$date_x') {
      if (dates === undefined) throw new Error('$date_x: DateCtors not provided to buildWith');
      const [name, lkw, f] = args0 as [string, Record<string, unknown>, Record<string, unknown> | null];
      const loc = new (ctor(dates, name))(lkw);
      ax.xaxis.set_major_locator(loc);
      if (f !== null && 'DateFormatter' in f) ax.xaxis.set_major_formatter(new (ctor(dates, 'DateFormatter'))(f['DateFormatter']));
      else if (f !== null && 'ConciseDateFormatter' in f) ax.xaxis.set_major_formatter(new (ctor(dates, 'ConciseDateFormatter'))(loc, f['ConciseDateFormatter']));
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
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : decode(v)]));
    (ax as unknown as Dyn)[fn]?.(...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  return fig;
}
