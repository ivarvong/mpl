// Replay a fixture spec (the same calls matplotlib ran) against mpljs.
import { readFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';
const REF = new URL('../fixtures/ref/', import.meta.url).pathname;
const decode = (a) => (a && typeof a === 'object' && !Array.isArray(a) && '$dates' in a ? a.$dates.map((s) => new Date(s + 'Z')) : a);
export const fixtureNames = () => JSON.parse(readFileSync(REF + '_index.json', 'utf8'));
export const loadFixture = (name) => JSON.parse(readFileSync(REF + name + '.json', 'utf8'));
export function build(fx) {
  const [fig, first] = subplots({ style: fx.style, rc: fx.rc || {} });
  const axes = [first];
  let ax = first;
  for (const [fn, args0, kwargs] of fx.spec) {
    const args = args0.map(decode);
    if (fn === 'twinx') { ax = ax.twinx(); axes.push(ax); continue; }
    if (fn === 'sca') { ax = axes[args[0]]; continue; }
    const kw = Object.fromEntries(Object.entries(kwargs).map(([k, v]) => [k, v && typeof v === 'object' && '$transform' in v ? (v.$transform === 'axes' ? ax.transAxes : ax.transData) : v]));
    ax[fn](...args, ...(Object.keys(kw).length ? [kw] : []));
  }
  return fig;
}
