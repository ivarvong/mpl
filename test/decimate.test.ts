// plot(…, { decimate }): opt-in min/max decimation per device-pixel column (src/core/path.ts decimateMinMax).
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import { DECIMATE_STEP_PX, decimateMinMax } from '../src/core/path.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

const f64 = (a: readonly number[]): Float64Array => Float64Array.from(a);
const pairs = (p: { xs: Float64Array; ys: Float64Array }): number[][] => Array.from(p.xs, (x, i) => [x, p.ys[i]]);

const xs10 = (k: number): Float64Array => Float64Array.from({ length: k }, (_, i) => i / 10);
const at = (x: Float64Array, y: Float64Array, idx: readonly number[]): number[][] => idx.map((i) => [x[i], y[i]]);
// one column (x in [0, 1)): first and last, the highest (3) and lowest (8) each with its flanks, in sample order
{
  const x = xs10(10), y = f64([0, 0.5, 1, 1.5, 1, 0.5, 0, -0.5, -1, -0.5]);
  assert.deepEqual(pairs(decimateMinMax(x, y, 1)), at(x, y, [0, 2, 3, 4, 7, 8, 9]));
}
// a step longer than DECIMATE_STEP_PX keeps both its ends (2 → 3), so the jump is drawn where it happens
{
  const x = xs10(8), y = f64([0, 0.1, 0.2, 5, 5.1, 5.2, 5.3, 5.2]);
  assert.equal(DECIMATE_STEP_PX, 2);
  assert.deepEqual(pairs(decimateMinMax(x, y, 1)), at(x, y, [0, 1, 2, 3, 5, 6, 7]));
}
// two columns per pixel split at x = 0.5; each column decimates on its own
{
  const x = Float64Array.from({ length: 14 }, (_, i) => i / 14), y = f64([0, 0.2, 0.4, 0.6, 0.4, 0.2, 0, 0, -0.2, -0.4, -0.6, -0.4, -0.2, 0]);
  assert.deepEqual(pairs(decimateMinMax(x, y, 2)), at(x, y, [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13]));
  assert.deepEqual(pairs(decimateMinMax(x, y, 1)), at(x, y, [0, 2, 3, 4, 9, 10, 11, 13]));
}
// a NaN is kept and ends the column's run, so the line still breaks there
{
  const x = f64([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2]);
  const y = f64([0, 0.3, 0.6, 0.9, 1.2, 0.9, 0.6, 0.3, 0.1, Number.NaN, 0, 0, 0]);
  const got = pairs(decimateMinMax(x, y, 1)).map((p) => p.map((v) => (Number.isNaN(v) ? 'nan' : v)));
  assert.deepEqual(got, at(x, y, [0, 1, 3, 4, 5, 8, 9, 10, 11, 12]).map((p) => p.map((v) => (Number.isNaN(v) ? 'nan' : v))));
}
// x not sorted: unchanged (same arrays)
const ux = f64([0, 0.2, 0.1, 0.3]), uy = f64([1, 2, 3, 4]);
const u = decimateMinMax(ux, uy, 1);
assert.ok(u.xs === ux && u.ys === uy);

// API: off by default and with false; bad values throw; markers keep every sample
const t = Array.from({ length: 20000 }, (_, i) => i / 100), y = t.map((v) => Math.sin(v * 7) + Math.sin(v * 131) * 0.01 + Math.sin(v * 977) * 0.008);
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
