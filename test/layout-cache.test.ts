import assert from 'node:assert/strict';
import { subplots, tracer } from '../src/index.ts';

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
console.log('layout cache: ok');

