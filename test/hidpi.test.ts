// savefig-style dpi / scale on toPNG / toPNGSync / toRGBA: validation + size + scale convenience.
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import { readPNG } from './png-oracle.ts';

const [fig, ax] = subplots();
ax.plot([0, 1, 2], [0, 1, 0]);
ax.set_title('hidpi');

const def = fig.toPNGSync();
const d200 = fig.toPNGSync({ dpi: 200 });
const s2 = fig.toPNGSync({ scale: 2 });
const d300 = fig.toPNGSync({ dpi: 300 });
const s3 = fig.toPNGSync({ scale: 3 });

const a = readPNG(Buffer.from(def));
const b = readPNG(Buffer.from(d200));
const c = readPNG(Buffer.from(d300));
assert.equal(a.w, 640); assert.equal(a.h, 480);
assert.equal(b.w, 1280); assert.equal(b.h, 960);
assert.equal(c.w, 1920); assert.equal(c.h, 1440);
assert.ok(Buffer.from(d200).equals(Buffer.from(s2)), 'scale:2 ≡ dpi:200 at fig.dpi=100');
assert.ok(Buffer.from(d300).equals(Buffer.from(s3)), 'scale:3 ≡ dpi:300 at fig.dpi=100');

// pHYs matches Agg: round(dpi / 0.0254)
function physDpi(png: Uint8Array): number {
  const u8 = png;
  const u32 = (o: number) => (u8[o] << 24) | (u8[o + 1] << 16) | (u8[o + 2] << 8) | u8[o + 3];
  for (let i = 8; i < u8.length;) {
    const ln = u32(i), typ = String.fromCharCode(u8[i + 4], u8[i + 5], u8[i + 6], u8[i + 7]);
    if (typ === 'pHYs') return u32(i + 8) * 0.0254;
    i += 12 + ln;
    if (typ === 'IEND') break;
  }
  throw new Error('no pHYs');
}
assert.ok(Math.abs(physDpi(d200) - 200) < 1e-3);
assert.ok(Math.abs(physDpi(d300) - 300) < 1e-3);

// toRGBA({ dpi }) size
const rgba = fig.toRGBA({ dpi: 200 });
assert.equal(rgba.w, 1280); assert.equal(rgba.h, 960); assert.equal(rgba.dpi, 200);

// invalid → RangeError
for (const bad of [0, -1, NaN, Infinity, -Infinity, 10001]) {
  assert.throws(() => fig.toPNGSync({ dpi: bad }), (e: unknown) => e instanceof RangeError);
  assert.throws(() => fig.toPNGSync({ scale: bad }), (e: unknown) => e instanceof RangeError);
}
assert.throws(() => fig.toPNGSync({ dpi: 200, scale: 2 }), /got both dpi and scale/);

// figure dpi unchanged after savefig override
assert.equal(fig.dpi, 100);
assert.equal(fig.toPNGSync().byteLength, def.byteLength);

console.log('hidpi: dpi/scale sizes, pHYs, validation, figure dpi unchanged — ok');
