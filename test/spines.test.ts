// Spine.set_position accepts what matplotlib's does ('center', 'zero', ['outward' | 'axes' | 'data', amount]) and throws on
// anything else; rc axes.spines.* only sets the initial visibility. Pixels are checked by the spines_* fixtures.
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';

const [fig, ax] = subplots({ rc: { 'axes.spines.top': false } });
ax.plot([0, 1], [0, 1]);
for (const p of ['center', 'zero', ['outward', 5], ['outward', -3], ['axes', 0.25], ['data', 0.5]]) ax.spines.left.set_position(p);
for (const bad of ['middle', ['outward'], ['inward', 3], ['axes', 'x'], ['data', NaN], 5, ['outward', 1, 2]]) {
  assert.throws(() => ax.spines.bottom.set_position(bad), /spine position/, `rejects ${JSON.stringify(bad)}`);
}
const spines = (): number => (fig.toSVG().match(/stroke="#000000" stroke-width="[\d.]+" stroke-linecap="square"\/>/g) ?? []).length;
assert.equal(spines(), 3, 'rc axes.spines.top false hides the top spine');
ax.spines.top.set_visible(true);
assert.equal(spines(), 4, 'set_visible(true) brings it back');
console.log('spines: set_position kinds and errors, rc visibility — ok');
