// API contracts behind issue #14 that pixels alone cannot show. The drawing is covered by the oracle cases
// annotate_dates, text_date_numeric_axis, annotate_category, annotate_arrow_extent (and the scatter legend cases).
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';

const day = (d: number): Date => new Date(Date.UTC(2026, 0, d));
const ticks = (f: () => ReturnType<typeof subplots>): readonly string[] => {
  const [fig] = f();
  fig.toSVG();
  return fig.meta[0].x.labels;
};

// 1. annotate takes Dates in 'data' coordinates, for xy and xytext alike, as text() and axvline() do
{
  const [fig, ax] = subplots();
  ax.plot([day(1), day(2)], [1, 2]);
  const a = ax.annotate('x', [day(2), 2], { xytext: [day(1), 1.5], arrowprops: {} });
  assert.equal(a.x - a.tx, 1, 'one day apart in date numbers');
  fig.toSVG();
}

// 2. a Date in text/annotate never makes an axis a date axis (matplotlib converts these at draw time and does not
//    call update_units): a numeric axis keeps numeric ticks, and an axis with only a dated text stays numeric
{
  const numeric = ticks(() => { const r = subplots(); r[1].plot([0, 1], [0, 1]); r[1].text(day(1), 0.5, 't'); r[1].annotate('a', [day(1), 0.5]); return r; });
  assert.ok(numeric.includes('0.0') && numeric.every((l) => !l.includes('-')), `numeric ticks kept, got ${numeric.join(' ')}`);
  const empty = ticks(() => { const r = subplots(); r[1].text(day(1), 0.5, 't'); return r; });
  assert.deepEqual(empty.slice(0, 2), ['0.0', '0.2']);
}

// 3. other coordinate systems take numbers only; a Date there is an error, not a silent epoch number
{
  const [, ax] = subplots();
  ax.plot([day(1), day(2)], [1, 2]);
  assert.throws(() => ax.annotate('x', [day(1), 0.5], { xycoords: 'axes fraction' }), /'axes fraction' coordinates/);
  assert.throws(() => ax.annotate('x', [day(1), 2], { xytext: [day(1), 10], textcoords: 'offset points' }), /xytext\[0\] must be a number in 'offset points'/);
  assert.throws(() => ax.annotate('x', [day(1)]), /xy must be \[x, y\]/);
}

// 4. category names: on a categorical axis they map (a new name is appended, as StrCategoryConverter does);
//    on any other axis they are an error, where matplotlib raises ConversionError
{
  const [, ax] = subplots();
  ax.bar(['a', 'b'], [1, 2]);
  assert.equal(ax.annotate('x', ['b', 2]).x, 1);
  assert.equal(ax.text('z', 1, 'new').x, 2);
  const [, num] = subplots();
  num.plot([0, 1], [0, 1]);
  assert.throws(() => num.text('b', 0.5, 'x'), /not categorical/);
  assert.throws(() => num.annotate('x', [0.5, 'b']), /not categorical/);
}
// 5. scatter legend settings: legend() kwargs and their rc keys are validated, not ignored
{
  const [, ax] = subplots();
  ax.scatter([1, 2], [1, 2], { label: 's' });
  assert.throws(() => ax.legend({ scatterpoints: 0 }), /scatterpoints must be an integer >= 1/);
  assert.throws(() => ax.legend({ scatterpoints: 1.5 }), /scatterpoints/);
  assert.throws(() => ax.legend({ scatteryoffsets: [] }), /scatteryoffsets/);
  assert.throws(() => ax.legend({ markerscale: -1 }), /markerscale/);
  assert.throws(() => subplots({ rc: { 'legend.scatterpoints': 0 } }), /scatterpoints/);
  const [fig, ok] = subplots({ rc: { 'legend.scatterpoints': 3, 'legend.markerscale': 2 } });
  ok.scatter([1, 2], [1, 2], { label: 's' });
  ok.legend();
  fig.toSVG();
}

// 6. an empty scatter is a legend proxy: it keeps the size and colour it was given
{
  const [, ax] = subplots();
  const sc = ax.scatter([], [], { s: 80, c: 'C2', label: 'proxy' });
  assert.deepEqual([...sc.collection.sizesPt2], [80]);
  assert.equal(sc.collection.faces.length, 1);
}
// 7. coordinate-system pairs: each axis converts on its own; an offset system is textcoords-only, per axis too
{
  const [, ax] = subplots();
  ax.plot([day(1), day(2)], [1, 2]);
  const a = ax.annotate('p', [day(2), 0.5], { xycoords: ['data', 'axes fraction'] });
  assert.equal(a.y, 0.5);
  assert.throws(() => ax.annotate('p', [day(2), day(2)], { xycoords: ['data', 'axes fraction'] }), /xy\[1\] must be a number in 'axes fraction'/);
  assert.throws(() => ax.annotate('p', [1, 1], { xycoords: ['data', 'offset points'] }), /xycoords must be 'data' or/);
  assert.throws(() => ax.annotate('p', [1, 1], { xycoords: ['data'] }), /pair must have two entries/);
  ax.annotate('q', [day(1), 1], { xytext: [10, 0.5], textcoords: ['offset points', 'axes fraction'] });
}
// 8. a scatter legend over a large per-point size array: the handle's min/max sizes must not spread the array
//    (Math.max(...s) overflowed the call stack at ~1.25e5 points)
{
  const N = 200_000;
  const x = Float64Array.from({ length: N }, (_, i) => i / N);
  const [fig, ax] = subplots();
  ax.scatter(x, x, { s: Float64Array.from(x, (_, i) => 2 + (i % 5)), label: 'many' });
  ax.legend();
  fig.toScene();
}
console.log('issue 14: annotate/text unit conversion, coordinate pairs and scatter legend contracts hold');
