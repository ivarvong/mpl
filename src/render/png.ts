// PNG encoder for an RGBA8 canvas, no dependencies.
//   pngStream  — ReadableStream: signature + IHDR, then one IDAT per chunk that the
//                platform's CompressionStream('deflate') yields, then IEND. Rows are
//                filtered and fed in bands, so memory stays O(band) beyond the canvas.
//                (Platform zlib — not byte-identical to encodePNGSync.)
//   encodePNG  — the stream, collected.
//   encodePNGSync — synchronous custom deflate. Peak beyond the RGBA canvas is a known
//                   constant: two TOK_BLOCK buffers + hash pools + ≤ one IDAT bit-writer
//                   payload + one outbound IDAT chunk (see pngPeakBytes). Multi-IDAT;
//                   pixels match the prior single-IDAT encoder; file bytes differ.
//   pngStreamSync — pull-based ReadableStream of the same bytes; encoder advances only on
//                   pull (real backpressure). Workers use this so encoded output never accumulates.

// Each takes a PngOptions: colors none writes 8-bit RGBA (color type 6); colors n writes a palette PNG (color type 3)
// of at most n entries, exact when the figure has that few colors (palette.ts), packed at the smallest bit depth.
import type { Canvas } from './agg/canvas.ts';
import { BLOCK, BLOCK_SHIFT } from './agg/canvas.ts';
import type { Indexed } from './palette.ts';
import { quantize } from './palette.ts';
import type { Option } from '../core/types.ts';
import { none, some } from '../core/types.ts';
import { tracer } from '../trace.ts';

/** colors: the palette budget (1..256), or none for full RGBA. */
export type PngOptions = { readonly colors: Option<number> };
/** encodePNGSync also takes the built-in deflate's level (1..9); none keeps the default chart-tuned encoder. */
export type PngSyncOptions = PngOptions & { readonly level: Option<number> };
export const RGBA: PngSyncOptions = { colors: none, level: none };

/**
 * How hard the built-in deflate searches, as zlib's configuration_table: greedy (deflate_fast) or lazy (deflate_slow)
 * matching; `chain` hash candidates at most, a quarter of them once the previous match reaches `good`; no chain search
 * once the left or upper match reaches `nice`, and the chain search stops at a `stop` match; lazy matching does not
 * look past a match of `maxLazy`. Levels 1..9 take zlib's values (nice = stop; the greedy levels keep this tokenizer's
 * insertion policy rather than max_insert_length). The default (no level) searches 4
 * candidates only below 16 and keeps the longest, which the chart-tuned encoders were measured with.
 * Measured on 23 fixtures against the default (RGBA / 64 colours): level 6 is 7.5% / 5.1% smaller at 3x / 1.2x the
 * time, level 9 9.5% / 8.2% at 12x / 5x, within about 1% of zlib -9.
 */
export type Effort = { readonly lazy: boolean; readonly chain: number; readonly good: number; readonly nice: number; readonly stop: number; readonly maxLazy: number };
const FAST: Effort = { lazy: false, chain: 4, good: 258, nice: 16, stop: 258, maxLazy: 258 };
const zl = (lazy: boolean, good: number, maxLazy: number, nice: number, chain: number): Effort => ({ lazy, chain, good, nice, stop: nice, maxLazy });
const LEVELS: readonly Effort[] = [FAST, zl(false, 4, 4, 8, 4), zl(false, 4, 5, 16, 8), zl(false, 4, 6, 32, 32),
  zl(true, 4, 4, 16, 16), zl(true, 8, 16, 32, 32), zl(true, 8, 16, 128, 128), zl(true, 8, 32, 128, 256), zl(true, 32, 128, 258, 1024), zl(true, 32, 258, 258, 4096)];
/** zlib's 1..9 scale; anything else is an error. */
export function effortOf(level: number): Effort {
  if (!Number.isInteger(level) || level < 1 || level > 9) throw new RangeError(`level must be an integer in 1..9, got ${level}`);
  return LEVELS[level];
}

// ------------------------------------------------------------------ CRC-32, Adler-32
// Slicing-by-4: CRC4[k·256 + v] is the CRC register after byte v followed by k zero bytes. Int32 entries keep
// the XORs in V8's int32 representation (the bits are the same as unsigned).
const CRC4 = new Int32Array(4 * 256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC4[n] = c;
}
for (let n = 0; n < 256; n++) for (let k = 1; k < 4; k++) CRC4[k * 256 + n] = CRC4[(CRC4[(k - 1) * 256 + n] & 0xff)] ^ (CRC4[(k - 1) * 256 + n] >>> 8);
function crc32(parts: readonly Uint8Array[]): number {
  let c = -1;
  for (const p of parts) {
    const n = p.length, n4 = n - (n & 3);
    let i = 0;
    for (; i < n4; i += 4) {
      c ^= p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24);
      c = CRC4[768 + (c & 0xff)] ^ CRC4[512 + ((c >>> 8) & 0xff)] ^ CRC4[256 + ((c >>> 16) & 0xff)] ^ CRC4[c >>> 24];
    }
    for (; i < n; i++) c = CRC4[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}
/**
 * Chunks of 2048 keep b < 2^31 (b ≤ 65520 + 2048·(65520 + 255·2048) ≈ 1.2e9), so the sums stay
 * in V8's int32 representation (`| 0`). Measured on 11 MB: 16.9 ms → 12.8 ms, same checksum.
 */
function adler32(a0: number, d: Uint8Array): number {
  let a = a0 & 0xffff, b = a0 >>> 16;
  for (let i = 0; i < d.length;) {
    const end = Math.min(i + 2048, d.length);
    for (; i < end; i++) { a = (a + d[i]) | 0; b = (b + a) | 0; }
    a %= 65521; b %= 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const u32 = (v: number): Uint8Array => new Uint8Array([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]);
const ascii = (s: string): Uint8Array => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const t = ascii(type);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0); out.set(t, 4); out.set(data, 8);
  out.set(u32(crc32([t, data])), 8 + data.length);
  return out;
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
/** pHYs: pixels per metre, so viewers and print pipelines know the physical size (matplotlib writes it too). */
function phys(dpi: number): Uint8Array {
  if (!(dpi > 0)) return new Uint8Array(0);
  const ppm = Math.round(dpi / 0.0254), d = new Uint8Array(9);
  d.set(u32(ppm), 0); d.set(u32(ppm), 4); d[8] = 1;
  return chunk('pHYs', d);
}
function header(w: number, h: number, dpi: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA, deflate, adaptive, no interlace
  return concat([SIGNATURE, chunk('IHDR', ihdr), phys(dpi)]);
}

// ------------------------------------------------------------------ palette (color type 3)
/** The smallest PNG bit depth that holds `size` indices. Measured on the fixtures (zlib 6): 4-bit is 13% smaller
 *  than 8-bit at 16 colors, 2-bit 28% at 4. */
const bitDepth = (size: number): number => (size <= 2 ? 1 : size <= 4 ? 2 : size <= 16 ? 4 : 8);
/** IHDR (color type 3), PLTE, tRNS when an entry is translucent (alphas up to the last one below 255), pHYs. */
function headerIndexed(w: number, h: number, dpi: number, ix: Indexed): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(w), 0); ihdr.set(u32(h), 4);
  ihdr[8] = bitDepth(ix.size); ihdr[9] = 3;
  const plte = new Uint8Array(3 * ix.size), alpha = new Uint8Array(ix.size);
  let lastTranslucent = -1;
  for (let i = 0; i < ix.size; i++) {
    plte[3 * i] = ix.palette[4 * i]; plte[3 * i + 1] = ix.palette[4 * i + 1]; plte[3 * i + 2] = ix.palette[4 * i + 2];
    alpha[i] = ix.palette[4 * i + 3];
    if (alpha[i] !== 255) lastTranslucent = i;
  }
  const trns = lastTranslucent >= 0 ? chunk('tRNS', alpha.subarray(0, lastTranslucent + 1)) : new Uint8Array(0);
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('PLTE', plte), trns, phys(dpi)]);
}
/** Rows [y0, y1) of packed indices (most significant bits first), each led by filter byte 0. None is also the best
 *  filter for indexed charts: Sub, Up, Paeth and adaptive were 3 to 22% larger on the fixtures. */
function indexedBand(ix: Indexed, w: number, y0: number, y1: number): Uint8Array<ArrayBuffer> {
  const bits = bitDepth(ix.size), per = 8 / bits, stride = Math.ceil(w / per), S = stride + 1;
  const out = new Uint8Array((y1 - y0) * S);
  for (let y = y0; y < y1; y++) {
    const src = y * w, dst = (y - y0) * S + 1;
    if (bits === 8) { out.set(ix.index.subarray(src, src + w), dst); continue; }
    for (let x = 0; x < w; x++) out[dst + Math.floor(x / per)] |= ix.index[src + x] << (8 - bits * (1 + (x % per)));
  }
  return out;
}
const indexedStride = (ix: Indexed, w: number): number => Math.ceil(w / (8 / bitDepth(ix.size))) + 1;
const IEND = chunk('IEND', new Uint8Array(0));

// ------------------------------------------------------------------ filtering
/**
 * Rows [y0, y1) with filter type 0 (None). Measured on the fixtures with zlib level 6:
 * None 181.8 KB < adaptive min-sum-abs 200.3 KB < Up 203.5 KB < Paeth 208.3 KB. Charts
 * are flat color with anti-aliased edges; prediction turns those edges into noise that
 * LZ77 can't match, and None also costs nothing to compute.
 */
export function filteredBand(c: Canvas, y0: number, y1: number): Uint8Array<ArrayBuffer> {
  const stride = c.w * 4;
  const out = new Uint8Array((y1 - y0) * (stride + 1));
  for (let y = y0; y < y1; y++) out.set(c.px.subarray(y * stride, (y + 1) * stride), (y - y0) * (stride + 1) + 1);
  return out;
}

// ------------------------------------------------------------------ streaming encoder
const BAND = 64;

/** PNG as a byte stream. Uses the platform's zlib (CompressionStream 'deflate' = RFC 1950). */
export function pngStream(c: Canvas, opts: PngOptions = RGBA): ReadableStream<Uint8Array> {
  const ix: Option<Indexed> = opts.colors.kind === 'some' ? { kind: 'some', value: quantize(c, opts.colors.value) } : none;
  const head = ix.kind === 'some' ? headerIndexed(c.w, c.h, c.dpi, ix.value) : header(c.w, c.h, c.dpi);
  const band = (y0: number, y1: number): Uint8Array<ArrayBuffer> => (ix.kind === 'some' ? indexedBand(ix.value, c.w, y0, y1) : filteredBand(c, y0, y1));
  const z = new CompressionStream('deflate');
  const writer = z.writable.getWriter();
  void (async () => {
    // sequential on purpose: backpressure, one band in flight
    for (let y = 0; y < c.h; y += BAND) {
      // oxlint-disable-next-line no-await-in-loop
      await writer.ready;
      // oxlint-disable-next-line no-await-in-loop
      await writer.write(band(y, Math.min(y + BAND, c.h)));
    }
    await writer.close();
  })();
  const reader = z.readable.getReader();
  let state: 'head' | 'body' | 'done' = 'head';
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      switch (state) {
        case 'head': ctl.enqueue(head); state = 'body'; return;
        case 'body': {
          const r = await reader.read();
          if (r.done) { ctl.enqueue(IEND); state = 'done'; ctl.close(); return; }
          if (r.value.length > 0) ctl.enqueue(chunk('IDAT', r.value));
          return;
        }
        case 'done': ctl.close(); return;
        default: throw new Error('unreachable');
      }
    },
  });
}

export async function encodePNG(c: Canvas, opts: PngOptions = RGBA): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = pngStream(c, opts).getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop
    const x = await r.read();
    if (x.done) break;
    parts.push(x.value);
  }
  return concat(parts);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ------------------------------------------------------------------ synchronous zlib
// A deflate tuned for chart images. Two observations drive it:
//   1. most bytes repeat the pixel to the left (distance 4) or the row above (distance
//      stride + 1, counting the filter byte), so those two candidates are tried first;
//   2. what remains (anti-aliased edges, glyphs) is short-range, so a 4-deep hash chain
//      is enough.
// Tokens are then coded per block with dynamic Huffman tables (RFC 1951 §3.2.7).
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const LSYM = new Uint8Array(259);
for (let s = 0; s < 29; s++) for (let l = LBASE[s]; l < (s < 28 ? LBASE[s + 1] : 259); l++) LSYM[l] = s;
const DSYM = new Uint8Array(32769);                   // distance → symbol, O(1)
for (let s = 0; s < 30; s++) DSYM.fill(s, DBASE[s], s < 29 ? DBASE[s + 1] : 32769);
const distSym = (d: number): number => DSYM[d];
const rev = (code: number, len: number): number => { let r = 0; for (let i = 0; i < len; i++) { r = (r << 1) | (code & 1); code >>= 1; } return r; };

/**
 * Max zlib bytes retained for one Huffman block before it is wrapped as an IDAT.
 * writeBlock reserves (nTok·6+8) bytes; that is the hard ceiling for one Huffman block.
 */
export const PNG_IDAT_PAYLOAD_MAX: number = (1 << 16) * 6 + 256;  // writeBlock reserve: TOK_BLOCK·6+8

/** Reused across encodes: fixed cap so the bit writer never holds more than one IDAT payload. */
const BITS_BUF = new Uint8Array(PNG_IDAT_PAYLOAD_MAX);
class Bits {
  buf = BITS_BUF; n = 0; acc = 0; cnt = 0;
  /** Instrumentation: high-water mark of complete bytes held (tests). */
  retainedHigh = 0;
  reset(): void { this.buf = BITS_BUF; this.n = 0; this.acc = 0; this.cnt = 0; this.retainedHigh = 0; }
  put(v: number, len: number): void {
    this.acc |= v << this.cnt; this.cnt += len;
    while (this.cnt >= 8) {
      if (this.n >= this.buf.length) throw new RangeError(`PNG bit writer exceeded PNG_IDAT_PAYLOAD_MAX (${PNG_IDAT_PAYLOAD_MAX})`);
      this.buf[this.n++] = this.acc & 255; this.acc >>>= 8; this.cnt -= 8;
    }
    if (this.n > this.retainedHigh) this.retainedHigh = this.n;
  }
  reserve(bytes: number): void {
    if (this.n + bytes > this.buf.length) throw new RangeError(`PNG bit writer reserve ${this.n + bytes} > PNG_IDAT_PAYLOAD_MAX`);
  }
  /** Copy out complete bytes and compact; bit accumulator unchanged. */
  takeBytes(): Uint8Array {
    const out = this.buf.slice(0, this.n);
    this.n = 0;
    return out;
  }
  flush(): Uint8Array {
    if (this.cnt > 0) this.put(0, 8 - this.cnt);
    return this.takeBytes();
  }
}
const BITS = new Bits();

/** Scratch for codeLengths: typed so unoptimized tiers do not box heap nodes. Sized for 286+285 internals. */
const CL_F = new Float64Array(286), CL_W = new Float64Array(600), CL_P = new Int32Array(600), CL_H = new Int32Array(600), CL_USED = new Int32Array(286);
const CL_OUT_A = new Uint8Array(286), CL_OUT_B = new Uint8Array(286), CL_OUT_CF = new Uint8Array(19);
let CL_FLIP = 0;
/** Length-limited Huffman code lengths: plain Huffman, frequencies flattened until it fits.
 *  Alternates A/B so writeBlock can keep ll and dl; pass `into` for a third concurrent result (cf). */
function codeLengths(freq: Uint32Array, limit: number, into: Option<Uint8Array>): Uint8Array {
  const n = freq.length;
  let out: Uint8Array;
  if (into.kind === 'some') out = into.value.subarray(0, n);
  else if (n <= 286) { CL_FLIP ^= 1; out = (CL_FLIP !== 0 ? CL_OUT_A : CL_OUT_B).subarray(0, n); }
  else out = new Uint8Array(n);
  const f = n <= CL_F.length ? CL_F.subarray(0, n) : new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = freq[i];
  const weight = CL_W, parent = CL_P, heap = CL_H, used = CL_USED;
  for (;;) {
    let nu = 0;
    for (let i = 0; i < n; i++) if (f[i] > 0) used[nu++] = i;
    out.fill(0);
    if (nu === 0) return out;
    if (nu === 1) { out[used[0]] = 1; return out; }
    let hs = 0;
    const less = (a: number, b: number): boolean => weight[a] < weight[b] || (weight[a] === weight[b] && a < b);
    const push = (x: number): void => {
      let i = hs++; heap[i] = x;
      while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; const t = heap[i]; heap[i] = heap[p]; heap[p] = t; i = p; }
    };
    const pop = (): number => {
      const top = heap[0], last = heap[--hs];
      if (hs > 0) {
        heap[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < hs && less(heap[l], heap[m])) m = l;
          if (r < hs && less(heap[r], heap[m])) m = r;
          if (m === i) break;
          const t = heap[i]; heap[i] = heap[m]; heap[m] = t; i = m;
        }
      }
      return top;
    };
    for (let k = 0; k < nu; k++) { const i = used[k]; weight[i] = f[i]; parent[i] = -1; push(i); }
    let next = n;
    // pop() decrements hs (closed over); oxlint cannot see that
    // oxlint-disable-next-line no-unmodified-loop-condition
    while (hs > 1) { const a = pop(), b = pop(); weight[next] = weight[a] + weight[b]; parent[next] = -1; parent[a] = next; parent[b] = next; push(next); next++; }
    let max = 0;
    for (let k = 0; k < nu; k++) {
      const i = used[k]; let d = 0;
      for (let p = i; parent[p] !== -1; p = parent[p]) d++;
      out[i] = d; if (d > max) max = d;
    }
    if (max <= limit) return out;
    for (let k = 0; k < nu; k++) { const i = used[k]; f[i] = Math.floor(f[i] / 2) + 1; }
  }
}

/** Canonical codes (bit-reversed for an LSB-first writer) from lengths. */
function canonical(lens: Uint8Array): Uint16Array {
  const count = new Uint16Array(16), next = new Uint16Array(16), codes = new Uint16Array(lens.length);
  for (const l of lens) count[l]++;
  count[0] = 0;
  let code = 0;
  for (let b = 1; b < 16; b++) { code = (code + count[b - 1]) << 1; next[b] = code; }
  for (let i = 0; i < lens.length; i++) if (lens[i] > 0) codes[i] = rev(next[lens[i]]++, lens[i]);
  return codes;
}

/**
 * Tokens: literal v (< 256), or match: 256 + (len << 16 | dist), stored as one Int32. At each byte the longest match
 * over the previous pixel (`left` bytes back: 4 for RGBA, 1 for palette indices), the row above and up to
 * `effort.chain` hash candidates. Greedy (zlib's deflate_fast) takes it and searches the chain only for a short one;
 * lazy (deflate_slow) emits it only if the next byte does not start a longer match, else a literal.
 */
function tokenize(d: Uint8Array, rowDist: number, left: number, effort: Effort): { readonly tok: Int32Array; readonly n: number } {
  const WIN = 32768, HBITS = 15, HMASK = (1 << HBITS) - 1;
  const head = new Int32Array(1 << HBITS).fill(-1), prev = new Int32Array(WIN);
  const tok = new Int32Array(d.length + 1);
  let n = 0;
  const len = d.length;
  const hash = (i: number): number => ((d[i] * 506832829 + d[i + 1] * 1103515245 + d[i + 2] * 12345) >>> 17) & HMASK;
  const insert = (i: number): void => { if (i + 2 < len) { const h = hash(i); prev[i & (WIN - 1)] = head[h]; head[h] = i; } };
  const matchLen = (i: number, j: number, max: number): number => { let l = 0; while (l < max && d[i + l] === d[j + l]) l++; return l; };
  let best = 0, dist = 0;
  const find = (i: number, prevLen: number): void => {
    const max = Math.min(258, len - i);
    best = 0; dist = 0;
    if (max < 3) return;
    if (i >= left) { const l = matchLen(i, i - left, max); if (l > best) { best = l; dist = left; } }
    if (best < max && rowDist > left && i >= rowDist) { const l = matchLen(i, i - rowDist, max); if (l > best) { best = l; dist = rowDist; } }
    if (best >= Math.min(max, effort.nice)) return;
    let j = head[hash(i)], chain = prevLen >= effort.good ? effort.chain >> 2 : effort.chain;
    while (j >= 0 && i - j <= WIN && chain-- > 0) {
      if (d[j + best] === d[i + best]) { const l = matchLen(i, j, max); if (l > best) { best = l; dist = i - j; if (l >= Math.min(max, effort.stop)) break; } }
      const pj = prev[j & (WIN - 1)];
      if (pj >= j) break;
      j = pj;
    }
  };
  let i = 0;
  if (!effort.lazy) {
    while (i < len) {
      find(i, 0);
      if (best >= 3) {
        tok[n++] = 256 + ((best << 16) | dist);
        insert(i);
        if (best <= 16) for (let k = 1; k < best; k++) insert(i + k);
        else { insert(i + best - 2); insert(i + best - 1); }
        i += best;
      } else {
        tok[n++] = d[i];
        insert(i);
        i++;
      }
    }
    return { tok, n };
  }
  let prevLen = 0, prevDist = 0, pending = false;
  while (i < len) {
    // past a match of maxLazy there is no look for a longer one (deflate_slow's max_lazy_match)
    if (pending && prevLen >= effort.maxLazy) { best = 0; dist = 0; } else find(i, pending ? prevLen : 0);
    if (pending && prevLen >= 3 && prevLen >= best) {
      // the match that started one byte back is at least as long: take it
      tok[n++] = 256 + ((prevLen << 16) | prevDist);
      const end = i - 1 + prevLen;
      for (let k = i; k < end; k++) insert(k);
      i = end; pending = false;
      continue;
    }
    if (pending) tok[n++] = d[i - 1];   // the byte before stays a literal: the match here may be longer
    insert(i);
    prevLen = best; prevDist = dist; pending = true;
    i++;
  }
  if (pending) tok[n++] = prevLen >= 3 ? 256 + ((prevLen << 16) | prevDist) : d[len - 1];
  return { tok, n };
}

const WB_LF = new Uint32Array(286), WB_DF = new Uint32Array(30), WB_CF = new Uint32Array(19);
const WB_SEQ = new Uint8Array(316), WB_CL = new Uint8Array(316), WB_CE = new Uint8Array(316);
/** One dynamic-Huffman block over tokens [a, b). */
function writeBlock(bw: Bits, tok: Int32Array, a: number, b: number, last: boolean): void {
  const lf = WB_LF, df = WB_DF;
  lf.fill(0); df.fill(0);
  for (let k = a; k < b; k++) {
    const t = tok[k];
    if (t < 256) lf[t]++;
    else { const m = t - 256, l = m >>> 16, dd = m & 0xffff; lf[257 + LSYM[l]]++; df[distSym(dd)]++; }
  }
  lf[256] = 1;
  let anyD = false; for (let i = 0; i < 30; i++) if (df[i] !== 0) { anyD = true; break; }
  if (!anyD) df[0] = 1;
  const ll = codeLengths(lf, 15, none), dl = codeLengths(df, 15, none);
  let hlit = 286; while (hlit > 257 && ll[hlit - 1] === 0) hlit--;
  let hdist = 30; while (hdist > 1 && dl[hdist - 1] === 0) hdist--;
  const seq = WB_SEQ, seqN = hlit + hdist;
  seq.set(ll.subarray(0, hlit), 0); seq.set(dl.subarray(0, hdist), hlit);
  const cl = WB_CL, ce = WB_CE; let cn = 0;
  for (let i = 0; i < seqN;) {
    const v = seq[i];
    let r = 1; while (i + r < seqN && seq[i + r] === v) r++;
    if (v === 0 && r >= 3) { const k = Math.min(r, 138); if (k >= 11) { cl[cn] = 18; ce[cn++] = k - 11; } else { cl[cn] = 17; ce[cn++] = k - 3; } i += k; continue; }
    if (v !== 0 && r >= 4) { cl[cn] = v; ce[cn++] = 0; const k = Math.min(r - 1, 6); cl[cn] = 16; ce[cn++] = k - 3; i += k + 1; continue; }
    cl[cn] = v; ce[cn++] = 0; i++;
  }
  const cf = WB_CF; cf.fill(0);
  for (let i = 0; i < cn; i++) cf[cl[i]]++;
  const cll = codeLengths(cf, 7, some(CL_OUT_CF)), clc = canonical(cll);
  let hclen = 19; while (hclen > 4 && cll[CL_ORDER[hclen - 1]] === 0) hclen--;
  bw.put(last ? 1 : 0, 1); bw.put(2, 2);
  bw.put(hlit - 257, 5); bw.put(hdist - 1, 5); bw.put(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) bw.put(cll[CL_ORDER[k]], 3);
  for (let k = 0; k < cn; k++) {
    bw.put(clc[cl[k]], cll[cl[k]]);
    if (cl[k] === 16) bw.put(ce[k], 2); else if (cl[k] === 17) bw.put(ce[k], 3); else if (cl[k] === 18) bw.put(ce[k], 7);
  }
  const lc = canonical(ll), dc = canonical(dl);
  bw.reserve((b - a) * 6 + 8);
  const buf = bw.buf;
  let acc = bw.acc, cnt = bw.cnt, o = bw.n;
  for (let k = a; k < b; k++) {
    const t = tok[k];
    if (t < 256) { acc |= lc[t] << cnt; cnt += ll[t]; }
    else {
      const m = t - 256, l = m >>> 16, dd = m & 0xffff, s = LSYM[l], ds = DSYM[dd];
      acc |= lc[257 + s] << cnt; cnt += ll[257 + s];
      if (LEXT[s] > 0) { acc |= (l - LBASE[s]) << cnt; cnt += LEXT[s]; }
      while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; }
      acc |= dc[ds] << cnt; cnt += dl[ds];
      if (DEXT[ds] > 0) { while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; } acc |= (dd - DBASE[ds]) << cnt; cnt += DEXT[ds]; }
    }
    while (cnt >= 8) { buf[o++] = acc & 255; acc >>>= 8; cnt -= 8; }
  }
  bw.acc = acc; bw.cnt = cnt; bw.n = o;
  bw.put(lc[256], ll[256]);
}

/** Token stream → zlib (RFC 1950): header, dynamic blocks of 2^16 tokens, Adler-32 trailer. */
function zlibFrom(tok: Int32Array, n: number, adler: number): Uint8Array {
  const bw = BITS; bw.reset();
  bw.put(0x78, 8); bw.put(0x9c, 8);
  const PER = 1 << 16;                                             // tokens per Huffman block
  if (n === 0) { bw.put(1, 1); bw.put(1, 2); bw.put(0, 7); }      // empty: one fixed block holding only end-of-block
  for (let a = 0; a < n; a += PER) writeBlock(bw, tok, a, Math.min(n, a + PER), a + PER >= n);
  const body = bw.flush();
  const out = new Uint8Array(body.length + 4);
  out.set(body, 0); out.set(u32(adler), body.length);
  return out;
}

/**
 * zlib stream (RFC 1950) of `d`. `rowDist` is the byte distance to the same byte one row up
 * (pass 0 for generic data).
 */
export function zlibSync(d: Uint8Array, rowDist = 0, left = 4, effort: Effort = FAST): Uint8Array {
  const { tok, n } = tokenize(d, rowDist, left, effort);
  return zlibFrom(tok, n, adler32(1, d));
}

// ------------------------------------------------------------------ PNG-aware LZ77
// The PNG byte stream is rows of [filter 0][w RGBA pixels]. The tokenizer reads the canvas
// directly (no filtered copy) and leans on its block state (see Canvas): per row it builds the
// intervals where a pixel equals its left neighbour and where it equals the pixel above, reading
// pixels only inside mixed blocks. A uniform block costs O(1). A match against the left pixel
// (stream distance 4) or the row above (4w + 1) is then a lookup in those intervals plus at most
// three bytes at either end, since the byte cursor may sit mid-pixel. Anything else (glyphs, marker
// stamps) goes to a 4-deep hash chain over pixels. Tokens are chosen per ≤ 258 bytes, as in zlib,
// so a tie between left (no extra distance bits) and above (12 extra bits) goes left. Matches stay
// within a row, so canvas and stream distances agree. Adler-32 is computed from the same
// intervals: a run of L identical pixels (bytes x0..x3, s = Σx, t = 4x0 + 3x1 + 2x2 + x3) adds
// L·s to a and 4aL + L·t + 2sL(L − 1) to b, so flat runs cost O(1) there too.

const PIX_RING = 1 << 14;   // ≥ 8192 px: the farthest pixel a 32 KiB byte window can reach
const ADLER = 65521;
/** v mod 65521 for an integer 0 ≤ v < 2^53, as v % ADLER. V8's `%` on a double (here past 2^31) is a call into
 *  fmod; the quotient's floor is exact here up to one off (the division rounds), and the fix-ups correct that.
 *  `| 0` (exact: the residue is < 65521) hands back a Smi, so unoptimized code does not box the result. */
const modA = (v: number): number => {
  const r = v - Math.floor(v / ADLER) * ADLER;
  return (r < 0 ? r + ADLER : r >= ADLER ? r - ADLER : r) | 0;
};
/** Singles between Adler reductions. From a, b < 65521, with sum ≤ 1020 and t ≤ 2550 per pixel, after 512 singles
 *  a < 0.59e6 and b < 6.7e8: both stay Smis (< 2^30), so unoptimized tiers never box them as HeapNumbers. */
const ADLER_SINGLES = 512;

/**
 * Tokens per dynamic-Huffman block — same as zlibFrom's PER. Two buffers of this size are retained
 * (active + one held-back full block) so BFINAL lands on the same block as the historical whole-buffer path.
 * Peak token scratch: `2 · TOK_BLOCK · 4` bytes, independent of w·h.
 */
export const TOK_BLOCK: number = 1 << 16;

/**
 * Module-pooled scratch retained across encodes (bytes). Independent of w·h.
 * Includes the bit writer cap (one IDAT zlib payload) and both token blocks.
 * Intervals L/U grow with width — counted in pngPeakBytes via pngIntervalsBytes(w).
 */
export const PNG_SYNC_FIXED_SCRATCH_BYTES: number =
  2 * TOK_BLOCK * 4 +           // TOK_A + TOK_B
  (1 << 15) * 4 +               // TOK_HEAD
  PIX_RING * 4 +                // TOK_PREV
  (1 << 15) * 4 +               // TOK_AGE
  2048 * 4 * 2 +                // Intervals L/U initial capacity
  PNG_IDAT_PAYLOAD_MAX +        // BITS_BUF — one in-flight zlib payload
  4 * 256 * 4 +                 // CRC4
  259 + 32769 +                 // LSYM + DSYM
  286 * 8 + 600 * 8 + 600 * 4 + 600 * 4 + 286 * 4 +  // CL_F/W/P/H/USED
  286 + 286 + 19 +              // CL_OUT_*
  286 * 4 + 30 * 4 + 19 * 4 +   // WB_LF/DF/CF
  316 * 3;                      // WB_SEQ/CL/CE

/** One enqueued IDAT chunk: length(4)+type(4)+payload+crc(4). Stream retains at most one. */
export const PNG_IDAT_CHUNK_MAX: number = 12 + PNG_IDAT_PAYLOAD_MAX;

/** Interval arrays L/U after ensure(w): 2 · (w+4) · 4 bytes. */
export const pngIntervalsBytes = (w: number): number => 2 * (w + 4) * 4;

/** Block-state bytes on a canvas of size w×h (Agg BLOCK=32). */
export const canvasBlockBytes = (w: number, h: number): number => {
  const nb = (w + 31) >> 5;
  return nb * h * 4 + nb * h;
};

/**
 * Exact peak arrayBuffers bound for the streaming RGBA encode path (bytes):
 *   4·w·h  +  canvasBlockBytes(w,h)  +  PNG_SYNC_FIXED_SCRATCH_BYTES
 *   +  max(0, pngIntervalsBytes(w) − 2·2048·4)  +  PNG_IDAT_CHUNK_MAX
 *
 * Full-frame RGBA is the one O(w·h) term (band rasterization rejected: AA identity /
 * ≥15% warm CPU — perf-out/stream2/band-verdict.md). Encoded output does not accumulate:
 * pull-based IDATs, retained ≤ one chunk. Sync encodePNGSync materializes the file for its
 * return value; Workers use pngStreamSync.
 *
 * Under mpl-web LIMITS.pixels (= MAX_FRAME_PIXELS), max width is MAX_FRAME_PIXELS (h=1), so
 * the O(w) intervals term is a known constant ≤ pngIntervalsBytes(MAX_FRAME_PIXELS).
 */
export const pngPeakBytes = (w: number, h: number): number => {
  const intervalsExtra = Math.max(0, pngIntervalsBytes(w) - 2 * 2048 * 4);
  return 4 * w * h + canvasBlockBytes(w, h) + PNG_SYNC_FIXED_SCRATCH_BYTES + intervalsExtra + PNG_IDAT_CHUNK_MAX;
};

/** Max 1× pixels (mpl-web LIMITS.pixels). */
export const MAX_FRAME_PIXELS: number = 4 * 1024 * 1024;

/** Known-constant peak at the widest legal 1× frame (w=MAX_FRAME_PIXELS, h=1). */
export const PNG_PEAK_MAX_1X_WIDE_BYTES: number = pngPeakBytes(MAX_FRAME_PIXELS, 1);

/** Known-constant peak at the square max-1× frame (2048×2048). */
export const PNG_PEAK_MAX_1X_SQUARE_BYTES: number = pngPeakBytes(2048, 2048);

/** [start, end) pairs of pixels where a predicate holds, in x order, with a forward cursor. */
class Intervals {
  e: Int32Array; n = 0; k = 0;
  constructor(cap: number) { this.e = new Int32Array(cap); }
  ensure(w: number): void { if (this.e.length < w + 4) this.e = new Int32Array(w + 4); }
  /** Pixels from x on that satisfy the predicate (x never decreases between rows' resets). */
  from(x: number): number {
    const e = this.e;
    let k = this.k;
    while (k < this.n && e[k + 1] <= x) k += 2;
    this.k = k;
    return k < this.n && e[k] <= x ? e[k + 1] - x : 0;
  }
}

const HBITS_TOK = 15, CHAIN = 4, RM = PIX_RING - 1;
/** Pooled across encodes so a cold isolate pays once. head slots are tagged with TOK_EPOCH so a
 *  fresh encode does not fill 128 KiB with −1; unread slots from a prior encode are ignored. */
const TOK_HEAD = new Int32Array(1 << HBITS_TOK), TOK_PREV = new Int32Array(PIX_RING);
const TOK_AGE = new Int32Array(1 << HBITS_TOK);
let TOK_EPOCH = 1;
const TOK_L = new Intervals(2048), TOK_U = new Intervals(2048);
/** Two fixed token blocks: `tok` is being filled; `held` is a full block waiting so BFINAL is correct. */
const TOK_A = new Int32Array(TOK_BLOCK), TOK_B = new Int32Array(TOK_BLOCK);

/** Common prefix of canvas bytes at a and b (same alignment mod 4), up to max. */
function runBytes(px: Uint8Array, u: Int32Array, a: number, b: number, max: number): number {
  let l = 0;
  while (l < max && ((a + l) & 3) !== 0) { if (px[a + l] !== px[b + l]) return l; l++; }
  while (l + 4 <= max && u[(a + l) >> 2] === u[(b + l) >> 2]) l += 4;
  while (l < max && px[a + l] === px[b + l]) l++;
  return l;
}
/** Match length at byte pb (row offset xb) against d bytes back, using intervals iv for whole pixels. */
function alongMatch(iv: Intervals, px: Uint8Array, W: number, pb: number, xb: number, d: number, max: number): number {
  let l = 0;
  while (l < max && ((xb + l) & 3) !== 0) { if (px[pb + l] !== px[pb + l - d]) return l; l++; }
  if (l >= max) return l;
  const x = (xb + l) >> 2, np = iv.from(x);
  l += 4 * np;
  if (l >= max) return max;
  if (x + np >= W) return l;
  for (let t = 0; t < 3 && l < max && px[pb + l] === px[pb + l - d]; t++) l++;
  return l;
}

/**
 * Canvas-aware LZ77 → dynamic-Huffman zlib as pull-driven IDAT payloads.
 * Each pull after the header yields at most one IDAT whose zlib payload is ≤ PNG_IDAT_PAYLOAD_MAX.
 * Token scratch stays 2·TOK_BLOCK; bit writer is compacted after every IDAT.
 */
type ZlibEnc = {
  pullIdat(): Option<Uint8Array>;  // none when finished (Adler already emitted in last payload)
  retainedHigh(): number;
};

function zlibEncoder(c: Canvas): ZlibEnc {
  const W = c.w, H = c.h, px = c.px, RB = W * 4, S = RB + 1, nb = c.nb, mix = c.mix;
  const u = c.i32, blk = c.blkI32;
  const head = TOK_HEAD, prev = TOK_PREV, age = TOK_AGE;
  let epoch = TOK_EPOCH + 1;
  if (epoch > 0x7fffffff) { age.fill(0); epoch = 1; }
  TOK_EPOCH = epoch;
  let tok = TOK_A, nTok = 0;
  const hold: { cur: Option<Int32Array> } = { cur: none };
  const L = TOK_L, U = TOK_U; L.ensure(W); U.ensure(W);
  const bw = BITS; bw.reset();
  bw.put(0x78, 8); bw.put(0x9c, 8);

  let y = 0, xb = 0, rowStarted = false;
  let a = 1, b = 0, pending = 0;
  let phase: 'rows' | 'flush' | 'adler' | 'done' = 'rows';
  let flushKind: 'hold' | 'tail' | 'empty' = 'hold';
  const upOk = S <= 32768;
  let high = 0;

  const emitFull = (buf: Int32Array, last: boolean): void => { writeBlock(bw, buf, 0, TOK_BLOCK, last); };
  const push = (v: number): boolean => {
    // returns true if a full held block was Huffman-coded (caller should takeBytes)
    tok[nTok++] = v;
    if (nTok === TOK_BLOCK) {
      if (hold.cur.kind === 'some') {
        emitFull(hold.cur.value, false);
        hold.cur = some(tok);
        tok = tok === TOK_A ? TOK_B : TOK_A;
        nTok = 0;
        return true;
      }
      hold.cur = some(tok);
      tok = tok === TOK_A ? TOK_B : TOK_A;
      nTok = 0;
    }
    return false;
  };

  const startRow = (): boolean => {
    const row = y * W, brow = y * nb;
    const le = L.e, ue = U.e;
    let ln = 0, lo = -1, un = 0, uo = -1, last = u[row];
    for (let j = 0; j < nb; j++) {
      const bs = j << BLOCK_SHIFT, be = Math.min(bs + BLOCK, W), bi = brow + j;
      if (mix[bi] === 0) {
        const col = blk[bi];
        if (bs > 0 && col === last) { if (lo < 0) lo = bs; }
        else { if (lo >= 0) { le[ln++] = lo; le[ln++] = bs; } lo = be - bs > 1 ? bs + 1 : -1; }
        last = col;
      } else {
        for (let x = bs; x < be; x++) {
          const v = u[row + x];
          if (x > 0 && v === last) { if (lo < 0) lo = x; }
          else if (lo >= 0) { le[ln++] = lo; le[ln++] = x; lo = -1; }
          last = v;
        }
      }
      if (y > 0) {
        if (mix[bi] === 0 && mix[bi - nb] === 0) {
          if (blk[bi] === blk[bi - nb]) { if (uo < 0) uo = bs; }
          else if (uo >= 0) { ue[un++] = uo; ue[un++] = bs; uo = -1; }
        } else {
          for (let x = bs; x < be; x++) {
            if (u[row + x] === u[row + x - W]) { if (uo < 0) uo = x; }
            else if (uo >= 0) { ue[un++] = uo; ue[un++] = x; uo = -1; }
          }
        }
      }
    }
    if (lo >= 0) { le[ln++] = lo; le[ln++] = W; }
    if (uo >= 0) { ue[un++] = uo; ue[un++] = W; }
    L.n = ln; L.k = 0; U.n = un; U.k = 0;
    a = modA(a); b = modA(b + a); pending = 0;
    for (let k = 0, x = 0; x < W;) {
      const s0 = k < L.n ? L.e[k] - 1 : W;
      const end = x < s0 ? s0 : L.e[k + 1];
      const len = x < s0 ? 1 : end - x;
      const q = (row + x) * 4, x0 = px[q], x1 = px[q + 1], x2 = px[q + 2], x3 = px[q + 3];
      const sum = x0 + x1 + x2 + x3, tsum = 4 * x0 + 3 * x1 + 2 * x2 + x3;
      if (len === 1) {
        b += 4 * a + tsum; a += sum;
        if (++pending === ADLER_SINGLES) { a = modA(a); b = modA(b); pending = 0; }
        x++;
      } else {
        b = modA(b + 4 * a * len + len * tsum + 2 * sum * len * (len - 1));
        a = modA(a + len * sum);
        pending = 0; x = end; k += 2;
      }
    }
    const coded = push(0);
    xb = 0;
    rowStarted = true;
    return coded;
  };

  const take = (): Uint8Array => {
    const out = bw.takeBytes();
    if (bw.retainedHigh > high) high = bw.retainedHigh;
    if (out.length > high) high = out.length;
    return out;
  };

  const pullIdat = (): Option<Uint8Array> => {
    for (;;) {
      if (phase === 'done') return none;
      if (phase === 'adler') {
        a = modA(a); b = modA(b);
        const adler = ((b << 16) | a) >>> 0;
        const tail = bw.flush();
        const out = new Uint8Array(tail.length + 4);
        out.set(tail, 0); out.set(u32(adler), tail.length);
        if (out.length > high) high = out.length;
        phase = 'done';
        return some(out);
      }
      if (phase === 'flush') {
        if (flushKind === 'hold' && hold.cur.kind === 'some' && nTok > 0) {
          emitFull(hold.cur.value, false); hold.cur = none;
          flushKind = 'tail';
          return some(take());
        }
        if (flushKind === 'hold' && hold.cur.kind === 'some') {
          emitFull(hold.cur.value, true); hold.cur = none;
          phase = 'adler';
          return some(take());
        }
        if (flushKind === 'tail' || nTok > 0) {
          writeBlock(bw, tok, 0, nTok, true); nTok = 0;
          phase = 'adler';
          return some(take());
        }
        bw.put(1, 1); bw.put(1, 2); bw.put(0, 7);
        phase = 'adler';
        return some(take());
      }
      // phase === 'rows'
      if (y >= H) {
        phase = 'flush';
        flushKind = hold.cur.kind === 'some' || nTok > 0 ? 'hold' : 'empty';
        continue;
      }
      if (!rowStarted) {
        if (startRow()) return some(take());
      }
      const row = y * W, rowB = row * 4;
      while (xb < RB) {
        const pb = rowB + xb, max = Math.min(258, RB - xb);
        let best = 0, dist = 0;
        if (max >= 3) {
          if (xb >= 4) { best = alongMatch(L, px, W, pb, xb, 4, max); dist = 4; }
          if (y > 0 && upOk && best < max) { const l = alongMatch(U, px, W, pb, xb, RB, max); if (l > best) { best = l; dist = S; } }
          if (best < 32 && (xb & 3) === 0) {
            const p = pb >> 2;
            const hh = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
            let j = age[hh] === epoch ? head[hh] : -1, chain = CHAIN;
            while (j >= 0 && chain-- > 0 && p - j <= RM) {
              const qy = (j / W) | 0, qxb = (j - qy * W) * 4, bd = (y - qy) * S + xb - qxb;
              if (bd > 32768) break;
              const mlen = Math.min(max, RB - qxb);
              if (best < mlen && px[j * 4 + best] === px[pb + best]) {
                const l = runBytes(px, u, pb, j * 4, mlen);
                if (l > best) { best = l; dist = bd; }
              }
              const pj = prev[j & RM];
              if (pj >= j) break;
              j = pj;
            }
          }
        }
        let coded = false;
        if (best >= 3) {
          if (dist === 4 && best === 258 && (xb & 3) === 0) {
            for (;;) {
              coded = push(256 + ((258 << 16) | 4)) || coded;
              const p1 = (rowB + xb + 258) >> 2;
              for (let p = p1 - 2; p < p1; p++) {
                const h = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
                prev[p & RM] = age[h] === epoch ? head[h] : -1; head[h] = p; age[h] = epoch;
              }
              xb += 258;
              if (xb + 258 > RB) break;
              const more = L.from(xb >> 2);
              if (more < 64) break;
              if (more < 65) break;
              if (coded) break;
            }
          } else {
            coded = push(256 + ((best << 16) | dist));
            const p0 = (rowB + ((xb + 3) & ~3)) >> 2, p1 = (pb + best) >> 2;
            for (let p = best <= 32 ? p0 : Math.max(p0, p1 - 2); p < p1; p++) {
              const h = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
              prev[p & RM] = age[h] === epoch ? head[h] : -1; head[h] = p; age[h] = epoch;
            }
            xb += best;
          }
        } else {
          coded = push(px[pb]);
          if ((xb & 3) === 0) {
            const p = pb >> 2, h = Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS_TOK);
            prev[p & RM] = age[h] === epoch ? head[h] : -1; head[h] = p; age[h] = epoch;
          }
          xb++;
        }
        if (coded) return some(take());
      }
      y++; rowStarted = false;
    }
  };

  return {
    retainedHigh: (): number => Math.max(high, bw.retainedHigh),
    pullIdat,
  };
}


export function encodePNGSync(c: Canvas, opts: PngSyncOptions = RGBA): Uint8Array {
  const effort = opts.level.kind === 'some' ? effortOf(opts.level.value) : FAST;
  if (opts.colors.kind === 'some') {
    const ix = quantize(c, opts.colors.value);
    return concat([headerIndexed(c.w, c.h, c.dpi, ix), chunk('IDAT', zlibSync(indexedBand(ix, c.w, 0, c.h), indexedStride(ix, c.w), 1, effort)), IEND]);
  }
  if (opts.level.kind === 'some') return concat([header(c.w, c.h, c.dpi), chunk('IDAT', zlibSync(filteredBand(c, 0, c.h), c.w * 4 + 1, 4, effort)), IEND]);
  return tracer.span('png.sync', { w: c.w, h: c.h }, (sp) => {
    // Multi-IDAT: one chunk per Huffman block; concat == pngStreamSync. Sync API still
    // materializes the full file; the Worker path uses pngStreamSync without retaining it.
    const parts: Uint8Array[] = [header(c.w, c.h, c.dpi)];
    const enc = zlibEncoder(c);
    let zBytes = 0, nIdat = 0;
    for (;;) {
      const p = tracer.span('png.idat', { i: nIdat }, (isp) => {
        const r = enc.pullIdat();
        if (r.kind === 'some') isp.setAttribute('zBytes', r.value.length).setAttribute('retained', enc.retainedHigh());
        return r;
      });
      if (p.kind === 'none') break;
      zBytes += p.value.length;
      nIdat++;
      parts.push(chunk('IDAT', p.value));
    }
    parts.push(IEND);
    const out = concat(parts);
    sp.setAttribute('zBytes', zBytes).setAttribute('bytes', out.length)
      .setAttribute('retained', enc.retainedHigh()).setAttribute('nIdat', nIdat);
    return out;
  });
}

/**
 * Pull-based PNG: signature+IHDR, then one IDAT per pull (≤ PNG_IDAT_PAYLOAD_MAX zlib bytes), then IEND.
 * Backpressure: the encoder only advances on pull. Retained encoded output ≤ one IDAT payload.
 */
export function pngStreamSync(c: Canvas, opts: PngSyncOptions = RGBA): ReadableStream<Uint8Array> {
  if (opts.colors.kind === 'some' || opts.level.kind === 'some') {
    const body = encodePNGSync(c, opts);
    return new ReadableStream({ start(ctl) { ctl.enqueue(body); ctl.close(); } });
  }
  let state: 'head' | 'body' | 'end' | 'done' = 'head';
  let enc: Option<ZlibEnc> = none;
  let nIdat = 0;
  return new ReadableStream({
    pull(ctl) {
      switch (state) {
        case 'head':
          return tracer.span('png.stream.head', { w: c.w, h: c.h }, () => {
            ctl.enqueue(header(c.w, c.h, c.dpi));
            enc = some(zlibEncoder(c));
            state = 'body';
          });
        case 'body': {
          return tracer.span('png.stream.idat', { i: nIdat }, (sp) => {
            if (enc.kind !== 'some') throw new Error('pngStreamSync: encoder missing');
            const z = enc.value;
            const p = z.pullIdat();
            if (p.kind === 'some') {
              sp.setAttribute('zBytes', p.value.length).setAttribute('retained', z.retainedHigh());
              nIdat++;
              ctl.enqueue(chunk('IDAT', p.value));
              return;
            }
            sp.setAttribute('nIdat', nIdat);
            ctl.enqueue(IEND);
            state = 'done';
            ctl.close();
          });
        }
        case 'end':
          ctl.enqueue(IEND);
          state = 'done';
          ctl.close();
          return;
        case 'done':
          ctl.close();
          return;
        default:
          throw new Error('unreachable');
      }
    },
  });
}
