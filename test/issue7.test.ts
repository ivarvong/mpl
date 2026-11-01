// API contracts behind the issue #7 gaps that pixels alone cannot show: unknown keyword arguments
// fail fast, matplotlib's warnings fire, and state survives the calls matplotlib says it survives.
// The drawing itself is covered by the fixtures/ref/api_* oracle cases.
import assert from 'node:assert/strict';
import { setGlyphWarningSink } from '../src/core/fonts.ts';
import { subplots } from '../src/index.ts';

const throwsKw = (f: () => unknown, key: string): void =>
  assert.throws(f, (e: Error) => e.message.includes(`unexpected keyword argument '${key}'`), `expected '${key}' to be rejected`);

// 1. glyphs: box drawing is baked; a code point DejaVu lacks warns once, like ft2font
{
  const seen: string[] = [];
  const at = (i: number): string => String(seen.at(i));   // deepEqual narrows `seen`; read through a function
  setGlyphWarningSink((m) => { seen.push(m); });
  const [fig, ax] = subplots();
  ax.text(0, 0, '└ ls-refs ├── │');
  fig.toSVG();
  assert.deepEqual(seen, [], `box drawing should not warn: ${JSON.stringify(seen)}`);
  ax.text(0, 1, '中 中');
  fig.toSVG(); fig.toSVG();
  assert.deepEqual(seen, ['Glyph 20013 (中) missing from font(s) DejaVu Sans.']);
  ax.text(1, 1, '☃');                              // in DejaVu Sans, outside the baked blocks
  fig.toSVG();
  assert.ok(at(1).startsWith('Glyph 9731 (☃) is in DejaVu Sans but not bundled with mpljs'), at(1));
  setGlyphWarningSink((m) => { console.warn(m); });
}

// 2. grid: Line2D kwargs and aliases are accepted, unknown keys throw, bad values throw
{
  const [, ax] = subplots();
  ax.grid(true, { color: 'C1', linewidth: 0.5, linestyle: '--', alpha: 0.6, which: 'both', axis: 'x' });
  ax.grid({ c: '0.8', lw: 2, ls: ':' });
  throwsKw(() => ax.grid(true, { colour: 'red' }), 'colour');
  throwsKw(() => ax.grid(true, { zorder: 3 }), 'zorder');
  assert.throws(() => ax.grid(true, { which: 'all' }), /which must be/);
  assert.throws(() => ax.grid(true, { linestyle: 'wavy' }), /unknown linestyle/);
  assert.throws(() => ax.grid(true, { alpha: 2 }), /alpha/);
}

// 3. tight_layout: pad/h_pad/w_pad/rect accepted, unknown keys throw, margins move
{
  const [fig, ax] = subplots();
  ax.plot([0, 1], [0, 1]); ax.set_ylabel('y'); ax.set_xlabel('x');
  const before = [...fig.axes[0].position];
  fig.tight_layout({ pad: 1.08, h_pad: 1, w_pad: 1 });
  assert.notDeepEqual([...fig.axes[0].position], before);
  throwsKw(() => fig.tight_layout({ padding: 1 }), 'padding');
  assert.throws(() => fig.tight_layout({ rect: [0, 0, 1] }), /rect must be/);
}

// 4. tick labels: Text kwargs on set_*ticklabels, unknown keys throw, handles style one label
{
  const [, ax] = subplots();
  ax.plot([0, 1, 2], [0, 1, 2]);
  ax.set_yticks([0, 1, 2]);
  ax.set_yticklabels(['a', 'b', 'c'], { fontweight: 'bold', color: 'C3', fontsize: 12 });
  throwsKw(() => ax.set_xticklabels(['a'], { rotation: 45 }), 'rotation');
  const labels = ax.get_yticklabels();
  assert.deepEqual(labels.map((t) => t.get_text()), ['a', 'b', 'c']);
  labels[1].set_fontweight('normal');
  labels[2].set({ size: 'small' });
  throwsKw(() => labels[0].set({ family: 'serif' }), 'family');
  // like Axis.get_majorticklabels: every locator tick, in view or not (checked against matplotlib 3.11.2)
  assert.deepEqual(ax.get_xticklabels().map((t) => t.get_text()), ['−0.25', '0.00', '0.25', '0.50', '0.75', '1.00', '1.25', '1.50', '1.75', '2.00', '2.25']);
}
console.log('issue7 api contracts: ok');
