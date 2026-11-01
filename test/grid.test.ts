// Subplot grids: subplots() return shapes (checked by the type checker and at run time), sharing,
// subplots_adjust / gridspec_kw validation, and the multi-axes SVG, PNG and tracing paths.
// The pictures themselves are oracle cases (fixtures/ref/grid_*), pixel-checked in compare.ts.
import assert from 'node:assert/strict';
import { Axes, subplots, tracer } from '../src/index.ts';
import type { AxesGrid2D, SubplotsAxes } from '../src/index.ts';

// ---- return shapes: each annotation below is checked by `tsc`, the asserts check the values
const [, one]: readonly [unknown, Axes] = subplots();
const [, oneKw]: readonly [unknown, Axes] = subplots({ figsize: [4, 3] });
const [, sq]: readonly [unknown, Axes] = subplots(1, 1);
const [, row]: readonly [unknown, readonly Axes[]] = subplots(1, 3);
const [, col]: readonly [unknown, readonly Axes[]] = subplots(3);
const [, grid]: readonly [unknown, AxesGrid2D] = subplots(2, 2);
const [, unsqueezed]: readonly [unknown, AxesGrid2D] = subplots(1, 1, { squeeze: false });
const n: number = [1, 2][1];
const [, dynamic]: readonly [unknown, SubplotsAxes] = subplots(n, n);
for (const ax of [one, oneKw, sq]) assert.ok(ax instanceof Axes);
assert.equal(row.length, 3); assert.equal(col.length, 3);
assert.deepEqual([grid.length, grid[0].length, grid[1].length], [2, 2, 2]);
assert.deepEqual([unsqueezed.length, unsqueezed[0].length], [1, 1]);
assert.ok(Array.isArray(dynamic) && Array.isArray(dynamic[0]), '2x2 at run time is rows of Axes');

// ---- sharing: one Axis per group, label_outer on the inner Axes
{
  const [fig, ax] = subplots(2, 2, { sharex: 'col', sharey: true });
  assert.equal(ax[0][0].xaxis, ax[1][0].xaxis); assert.notEqual(ax[0][0].xaxis, ax[0][1].xaxis);
  assert.equal(ax[0][0].yaxis, ax[1][1].yaxis);
  ax[0][0].plot([0, 1], [0, 1]); ax[1][1].plot([0, 5], [0, 50]);
  ax[1][0].set_xlim(-2, 2);   // shared with [0][0] only
  fig.toScene();
  assert.deepEqual(fig.meta[0].x.lim, [-2, 2]); assert.deepEqual(fig.meta[2].x.lim, [-2, 2]);
  assert.notDeepEqual(fig.meta[1].x.lim, [-2, 2]);
  assert.deepEqual(fig.meta[0].y.lim, fig.meta[3].y.lim, 'sharey=true: every Axes has the union limits');
  assert.equal(fig.meta[0].x.labels.length, 0, 'top row: no x tick labels'); assert.ok(fig.meta[2].x.labels.length > 0);
  assert.equal(fig.meta[1].y.labels.length, 0, 'right column: no y tick labels'); assert.ok(fig.meta[0].y.labels.length > 0);
}

// ---- parsing errors
assert.throws(() => subplots(2, 2, { sharex: 'column' as 'col' }), /sharex must be/);
assert.throws(() => subplots(2, 2, { gridspec_kw: { width_ratios: [1, 2, 3] } }), /width_ratios must be 2 positive numbers/);
assert.throws(() => subplots(0, 2), /nrows must be a positive integer/);
assert.throws(() => subplots(2, 2, { bogus: 1 }), /unexpected keyword argument 'bogus'/);
assert.throws(() => subplots(1, 2)[0].subplots_adjust({ left: 0.9, right: 0.1 }), /left cannot be >= right/);

// ---- multi-axes output: one clip region per Axes in SVG, a full PNG, and one axes.layout span per Axes
{
  tracer.enable();
  const [fig, ax] = subplots(2, 3, { sharey: 'row' });
  ax.flat().forEach((a, i) => a.plot([0, 1, 2], [i, i + 1, i * 2]));
  ax[1][2].twinx().plot([0, 2], [10, 20]);
  const svg = fig.toSVG();
  assert.equal((svg.match(/<clipPath /g) ?? []).length, 7, 'six cells and one twin each clip their artists');
  const png = fig.toPNGSync();
  assert.ok(png.length > 1000);
  const spans = tracer.spans();
  assert.equal(spans.filter((s) => s.name === 'axes.layout').length, 7);
  assert.equal(spans.filter((s) => s.name === 'plan.y').length, 3, 'two sharey rows and the twin');
  assert.equal(spans.filter((s) => s.name === 'plan.x').length, 6, 'six columns, the twin joins its host');
  tracer.disable();
}
console.log('grid: shapes, sharing, parsing, svg/png/trace — ok');
