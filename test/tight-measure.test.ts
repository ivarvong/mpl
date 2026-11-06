// tight_layout measures each Axes' tight bbox with tightBoxes, a layout that skips drawing artists (they enter
// the bbox only through a loc='best' legend's placement). Check it against the full layout's meta[i].tight,
// bit for bit, on every fixture's figure; and that the measuring pass does not leave a stale layout behind.
import assert from 'node:assert/strict';
import { layoutFigure, tightBoxes } from '../src/core/layout.ts';
import { subplots } from '../src/index.ts';
import { Tracer } from '../src/trace.ts';
import { build, fixtureNames, loadFixture } from '../tools/replay.ts';

const off = new Tracer();
let figs = 0, axes = 0, skipped = 0;
for (const name of fixtureNames()) {
  const fig = build(loadFixture(name));
  const spec = fig['spec']();
  const full = layoutFigure(spec, off).meta.map((m) => m.tight);
  const fast = tightBoxes(spec, off);
  assert.equal(fast.length, full.length, name);
  fast.forEach((b, i) => {
    for (const k of ['x0', 'y0', 'x1', 'y1'] as const) assert.ok(Object.is(b[k], full[i][k]), `${name} axes[${i}].${k}: ${b[k]} vs ${full[i][k]}`);
  });
  figs++; axes += fast.length;
  skipped += spec.axes.filter((ax) => !(ax.legend.kind === 'on' && ax.legend.loc.kind === 'best')).length;
}

// tight_layout then render: the layout after it runs at the adjusted params, and the cache sees the change
const [fig, ax] = subplots(2, 2);
ax[0][0].plot([1, 2, 3], [1, 10, 100], { label: 'a' });
ax[0][0].set_yscale('log');
ax[0][0].legend();
ax[1][1].set_xlabel('x label');
const before = fig.toPNGSync();
fig.tight_layout();
const after = fig.toPNGSync();
assert.ok(before.length !== after.length || before.some((v, i) => v !== after[i]), 'tight_layout changes the render');
assert.notEqual(fig.subplotpars.left, 0.125, 'margins moved');
console.log(`tight measure: ${figs} figures, ${axes} axes bit-identical (${skipped} measured without drawing artists): ok`);
