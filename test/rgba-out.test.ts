// toRGBA({ out }): render into a canvas the caller hands back (a re-render loop's previous frame) instead of a new one.
// Without out nothing a caller holds is ever touched; with out the result shares out's buffers when the size matches,
// and is pixel-identical (block state included) to a fresh render either way.
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import type { Canvas } from '../src/index.ts';
import { checkBlocks } from '../src/render/agg/canvas.ts';

const same = (a: Canvas, b: Canvas): boolean =>
  a.w === b.w && a.h === b.h && a.dpi === b.dpi && Buffer.from(a.px).equals(Buffer.from(b.px)) && Buffer.from(a.mix).equals(Buffer.from(b.mix))
  && Buffer.from(a.blk.buffer, a.blk.byteOffset, a.blk.byteLength).equals(Buffer.from(b.blk.buffer, b.blk.byteOffset, b.blk.byteLength));

const [fig, ax] = subplots();
ax.plot([0, 1, 2, 3], [0, 1, 0, 1], 'o-');
ax.set_title('out');

// no out: a new canvas per call, and an earlier result is never mutated
const a = fig.toRGBA();
const aCopy = Uint8Array.from(a.px);
ax.set_xlim(0.5, 2.5);
const b = fig.toRGBA();
assert.notEqual(a.px.buffer, b.px.buffer);
assert.ok(Buffer.from(a.px).equals(Buffer.from(aCopy)), 'a held result is untouched by the next toRGBA()');

// out with the same size: drawn into out's buffers, pixel-identical to a fresh render
ax.set_xlim(1, 3);
const fresh = fig.toRGBA();
const r = fig.toRGBA({ out: a });
assert.equal(r.px.buffer, a.px.buffer, 'reuses out');
assert.ok(same(r, fresh), 'reused render equals a fresh one');
assert.equal(checkBlocks(r), -1);

// out previously holding another figure's (denser) pixels: cleared completely
const [fig2, ax2] = subplots();
ax2.imshow([[0, 1], [1, 0]]);
const other = fig2.toRGBA();
assert.ok(same(fig.toRGBA({ out: other }), fresh));

// a different size (scale 2 vs out at 1x) renders into a new canvas; out at 2x is reused for 2x
const big = fig.toRGBA({ scale: 2, out: r });
assert.notEqual(big.px.buffer, r.px.buffer);
assert.equal(big.w, 2 * r.w);
const big2 = fig.toRGBA({ scale: 2, out: big });
assert.equal(big2.px.buffer, big.px.buffer);
assert.ok(same(big2, fig.toRGBA({ scale: 2 })));

// same pixel size at another dpi (a 6.4x4.8 figure at 100 dpi vs 3.2x2.4 at 200): buffers shared, dpi updated
const [fig3, ax3] = subplots({ figsize: [3.2, 2.4], dpi: 200 });
ax3.plot([0, 1], [1, 0]);
const at200 = fig3.toRGBA({ out: fresh });
assert.equal(at200.px.buffer, fresh.px.buffer);
assert.equal(at200.dpi, 200);
assert.ok(same(at200, fig3.toRGBA()));

// anything but a whole toRGBA canvas is refused
const c = fig.toRGBA();
for (const bad of [1, {}, { ...c, w: c.w + 1 }, { ...c, u32: new Uint32Array(c.w * c.h) }, { ...c, blkI32: new Int32Array(c.blk.length) }, { ...c, mix: new Uint8Array(1) }]) {
  assert.throws(() => fig.toRGBA({ out: bad }), /out must be a canvas returned by toRGBA/);
}
console.log('rgba out: reuse, no-out isolation, size/dpi changes, validation — ok');
