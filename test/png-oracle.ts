// PNG oracle: rasterize every fixture with mpljs' own Agg/FreeType port and compare
// byte-for-byte with matplotlib's Agg PNG. Reports exact-pixel % and RMS (0..255).
//   node test/png-oracle.ts [name] [--strict]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { build, fixtureNames, loadFixture } from '../tools/replay.ts';
import { renderRGBA } from '../src/render/agg.ts';
import { canvasOf } from '../src/render/agg/canvas.ts';
import { encodePNGSync } from '../src/render/png.ts';
import { Tracer } from '../src/trace.ts';

const REF = new URL('../fixtures/ref/', import.meta.url).pathname;
const OUT = new URL('../fixtures/out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/** Minimal PNG reader for the 8-bit RGBA, non-interlaced files Agg writes (node:zlib is test-only). */
export type Pixels = { readonly w: number; readonly h: number; readonly px: Uint8Array };
export function readPNG(buf: Buffer): Pixels {
  let o = 8, w = 0, h = 0; const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error('need 8-bit RGBA non-interlaced'); }
    if (type === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * 4, px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? px[dst + i - 4] : 0, b = y > 0 ? px[dst - stride + i] : 0, c = i >= 4 && y > 0 ? px[dst - stride + i - 4] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      px[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  return { w, h, px };
}

export function compare(ref: Pixels, ours: Pixels) {
  let s = 0, n = 0, exact = 0, maxd = 0;
  for (let i = 0; i < ref.px.length; i += 4) {
    let same = true;
    for (let k = 0; k < 4; k++) {
      const d = ref.px[i + k] - ours.px[i + k];
      if (d !== 0) same = false;
      if (k < 3) { s += d * d; n++; }
      if (Math.abs(d) > maxd) maxd = Math.abs(d);
    }
    if (same) exact++;
  }
  return { rms: Math.sqrt(s / n), exact: exact / (ref.px.length / 4), diff: ref.px.length / 4 - exact, maxd };
}

function sideBySide(ref: Pixels, ours: Pixels) {
  const W = ref.w, H = ref.h, px = new Uint8Array(W * 3 * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, row = y * W * 3;
    for (let k = 0; k < 4; k++) { px[(row + x) * 4 + k] = ref.px[i + k]; px[(row + W + x) * 4 + k] = ours.px[i + k]; }
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(ref.px[i + k] - ours.px[i + k])));
    const o = (row + 2 * W + x) * 4, v = d === 0 ? 255 : Math.max(0, 200 - d * 8);
    px[o] = 255; px[o + 1] = v; px[o + 2] = v; px[o + 3] = 255;
  }
  return canvasOf(W * 3, H, 0, px);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2), strict = args.includes('--strict'), only = args.find((a) => !a.startsWith('--'));
  const names = only ? [only] : fixtureNames();
  const rows = [];
  for (const name of names) {
    const t0 = performance.now();
    const ours = renderRGBA(build(loadFixture(name)).toScene(), new Tracer());
    const ms = performance.now() - t0;
    const ref = readPNG(readFileSync(REF + name + '.png'));
    if (ref.w !== ours.w || ref.h !== ours.h) { rows.push({ name, rms: Infinity, exact: 0, diff: -1, maxd: 255, ms }); console.log(`SIZE ${name} ${ours.w}x${ours.h} vs ${ref.w}x${ref.h}`); continue; }
    const r = { name, ...compare(ref, ours), ms };
    rows.push(r);
    writeFileSync(OUT + name + '.agg.png', encodePNGSync(ours));
    if (r.diff > 0) writeFileSync(OUT + name + '.aggcmp.png', encodePNGSync(sideBySide(ref, ours)));
    console.log(`${r.diff === 0 ? 'EXACT' : 'DIFF '} ${name.padEnd(36)} exact ${(100 * r.exact).toFixed(3).padStart(7)}%  px≠ ${String(r.diff).padStart(5)}  rms ${r.rms.toFixed(3)}  max|Δ| ${String(r.maxd).padStart(3)}  ${ms.toFixed(0)}ms`);
  }
  const ex = rows.filter((r) => r.diff === 0).length;
  const mean = rows.reduce((s, r) => s + r.rms, 0) / rows.length;
  console.log(`\n${ex}/${rows.length} byte-identical; mean rms ${mean.toFixed(4)}; mean exact ${(100 * rows.reduce((s, r) => s + r.exact, 0) / rows.length).toFixed(4)}%`);
  if (strict && ex !== rows.length) process.exit(1);
}
