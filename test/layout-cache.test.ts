import assert from 'node:assert/strict';
import { subplots, tracer } from '../src/index.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

const [fig, ax] = subplots();
ax.plot([0, 1, 2, 3], [1, 4, 9, 16], 'o-', { label: 'sq' });
ax.set_title('layout cache');

tracer.enable(); tracer.clear();
const svg = fig.toSVG();
assert.ok(svg.startsWith('<svg'));
const firstPng = fig.toPNGSync();
const layoutSpans1 = tracer.spans().filter((s) => s.name === 'figure.layout').length;
assert.equal(layoutSpans1, 1, 'layout runs once across SVG and PNG');

// A second PNG render should reuse cached layout and be bit-identical
const secondPng = fig.toPNGSync();
const layoutSpans2 = tracer.spans().filter((s) => s.name === 'figure.layout').length;
assert.equal(layoutSpans2, 1, 'layout cache reused for subsequent renders');
assert.ok(firstPng.length === secondPng.length && firstPng.every((b, i) => b === secondPng[i]), 'PNG bytes identical with layout cache');

// A mutation must invalidate the cache and trigger a new layout
ax.set_title('changed');
fig.toPNGSync();
const layoutSpans3 = tracer.spans().filter((s) => s.name === 'figure.layout').length;
assert.equal(layoutSpans3, 2, 'mutation invalidates layout cache');

// The key is a snapshot (src/core/snapshot.ts), not JSON: a caller's Float64Array is held zero-copy, so mutating it
// in place must invalidate the cache, and the re-render must match a fresh figure with the new data.
{
  const ys = Float64Array.from([1, 4, Number.NaN, 16]);
  const [f2, a2] = subplots();
  a2.plot([0, 1, 2, 3], ys);
  tracer.clear();
  const svgA = f2.toSVG();
  f2.toSVG();
  assert.equal(tracer.spans().filter((s) => s.name === 'figure.layout').length, 1, 'NaN data still hits the cache');
  ys[1] = 9;
  const svgB = f2.toSVG();
  assert.equal(tracer.spans().filter((s) => s.name === 'figure.layout').length, 2, 'in-place Float64Array mutation invalidates the cache');
  assert.notEqual(svgA, svgB);
  const [f3, a3] = subplots();
  a3.plot([0, 1, 2, 3], Float64Array.from([1, 9, Number.NaN, 16]));
  assert.equal(svgB, f3.toSVG(), 're-render equals a fresh figure');
}
// One walk compares and re-snapshots (resnapshot): unchanged subtrees keep the previous snapshot's nodes, so a miss
// costs no deep copy. A data array shared across a miss must still be checked against the bytes it had when first
// copied, and a pan that returns to an earlier view must render that view again.
{
  const ys = Float64Array.from([1, 4, 9, 16]);
  const [f4, a4] = subplots();
  a4.plot([0, 1, 2, 3], ys);
  tracer.clear();
  const at = (lo: number): string => { a4.set_xlim(lo, lo + 2); return f4.toSVG(); };
  const v0 = at(0), v1 = at(0.5);
  assert.notEqual(v0, v1);
  assert.equal(tracer.spans().filter((s) => s.name === 'figure.layout').length, 2, 'each new view lays out once');
  assert.equal(at(0), v0, 'returning to an earlier view renders it again');
  ys[2] = 2;                                   // in place, after misses that shared the data snapshot
  const v2 = at(0);
  assert.equal(tracer.spans().filter((s) => s.name === 'figure.layout').length, 4, 'in-place mutation after shared misses invalidates');
  const [f5, a5] = subplots();
  a5.plot([0, 1, 2, 3], Float64Array.from([1, 4, 2, 16])); a5.set_xlim(0, 2);
  assert.equal(v2, f5.toSVG(), 'and the re-render equals a fresh figure');
}
{
  const { NO_SNAPSHOT, resnapshot, sameSpec, snapshot } = await import('../src/core/snapshot.ts');
  const live = { a: [1, Number.NaN, 'x'], b: { c: Float64Array.from([1, 2]), d: true }, e: new Date(0), f: (): number => 1 };
  const s0 = snapshot(live);
  assert.ok(Object.is(resnapshot(s0, live), s0), 'unchanged spec returns the previous snapshot itself');
  assert.ok(sameSpec(s0, live));
  live.b.d = false;
  const s1 = resnapshot(s0, live);
  assert.notEqual(s1, s0);
  assert.ok(!sameSpec(s0, live) && sameSpec(s1, live));
  assert.ok(Object.is(resnapshot(s1, live), s1));
  live.b.c[0] = 5; assert.ok(!sameSpec(s1, live), 'typed array bytes are compared');
  live.b.c[0] = 1; live.e = new Date(1); assert.ok(!sameSpec(s1, live), 'non-plain objects compare by JSON');
  live.e = new Date(0); live.a.push(2); assert.ok(!sameSpec(s1, live), 'array length');
  live.a.pop(); assert.ok(sameSpec(s1, live));
  assert.ok(!sameSpec(s1, { ...live, g: 1 }) && !sameSpec(s1, { b: live.b, a: live.a, e: live.e, f: live.f }), 'key set and order');
  assert.ok(!sameSpec(NO_SNAPSHOT, live) && !sameSpec(snapshot([1, 2]), { 0: 1, 1: 2 }) && !sameSpec(snapshot(Float64Array.from([1])), Float32Array.from([1])));
}
console.log('layout cache: ok');

