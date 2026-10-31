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
    if (fn === 'twinx') { ax = ax.twinx(); axes.push(ax); continue; }
    if (fn === 'sca') { ax = axes[args[0] as number] as Axes; continue; }
    if (typeof (ax as unknown as Dyn)[fn] !== 'function') throw new Error(`no Axes.${fn}`);
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : v]));
    (ax as unknown as Dyn)[fn]?.(...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  return fig;
}
