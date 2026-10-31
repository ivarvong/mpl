// PNG encoder properties: zlibSync round-trips through node:zlib on adversarial inputs,
// and every PNG path (sync, CompressionStream, streamed) decodes to the same pixels.
import { inflateSync } from 'node:zlib';
import { encodePNG, encodePNGSync, pngStream, zlibSync } from '../src/render/png.ts';
import { readPNG, type Pixels } from './png-oracle.ts';
import { canvasOf, invalidateBlocks } from '../src/render/agg/canvas.ts';

let seed = 12345;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const cases = [
  new Uint8Array(0), new Uint8Array([7]), new Uint8Array(70000), new Uint8Array(40000).fill(255),
  Uint8Array.from({ length: 100000 }, () => (rnd() * 256) | 0),                     // incompressible
  Uint8Array.from({ length: 100000 }, (_, i) => (i % 7 === 0 ? (rnd() * 4) | 0 : i & 3)), // short repeats
  Uint8Array.from({ length: 300000 }, (_, i) => ((i / 997) | 0) % 256),              // long runs, far matches
];
for (let k = 0; k < 40; k++) {                                                        // random structured mixes
  const n = (rnd() * 50000) | 0, a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = rnd() < 0.3 && i > 300 ? a[i - 1 - ((rnd() * 300) | 0)] : (rnd() * (rnd() < 0.5 ? 4 : 256)) | 0;
  cases.push(a);
}
let bad = 0;
for (const d of cases) {
  const back = new Uint8Array(inflateSync(zlibSync(d)));
  if (back.length !== d.length || back.some((v, i) => v !== d[i])) { bad++; console.log(`zlibSync round-trip FAILED for n=${d.length}`); }
}
// PNG paths agree with each other and with the source pixels
const w = 97, h = 61, px = new Uint8Array(w * h * 4).map((_, i) => (i * 31 + ((i / 388) | 0) * 7) & 255);
const canvas = canvasOf(w, h, 0, px);
const parts: Uint8Array[] = []; const r = pngStream(canvas).getReader();
// oxlint-disable-next-line no-await-in-loop
for (;;) { const x = await r.read(); if (x.done) break; parts.push(x.value); }
for (const [name, bytes] of [['sync', encodePNGSync(canvas)], ['async', await encodePNG(canvas)], ['stream', Buffer.concat(parts)]]) {
  const got = readPNG(Buffer.from(bytes));
  if (got.w !== w || got.h !== h || got.px.some((v, i) => v !== px[i])) { bad++; console.log(`PNG ${name} decode mismatch`); }
}
// encodePNGSync tokenizes the canvas itself, trusting its block state for flat regions: adversarial
// canvases, each encoded with exact block state (scanned) and with every block marked mixed
const blocky = (cw: number, ch: number) => {                         // rectangles of a few colors, some rows copied from above
  const a = new Uint32Array(cw * ch), pal = [0xff102030, 0xff102031, 0x00000000, 0x80ffffff, 0xff000000];
  for (let k = 0; k < 12; k++) {
    const x0 = (rnd() * cw) | 0, y0 = (rnd() * ch) | 0, x1 = Math.min(cw, x0 + ((rnd() * 90) | 0)), y1 = Math.min(ch, y0 + ((rnd() * 9) | 0)), v = pal[(rnd() * pal.length) | 0];
    for (let y = y0; y < y1; y++) a.fill(v, y * cw + x0, y * cw + x1);
  }
  for (let i = 0; i < cw * ch; i++) if (rnd() < 0.01) a[i] = (rnd() * 2 ** 32) >>> 0;
  return new Uint8Array(a.buffer);
};
const canvases = [[1, 1], [1, 300], [300, 1], [3, 7], [31, 9], [32, 9], [33, 9], [64, 64], [65, 3], [97, 40], [2049, 5], [9000, 4]].flatMap(([cw, ch]) => {
  const flat = new Uint8Array(cw * ch * 4).fill(200);
  const noise = Uint8Array.from({ length: cw * ch * 4 }, () => (rnd() * 256) | 0);
  const few = Uint8Array.from({ length: cw * ch * 4 }, (_, i) => (rnd() < 0.05 ? (rnd() * 3) | 0 : (i & 3) * 60));
  const stripes = Uint8Array.from({ length: cw * ch * 4 }, (_, i) => (((i >> 2) % cw) * 7 + ((i >> 2) / cw | 0) % 3) & 255);
  return [flat, noise, few, stripes, blocky(cw, ch)].flatMap((cpx) => {
    const exact = canvasOf(cw, ch, 72, cpx), mixed = canvasOf(cw, ch, 72, cpx.slice());
    invalidateBlocks(mixed);
    return [exact, mixed];
  });
});
for (const cv of canvases) {
  let got: Pixels = { w: -1, h: -1, px: new Uint8Array(0) };
  try { got = readPNG(Buffer.from(encodePNGSync(cv))); } catch (e) { console.log(`${cv.w}×${cv.h}: ${(e as Error).message}`); }
  if (got.w !== cv.w || got.h !== cv.h || got.px.some((v, i) => v !== cv.px[i])) { bad++; console.log(`encodePNGSync mismatch ${cv.w}×${cv.h}`); }
}
console.log(`png: ${cases.length} zlib round-trips, ${canvases.length} sync canvases, 3 PNG paths — ${bad === 0 ? 'ok' : `${bad} FAILED`}`);
if (bad) process.exitCode = 1;
