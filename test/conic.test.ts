// conicSteps (src/render/ft.ts) steps gray_render_conic's DDA in two-word doubles; FreeType steps it in 64-bit
// integers. Check every emitted point against the 64-bit arithmetic in BigInt (the implementation it replaced,
// verbatim) on random conics: glyph-sized at the glyph cache's far origin, off-canvas negative coordinates,
// huge glyphs, curvature near the one-line threshold and near the 2^31 limit. CONIC_N sets the count.
import assert from 'node:assert/strict';
import { CONIC_STEPS, conicSteps } from '../src/render/ft.ts';

const ONE_PIXEL = 256;
/** The BigInt DDA as src/render/ft.ts had it at 5635fd0: the points it passed to renderLine. */
function reference(p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number): number[] {
  const bx = p1x - p0x, by = p1y - p0y;
  const ax = p2x - p1x - bx, ay = p2y - p1y - by;
  let d = Math.max(Math.abs(ax), Math.abs(ay));
  if (d <= ONE_PIXEL / 4) return [];
  let shift = 16;
  do { d >>= 2; shift--; } while (d > ONE_PIXEL / 4);
  let count = 0x10000 >>> shift;
  const sh = BigInt(shift);
  let rx = BigInt(ax) << (sh + sh), ry = BigInt(ay) << (sh + sh);
  let qx = (BigInt(bx) << (sh + 17n)) + rx, qy = (BigInt(by) << (sh + 17n)) + ry;
  rx *= 2n; ry *= 2n;
  let px = BigInt(p0x) << 32n, py = BigInt(p0y) << 32n;
  const out: number[] = [];
  do {
    px += qx; py += qy; qx += rx; qy += ry;
    out.push(Number(px >> 32n), Number(py >> 32n));
  } while (--count);
  return out;
}

let seed = 0x2545f491;
const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
const FAR = (1 << 14) * 64 * 4;   // the glyph cache's canonical origin, 24.8
const N = Number(process.env['CONIC_N'] || 20_000);
type Gen = () => readonly [number, number, number, number, number, number];
const around = (o: number, size: number): Gen => () => {
  const x = o + int(-size, size), y = o + int(-size, size);
  return [x, y, x + int(-size, size), y + int(-size, size), x + int(-size, size), y + int(-size, size)];
};
const FAMILIES: readonly (readonly [string, Gen])[] = [
  ['glyph-sized at the far origin', around(FAR, 1 << 14)],
  ['glyph-sized near zero and negative', around(0, 1 << 14)],
  ['off-canvas, negative', around(-(1 << 22), 1 << 16)],
  ['huge glyphs', around(FAR, 1 << 24)],
  ['near the one-line threshold', () => { const x = int(-(1 << 23), 1 << 23), y = int(-(1 << 23), 1 << 23), k = int(60, 70); return [x, y, x + k, y - k, x + 2 * k + int(-6, 6), y + int(-6, 6)]; }],
  ['curvature near 2^31', () => { const x = int(-(1 << 29), 1 << 29), y = int(-(1 << 29), 1 << 29), k = int(1 << 28, (1 << 30) - 1); return [x, y, x + k, y + int(-k, k), x + int(-k, k), y - k]; }],
];
let cases = 0, points = 0;
for (const [name, gen] of FAMILIES) {
  for (let i = 0; i < N / FAMILIES.length; i++) {
    const [a, b, c, d, e, f] = gen();
    const want = reference(a, b, c, d, e, f), n = conicSteps(a, b, c, d, e, f);
    assert.equal(2 * n, want.length, `${name}: count for ${[a, b, c, d, e, f]}`);
    for (let k = 0; k < want.length; k++) if (CONIC_STEPS[k] !== want[k]) assert.fail(`${name}: point ${k >> 1} of ${[a, b, c, d, e, f]}: ${CONIC_STEPS[k]} vs ${want[k]}`);
    cases++; points += n;
  }
}
console.log(`conic DDA: ${cases} conics, ${points} points identical to the 64-bit reference`);
