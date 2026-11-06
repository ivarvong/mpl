// Palette PNG output and the built-in deflate's level (issue #15). Every PNG here is decoded by test/png-oracle.ts,
// which undoes all five filter types and reads palette bit depths 1/2/4/8 and tRNS; during development the same files
// were also decoded by Pillow, with identical pixels.
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { subplots } from '../src/index.ts';
import { canvasOf, invalidateBlocks } from '../src/render/agg/canvas.ts';
import type { Canvas } from '../src/render/agg/canvas.ts';
import { encodePNG, encodePNGSync, pngStream, zlibSync, effortOf } from '../src/render/png.ts';
import { quantize } from '../src/render/palette.ts';
import { readPNG } from './png-oracle.ts';

let seed = 4242;
const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const some = (value: number) => ({ kind: 'some' as const, value });
const none = { kind: 'none' as const };
const distinct = (px: Uint8Array): number => new Set(new Uint32Array(px.buffer, px.byteOffset, px.length / 4)).size;
const alphas = (px: Uint8Array): Set<number> => new Set(px.filter((_, i) => (i & 3) === 3));
const ihdr = (png: Uint8Array): { readonly bits: number; readonly type: number } => ({ bits: png[24], type: png[25] });
const hasChunk = (png: Uint8Array, name: string): boolean => Buffer.from(png).includes(Buffer.from(name, 'latin1'));
async function collect(s: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [], r = s.getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const x = await r.read();
    if (x.done) break;
    parts.push(x.value);
  }
  return Buffer.concat(parts);
}

// 1. the deflate round-trips at every level, on generic data and with a 1-byte left distance (palette rows)
{
  const cases = [new Uint8Array(0), new Uint8Array([7]), new Uint8Array([1, 2]), new Uint8Array(70000), new Uint8Array(40000).fill(255),
    Uint8Array.from({ length: 60000 }, () => (rnd() * 256) | 0), Uint8Array.from({ length: 60000 }, (_, i) => (i % 7 === 0 ? (rnd() * 4) | 0 : i & 3)),
    Uint8Array.from({ length: 120000 }, (_, i) => ((i / 997) | 0) % 256)];
  for (let k = 0; k < 12; k++) {
    const n = (rnd() * 40000) | 0, a = new Uint8Array(n);
    for (let i = 0; i < n; i++) a[i] = rnd() < 0.3 && i > 300 ? a[i - 1 - ((rnd() * 300) | 0)] : (rnd() * (rnd() < 0.5 ? 4 : 256)) | 0;
    cases.push(a);
  }
  for (let level = 1; level <= 9; level++) {
    for (const d of cases) for (const [row, left] of [[0, 4], [641, 1]] as const) {
      assert.deepEqual(new Uint8Array(inflateSync(zlibSync(d, row, left, effortOf(level)))), d, `level ${level}, n=${d.length}, left ${left}`);
    }
  }
  assert.throws(() => effortOf(0), /level must be an integer in 1\.\.9/);
  assert.throws(() => effortOf(10), /level/);
}

// 2. adversarial canvases: every palette budget gives a valid PNG of palette colors, lossless when the budget covers
//    the canvas' colors, at the smallest bit depth, deterministic, and the same through every path
const canvases: Canvas[] = [[1, 1], [3, 7], [33, 9], [64, 64], [97, 40], [700, 3]].flatMap(([w, h]) => {
  const flat = new Uint8Array(w * h * 4).fill(200);
  const noise = Uint8Array.from({ length: w * h * 4 }, () => (rnd() * 256) | 0);
  const few = Uint8Array.from({ length: w * h * 4 }, (_, i) => (rnd() < 0.05 ? (rnd() * 3) | 0 : (i & 3) * 60));
  const translucent = Uint8Array.from({ length: w * h * 4 }, (_, i) => ((i & 3) === 3 ? [0, 128, 255][(i >> 2) % 3] : ((i >> 2) % 5) * 50));
  return [flat, noise, few, translucent].flatMap((px) => { const a = canvasOf(w, h, 72, px), b = canvasOf(w, h, 72, px.slice()); invalidateBlocks(b); return [a, b]; });
});
let checked = 0;
for (const c of canvases) {
  const nColors = distinct(c.px);
  for (const colors of [1, 2, 3, 4, 5, 16, 17, 256]) {
    const png = encodePNGSync(c, { colors: some(colors), level: none });
    const got = readPNG(Buffer.from(png));
    assert.equal(got.w, c.w); assert.equal(got.h, c.h);
    const used = distinct(got.px);
    assert.ok(used <= colors, `${c.w}x${c.h}: ${used} colors in a ${colors}-color PNG`);
    if (nColors <= colors) assert.deepEqual(got.px, c.px, `${c.w}x${c.h} with ${nColors} colors is lossless at colors=${colors}`);
    const size = quantize(c, colors).size;
    assert.equal(ihdr(png).type, 3);
    assert.equal(ihdr(png).bits, size <= 2 ? 1 : size <= 4 ? 2 : size <= 16 ? 4 : 8, `bit depth for ${size} entries`);
    assert.equal(hasChunk(png, 'tRNS'), got.px.some((v, i) => (i & 3) === 3 && v !== 255), 'tRNS exactly when an entry is translucent');
    assert.deepEqual(encodePNGSync(c, { colors: some(colors), level: none }), png, 'deterministic');
    if (colors === 16) {
      // oxlint-disable-next-line no-await-in-loop -- sequential on purpose: one canvas at a time
      for (const other of [await encodePNG(c, { colors: some(16) }), await collect(pngStream(c, { colors: some(16) })), encodePNGSync(c, { colors: some(16), level: some(9) })]) {
        assert.deepEqual(readPNG(Buffer.from(other)).px, got.px, 'sync, async, stream and every level decode alike');
      }
    }
    checked++;
  }
  for (const level of [1, 5, 9]) assert.deepEqual(readPNG(Buffer.from(encodePNGSync(c, { colors: none, level: some(level) }))).px, c.px, `RGBA at level ${level}`);
}
assert.throws(() => quantize(canvases[0], 0), /colors must be an integer in 1\.\.256/);
assert.throws(() => quantize(canvases[0], 257), /1\.\.256/);

// 3. the reference figure from the issue (the README's six-line quickstart, 640x480): flat colors stay exact, quality and size
//    stay within budget. Measured when written: 794 colors; RGBA 42,336 B; colors=64 13,178 B (level 9: 11,970 B), PSNR 54.4 dB.
const quickstart = (kw: Record<string, unknown>) => {
  const x = Array.from({ length: 200 }, (_, i) => (i / 199) * 4 * Math.PI);
  const [fig, ax] = subplots();
  ax.plot(x, x.map(Math.sin), { label: 'sin(x)' });
  ax.plot(x, x.map(Math.cos), '--', { label: 'cos(x)' });
  ax.legend();
  return { rgba: fig.toRGBA(), png: fig.toPNGSync(kw) };
};
{
  const { rgba, png: full } = quickstart({});
  const { png } = quickstart({ colors: 64 }), { png: small } = quickstart({ colors: 64, level: 9 });
  const got = readPNG(Buffer.from(png));
  let se = 0, maxd = 0, flatExact = true;
  const counts = new Map<number, number>();
  const u = new Uint32Array(rgba.px.buffer);
  for (const v of u) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (let i = 0; i < rgba.px.length; i++) {
    if ((i & 3) === 3) continue;
    const d = got.px[i] - rgba.px[i];
    se += d * d; maxd = Math.max(maxd, Math.abs(d));
  }
  for (let p = 0; p < u.length; p++) if ((counts.get(u[p]) ?? 0) >= 0.0005 * u.length && [0, 1, 2, 3].some((q) => got.px[4 * p + q] !== rgba.px[4 * p + q])) flatExact = false;
  const psnr = 10 * Math.log10((255 * 255) / (se / (rgba.px.length * 0.75)));
  assert.ok(flatExact, 'every color covering >= 0.05% of the figure keeps its exact value');
  assert.ok(psnr >= 53, `quickstart colors=64 PSNR ${psnr.toFixed(1)} dB, budget >= 53`);
  assert.ok(png.length <= 13_500, `quickstart colors=64 is ${png.length} B, budget 13,500 B`);
  assert.ok(small.length <= 12_100 && small.length < png.length, `quickstart colors=64 level=9 is ${small.length} B, budget 12,100 B`);
  assert.ok(png.length < full.length / 3, 'a 64-color palette is under a third of the RGBA file');
  console.log(`png palette: quickstart ${full.length} B RGBA, ${png.length} B at 64 colors (${small.length} B at level 9), PSNR ${psnr.toFixed(1)} dB, max |Δ| ${maxd}`);
}

// 4. a transparent figure keeps its alpha through the palette (tRNS)
{
  const [fig, ax] = subplots({ rc: { 'figure.facecolor': 'none', 'axes.facecolor': 'none' } });
  ax.plot([0, 1], [0, 1]);
  const rgba = fig.toRGBA(), got = readPNG(Buffer.from(fig.toPNGSync({ colors: 256 })));
  assert.ok(alphas(rgba.px).has(0) && alphas(got.px).has(0), 'transparent pixels stay transparent');
}

// 5. the Figure API validates its keywords
{
  const [fig, ax] = subplots();
  ax.plot([0, 1], [0, 1]);
  for (const bad of [0, 257, 1.5, '64']) assert.throws(() => fig.toPNGSync({ colors: bad }), /colors must be an integer in 1\.\.256/);
  for (const bad of [0, 10, 2.5]) assert.throws(() => fig.toPNGSync({ level: bad }), /level must be an integer in 1\.\.9/);
  assert.throws(() => fig.toPNG({ level: 9 }), /unexpected keyword argument 'level'/);
  assert.throws(() => fig.pngStream({ level: 9 }), /unexpected keyword argument 'level'/);
  assert.equal(readPNG(Buffer.from(await fig.toPNG({ colors: 8 }))).w, 640);
}
console.log(`png palette: ${checked} palette encodings of ${canvases.length} adversarial canvases valid, levels 1..9 round-trip`);
