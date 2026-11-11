// Dash-tuple linestyles (issue #68):
//  1. (offset, [on, off, ...]) parses and scales as Line2D does: _get_dash_pattern's `offset %= sum(dashes)` (Python's
//     modulo), _scale_dashes by linewidth, is_dashed true for every tuple, against matplotlib 3.11.2
//     (fixtures/dash_oracle.json from fixtures/generate_dash_oracle.py), bit for bit;
//  2. the drawn figures are pixel oracles (linestyle_dash_tuples*);
//  3. invalid tuples fail as matplotlib does (negative or all-zero dash lists, a missing offset) with a clear error.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLinestyle } from '../src/core/fmt.ts';
import { dashFor, isDashedStyle } from '../src/core/marks.ts';
import { DEFAULTS } from '../src/core/rc.ts';
import { parseTheme } from '../src/core/theme.ts';
import { subplots } from '../src/index.ts';
import { unwrap } from '../src/core/types.ts';

let checks = 0;
type Case = { linestyle: unknown; linewidth: number; offset: number; dashes: number[] | null; dashed: boolean };
const cases: Case[] = JSON.parse(readFileSync(new URL('../fixtures/dash_oracle.json', import.meta.url), 'utf8'));
const theme = unwrap(parseTheme(DEFAULTS));
for (const c of cases) {
  const st = unwrap(parseLinestyle(c.linestyle));
  assert.equal(st.kind, 'some');
  if (st.kind !== 'some') continue;
  const tag = `${JSON.stringify(c.linestyle)} lw ${c.linewidth}`;
  assert.equal(isDashedStyle(st.value), c.dashed, `${tag}: is_dashed`);
  const d = dashFor(theme, st.value, c.linewidth, 1);   // k = 1: the pt values Line2D hands the GraphicsContext
  // None, or an empty list (which Agg strokes solid: RendererAgg skips the dash converter for zero dashes)
  if (c.dashes === null || c.dashes.length === 0) { assert.equal(d.kind, 'solid', `${tag}: solid`); checks++; continue; }
  assert.equal(d.kind, 'dashed', `${tag}: dashed`);
  if (d.kind !== 'dashed') continue;
  assert.ok(Object.is(d.offset, c.offset), `${tag}: offset ${d.offset} vs ${c.offset}`);
  assert.deepEqual([...d.pattern], c.dashes, `${tag}: dashes`);
  checks++;
}

const fails = (ls: unknown, re: RegExp): void => {
  const [, ax] = subplots();
  assert.throws(() => ax.plot([0, 1], [0, 1], { linestyle: ls }), (e: unknown) => e instanceof Error && re.test(String(e)));
  checks++;
};
fails([0, [-1, 2]], /must be non-negative/);
fails([0, [0, 0]], /at least one value in the dash list must be positive/);
fails([null, [1, 2]], /the offset must be a finite number/);
fails([0, [1, 'x']], /must be finite numbers/);
fails([0, 3], /must be an array of numbers/);
fails([0, [1, 2], 3], /a dash tuple is \[offset, \[on, off, \.\.\.\]\]/);
fails({ offset: 0 }, /linestyle must be a string or an \[offset, \[on, off, \.\.\.\]\] dash tuple/);

// everywhere a linestyle goes takes one
const [fig, ax] = subplots();
ax.plot([0, 1], [0, 1], { ls: [0, [1, 2, 4, 2]], label: 'l' });
ax.axhline(0.5, { linestyle: [2, [8, 3]] });
ax.axvline(0.5, { ls: [0, null] });
ax.grid(true, { linestyle: [0, [4, 1, 1, 1]] });
ax.hlines([0.2], 0, 1, { linestyles: [[0, [3, 1]]] });
ax.errorbar([0.5], [0.5], { yerr: 0.1, elinestyle: [0, [2, 1]] });
ax.legend();
// lw 1.5 pt at 100 dpi: (1, 2, 4, 2) × 1.5 × 100/72 px
assert.ok(fig.toSVG().includes('stroke-dasharray="2.0833 4.1667 8.3333 4.1667"')); checks++;

console.log(`linestyle: ${checks} checks ok (${cases.length} matplotlib dash patterns bit-exact)`);
