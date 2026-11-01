// Replay a fixture spec (the same calls matplotlib ran) against mpljs.
import { readFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';
import type { Axes, Figure } from '../src/index.ts';
const REF = new URL('../fixtures/ref/', import.meta.url).pathname;

/** A fixture file as matplotlib's generator wrote it (JSON, so deliberately loose). */
// oxlint-disable-next-line typescript/no-explicit-any -- oracle JSON, read key by key
export type Fixture = any;
type Dyn = Record<string, (...args: unknown[]) => unknown>;
/** JSON args to mpljs args: {"$dates": [...]} becomes Date[]. */
export const decode = (a: unknown): unknown =>
  (a && typeof a === 'object' && !Array.isArray(a) && '$dates' in a ? (a.$dates as string[]).map((s) => new Date(s + 'Z')) : a);
export const fixtureNames = (): string[] => JSON.parse(readFileSync(REF + '_index.json', 'utf8'));
export const loadFixture = (name: string): Fixture => JSON.parse(readFileSync(REF + name + '.json', 'utf8'));
/** Replay a fixture's [method, args, kwargs] calls: ax[method](...args, kwargs). */
export function build(fx: Fixture): Figure {
  const [fig, first] = subplots({ style: fx.style, rc: fx.rc || {} });
  const axes: Axes[] = [first];
  let ax: Axes = first;
  for (const [fn, args0, kwargs] of fx.spec) {
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
    if (typeof (ax as unknown as Dyn)[fn] !== 'function') throw new Error(`no Axes.${fn}`);
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : v]));
    (ax as unknown as Dyn)[fn]?.(...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  return fig;
}
