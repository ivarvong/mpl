// plot(…, { decimate }): opt-in min/max decimation per device-pixel column (src/core/path.ts decimateMinMax).
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import { decimateMinMax } from '../src/core/path.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

const f64 = (a: readonly number[]): Float64Array => Float64Array.from(a);
const pairs = (p: { xs: Float64Array; ys: Float64Array }): number[][] => Array.from(p.xs, (x, i) => [x, p.ys[i]]);

// one column (x in [0, 1)): first, min, max, last, in sample order
assert.deepEqual(pairs(decimateMinMax(f64([0, 0.1, 0.2, 0.3, 0.4, 0.5]), f64([5, 9, 1, 7, 3, 4]), 1)), [[0, 5], [0.1, 9], [0.2, 1], [0.5, 4]]);
// two columns per pixel split at x = 0.5
assert.deepEqual(pairs(decimateMinMax(f64([0, 0.1, 0.2, 0.3, 0.6, 0.7, 0.8, 0.9]), f64([0, 3, -3, 1, 0, 5, -5, 2]), 2)),
  [[0, 0], [0.1, 3], [0.2, -3], [0.3, 1], [0.6, 0], [0.7, 5], [0.8, -5], [0.9, 2]]);
const r = decimateMinMax(f64([0, 0.1, 0.2, 0.3, 0.6, 0.7, 0.8, 0.85, 0.9]), f64([0, 3, -3, 2, 1, 0, 5, -5, 2]), 1);
assert.deepEqual(pairs(r), [[0, 0], [0.8, 5], [0.85, -5], [0.9, 2]]);
// a NaN is kept and ends the column's run, so the line still breaks there
const n = decimateMinMax(f64([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]), f64([1, 2, 3, Number.NaN, 4, 5, 6]), 1);
assert.deepEqual(pairs(n).map((p) => p.map((v) => (Number.isNaN(v) ? 'nan' : v))), [[0, 1], [0.2, 3], [0.3, 'nan'], [0.4, 4], [0.6, 6]]);
// x not sorted: unchanged (same arrays)
const ux = f64([0, 0.2, 0.1, 0.3]), uy = f64([1, 2, 3, 4]);
const u = decimateMinMax(ux, uy, 1);
assert.ok(u.xs === ux && u.ys === uy);

// API: off by default and with false; bad values throw; markers keep every sample
const t = Array.from({ length: 20000 }, (_, i) => i / 100), y = t.map((v) => Math.sin(v * 7) + Math.sin(v * 131) * 0.3);
const svg = (kw: Record<string, unknown>): string => { const [fig, ax] = subplots(); ax.plot(t, y, kw); return fig.toSVG(); };
assert.equal(svg({}), svg({ decimate: false }));
assert.notEqual(svg({}), svg({ decimate: true }));
assert.ok(svg({ decimate: true }).length < svg({}).length);
for (const bad of [0, -1, Number.NaN, Infinity, 'yes']) assert.throws(() => svg({ decimate: bad }), /decimate must be/);
{
  const [fig, ax] = subplots();
  ax.plot([0, 0.001, 0.002, 1], [0, 1, 2, 3], 'o-', { decimate: true });
  const marker = fig.toScene().nodes.flatMap(function walk(nd): { kind: string; xs?: Float64Array }[] { return nd.kind === 'group' ? nd.nodes.flatMap(walk) : [nd]; })
    .find((nd) => nd.kind === 'markers');
  assert.equal(marker?.xs?.length, 4, 'markers sit on every sample');
}
console.log('decimate: ok');
