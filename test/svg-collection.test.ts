// Scatter collections in SVG follow matplotlib's RendererSVG.draw_path_collection: where matplotlib's own SVG (the
// fixture's reference .svg, written by matplotlib 3.11.2) defines a collection's paths once in <defs> and places each
// member with <use>, mpl does the same, with the same number of collection paths and uses; where matplotlib writes
// the members inline, so does mpl. The raster output is untouched (compare.ts stays pixel-exact): Agg draws the
// collection's member paths exactly as before.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';
import { build, loadFixture } from '../tools/replay.ts';

const REF = new URL('../fixtures/ref/', import.meta.url);
const names: string[] = JSON.parse(readFileSync(new URL('_index.json', REF), 'utf8'));
const count = (s: string, re: RegExp): number => s.match(re)?.length ?? 0;
// matplotlib: <path id="C0_0_<hash>" d=…/> in defs, <use xlink:href="#C0_0_<hash>" x y style/>; mpl: id="C<k>_<i>", href
const mplDefs = /<path id="C[0-9a-f]+_[0-9a-f]+_[0-9a-f]+"/g, mplUses = /<use xlink:href="#C[0-9a-f]+_/g;
const ourDefs = /<path id="C[0-9a-f]+_[0-9a-f]+"/g, ourUses = /<use href="#C[0-9a-f]+_/g;

let withUse = 0, checked = 0;
for (const n of names) {
  const ref = readFileSync(new URL(`${n}.svg`, REF), 'utf8');
  const svg = build(loadFixture(n)).toSVG();
  const want = { defs: count(ref, mplDefs), uses: count(ref, mplUses) }, got = { defs: count(svg, ourDefs), uses: count(svg, ourUses) };
  assert.deepEqual(got, want, `${n}: collection <defs> paths and <use> members as matplotlib's SVG`);
  if (want.uses > 0) withUse++;
  checked++;
}
assert.ok(withUse >= 10, `fixtures exercising draw_path_collection's <use> form: ${withUse}`);

// a 2000-point colour-mapped scatter: one defined path, 2000 uses, each with its own fill, no inline member paths
{
  const xs = Array.from({ length: 2000 }, (_, i) => i), ys = xs.map((x) => Math.sin(x / 100));
  const [fig, ax] = subplots();
  ax.scatter(xs, ys, { c: xs, s: 12, edgecolors: 'none' });
  const svg = fig.toSVG();
  assert.equal(count(svg, ourDefs), 1);
  assert.equal(count(svg, ourUses), 2000);
  assert.equal(count(svg, /<use href="#C[^>]* fill="#[0-9a-f]{6}" stroke="none"\/>/g), 2000);
  // ids stay unique and every reference resolves, with an id prefix too
  for (const s of [svg, fig.toSVG({ idPrefix: 'p-' })]) {
    const ids = [...s.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of s.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(m[1] ?? ''), `dangling #${m[1]}`);
  }
  // precision applies to the defined path and the offsets
  assert.ok(!/<use [^>]*x="-?\d+\.\d{2,}"/.test(fig.toSVG({ precision: 1 })));
}
// per-point sizes: one path per size and one use each, which matplotlib's estimate says is larger than inline paths
{
  const [fig, ax] = subplots();
  ax.scatter([1, 2, 3], [1, 2, 3], { s: [10, 20, 30], c: ['r', 'g', 'b'] });
  assert.equal(count(fig.toSVG(), ourUses), 0, 'inline when uses per path is 1');
}
console.log(`svg collection: ${checked} fixtures match matplotlib's defs/use structure (${withUse} use the <use> form) — ok`);
