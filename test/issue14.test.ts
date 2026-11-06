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
  assert.throws(() => ax.annotate('x', [day(1), 2], { xytext: [day(1), 10], textcoords: 'offset points' }), /xytext must be \[x, y\] numbers in 'offset points'/);
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
console.log('issue 14: annotate/text unit conversion contracts hold');
