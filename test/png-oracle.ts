// PNG oracle: rasterize every fixture with mpl's own Agg/FreeType port and compare
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
/** Decode a non-interlaced PNG: 8-bit RGBA (color type 6), or a palette (color type 3, bit depth 1/2/4/8, PLTE and
 *  optional tRNS), to RGBA pixels. Every filter type is undone, so this also checks what an encoder writes. */
export function readPNG(buf: Buffer): Pixels {
  let o = 8, w = 0, h = 0, type = 6, bits = 8; const idat: Buffer[] = [];
  let plte: Buffer = Buffer.alloc(0), trns: Buffer = Buffer.alloc(0);
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), kind = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + len);
    if (kind === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); bits = data[8]; type = data[9];
      const okType = (type === 6 && bits === 8) || (type === 3 && [1, 2, 4, 8].includes(bits));
      if (!okType || data[12] !== 0) throw new Error(`unsupported PNG: color type ${type}, bit depth ${bits}, interlace ${data[12]}`);
    }
    if (kind === 'PLTE') plte = data;
    if (kind === 'tRNS') trns = data;
    if (kind === 'IDAT') idat.push(data);
    o += 12 + len;
  }
  const bpp = type === 6 ? 4 : 1, stride = type === 6 ? w * 4 : Math.ceil((w * bits) / 8);
  const raw = inflateSync(Buffer.concat(idat)), rows = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? rows[dst + i - bpp] : 0, b = y > 0 ? rows[dst - stride + i] : 0, c = i >= bpp && y > 0 ? rows[dst - stride + i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      rows[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  if (type === 6) return { w, h, px: rows };
  const n = plte.length / 3, px = new Uint8Array(w * h * 4), per = 8 / bits, mask = (1 << bits) - 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = (rows[y * stride + Math.floor(x / per)] >> (8 - bits * (1 + (x % per)))) & mask;
      if (v >= n) throw new Error(`palette index ${v} out of range (${n} entries)`);
      const q = 4 * (y * w + x);
      px[q] = plte[3 * v]; px[q + 1] = plte[3 * v + 1]; px[q + 2] = plte[3 * v + 2]; px[q + 3] = v < trns.length ? trns[v] : 255;
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
