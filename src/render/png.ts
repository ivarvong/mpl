// PNG encoder for an RGBA8 canvas, no dependencies.
//   pngStream  — ReadableStream: signature + IHDR, then one IDAT per chunk that the
//                platform's CompressionStream('deflate') yields, then IEND. Rows are
//                filtered and fed in bands, so memory stays O(band) beyond the canvas.
//   encodePNG  — the stream, collected.
//   encodePNGSync — synchronous: our own deflate, tokenized from the canvas a pixel at a time
//                   where it can be, with dynamic Huffman blocks.
import type { Canvas } from './agg/canvas.ts';
import { BLOCK, BLOCK_SHIFT } from './agg/canvas.ts';

// ------------------------------------------------------------------ CRC-32, Adler-32
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(parts: readonly Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
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
export function pngStream(c: Canvas): ReadableStream<Uint8Array> {
  const z = new CompressionStream('deflate');
  const writer = z.writable.getWriter();
  void (async () => {
    // sequential on purpose: backpressure, one band in flight
    for (let y = 0; y < c.h; y += BAND) {
      // oxlint-disable-next-line no-await-in-loop
      await writer.ready;
      // oxlint-disable-next-line no-await-in-loop
      await writer.write(filteredBand(c, y, Math.min(y + BAND, c.h)));
    }
    await writer.close();
  })();
  const reader = z.readable.getReader();
  let state: 'head' | 'body' | 'done' = 'head';
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      switch (state) {
        case 'head': ctl.enqueue(header(c.w, c.h, c.dpi)); state = 'body'; return;
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

export async function encodePNG(c: Canvas): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const r = pngStream(c).getReader();
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

class Bits {
  buf = new Uint8Array(1 << 16); n = 0; acc = 0; cnt = 0;
  put(v: number, len: number): void {
    this.acc |= v << this.cnt; this.cnt += len;
    while (this.cnt >= 8) {
      if (this.n >= this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
      this.buf[this.n++] = this.acc & 255; this.acc >>>= 8; this.cnt -= 8;
    }
  }
  reserve(bytes: number): void {
    if (this.n + bytes <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.n + bytes)); b.set(this.buf.subarray(0, this.n)); this.buf = b;
  }
  flush(): Uint8Array { if (this.cnt > 0) this.put(0, 8 - this.cnt); return this.buf.subarray(0, this.n); }
}

/** Length-limited Huffman code lengths: plain Huffman, frequencies flattened until it fits. */
function codeLengths(freq: Uint32Array, limit: number): Uint8Array {
  const n = freq.length, out = new Uint8Array(n);
  const f = Float64Array.from(freq);
  for (;;) {
    const used: number[] = [];
    for (let i = 0; i < n; i++) if (f[i] > 0) used.push(i);
    out.fill(0);
    if (used.length === 0) return out;
    if (used.length === 1) { out[used[0]] = 1; return out; }
    // nodes: leaves 0..n-1, internal n..; a simple binary heap on (weight, id)
    const weight: number[] = [], parent: number[] = [];
    const heap: number[] = [];
    const less = (a: number, b: number): boolean => weight[a] < weight[b] || (weight[a] === weight[b] && a < b);
    const push = (x: number): void => { heap.push(x); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!less(heap[i], heap[p])) break; [heap[i], heap[p]] = [heap[p], heap[i]]; i = p; } };
    const pop = (): number => {
      const top = heap[0], last = heap[heap.length - 1];
      heap.length--;
      if (heap.length > 0) {
        heap[0] = last; let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && less(heap[l], heap[m])) m = l; if (r < heap.length && less(heap[r], heap[m])) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; }
      }
      return top;
    };
    for (const i of used) { weight[i] = f[i]; parent[i] = -1; push(i); }
    let next = n;
    while (heap.length > 1) { const a = pop(), b = pop(); weight[next] = weight[a] + weight[b]; parent[next] = -1; parent[a] = next; parent[b] = next; push(next); next++; }
    let max = 0;
    for (const i of used) { let d = 0; for (let p = i; parent[p] !== -1; p = parent[p]) d++; out[i] = d; if (d > max) max = d; }
    if (max <= limit) return out;
    for (const i of used) f[i] = Math.floor(f[i] / 2) + 1;
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

/** Tokens: literal v (< 256), or match: 256 + (len << 16 | dist). Stored as one Int32. */
function tokenize(d: Uint8Array, rowDist: number): { readonly tok: Int32Array; readonly n: number } {
  const WIN = 32768, HBITS = 15, HMASK = (1 << HBITS) - 1, CHAIN = 4;
  const head = new Int32Array(1 << HBITS).fill(-1), prev = new Int32Array(WIN);
  const tok = new Int32Array(d.length + 1);
  let n = 0;
  const len = d.length;
  const hash = (i: number): number => ((d[i] * 506832829 + d[i + 1] * 1103515245 + d[i + 2] * 12345) >>> 17) & HMASK;
  const insert = (i: number): void => { if (i + 2 < len) { const h = hash(i); prev[i & (WIN - 1)] = head[h]; head[h] = i; } };
  const matchLen = (i: number, j: number, max: number): number => { let l = 0; while (l < max && d[i + l] === d[j + l]) l++; return l; };
  let i = 0;
  while (i < len) {
    const max = Math.min(258, len - i);
    let best = 0, dist = 0;
    if (max >= 3) {
      if (i >= 4) { const l = matchLen(i, i - 4, max); if (l > best) { best = l; dist = 4; } }
      if (best < max && rowDist > 4 && i >= rowDist) { const l = matchLen(i, i - rowDist, max); if (l > best) { best = l; dist = rowDist; } }
      if (best < 16) {
        let j = head[hash(i)], chain = CHAIN;
        while (j >= 0 && i - j <= WIN && chain-- > 0) {
          if (d[j + best] === d[i + best]) { const l = matchLen(i, j, max); if (l > best) { best = l; dist = i - j; if (l === max) break; } }
          const pj = prev[j & (WIN - 1)];
          if (pj >= j) break;
          j = pj;
        }
      }
    }
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

/** One dynamic-Huffman block over tokens [a, b). */
function writeBlock(bw: Bits, tok: Int32Array, a: number, b: number, last: boolean): void {
  const lf = new Uint32Array(286), df = new Uint32Array(30);
  for (let k = a; k < b; k++) {
    const t = tok[k];
    if (t < 256) lf[t]++;
    else { const m = t - 256, l = m >>> 16, dd = m & 0xffff; lf[257 + LSYM[l]]++; df[distSym(dd)]++; }
  }
  lf[256] = 1;
  if (df.every((v) => v === 0)) df[0] = 1;
  const ll = codeLengths(lf, 15), dl = codeLengths(df, 15);
  let hlit = 286; while (hlit > 257 && ll[hlit - 1] === 0) hlit--;
  let hdist = 30; while (hdist > 1 && dl[hdist - 1] === 0) hdist--;
  // code-length alphabet with run-length codes 16 (repeat prev 3–6), 17 (zeros 3–10), 18 (zeros 11–138)
  const seq = [...ll.subarray(0, hlit), ...dl.subarray(0, hdist)];
  const cl: number[] = [], ce: number[] = [];
  for (let i = 0; i < seq.length;) {
    const v = seq[i];
    let r = 1; while (i + r < seq.length && seq[i + r] === v) r++;
    if (v === 0 && r >= 3) { const k = Math.min(r, 138); if (k >= 11) { cl.push(18); ce.push(k - 11); } else { cl.push(17); ce.push(k - 3); } i += k; continue; }
    if (v !== 0 && r >= 4) { cl.push(v); ce.push(0); const k = Math.min(r - 1, 6); cl.push(16); ce.push(k - 3); i += k + 1; continue; }
    cl.push(v); ce.push(0); i++;
  }
  const cf = new Uint32Array(19);
  for (const c of cl) cf[c]++;
  const cll = codeLengths(cf, 7), clc = canonical(cll);
  let hclen = 19; while (hclen > 4 && cll[CL_ORDER[hclen - 1]] === 0) hclen--;
  bw.put(last ? 1 : 0, 1); bw.put(2, 2);
  bw.put(hlit - 257, 5); bw.put(hdist - 1, 5); bw.put(hclen - 4, 4);
  for (let k = 0; k < hclen; k++) bw.put(cll[CL_ORDER[k]], 3);
  for (let k = 0; k < cl.length; k++) {
    bw.put(clc[cl[k]], cll[cl[k]]);
    if (cl[k] === 16) bw.put(ce[k], 2); else if (cl[k] === 17) bw.put(ce[k], 3); else if (cl[k] === 18) bw.put(ce[k], 7);
  }
  const lc = canonical(ll), dc = canonical(dl);
  // the token loop keeps the bit accumulator in locals; at most 48 bits (6 bytes) per token
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
  const bw = new Bits();
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
export function zlibSync(d: Uint8Array, rowDist = 0): Uint8Array {
  const { tok, n } = tokenize(d, rowDist);
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

type Tokens = { readonly tok: Int32Array; readonly n: number; readonly adler: number };

/** [start, end) pairs of pixels where a predicate holds, in x order, with a forward cursor. */
class Intervals {
  readonly e: Int32Array; n = 0; k = 0;
  constructor(w: number) { this.e = new Int32Array(w + 4); }
  /** Pixels from x on that satisfy the predicate (x never decreases between rows' resets). */
  from(x: number): number {
    const e = this.e;
    let k = this.k;
    while (k < this.n && e[k + 1] <= x) k += 2;
    this.k = k;
    return k < this.n && e[k] <= x ? e[k + 1] - x : 0;
  }
}

function tokenizeCanvas(c: Canvas): Tokens {
  const W = c.w, H = c.h, u = c.u32, px = c.px, RB = W * 4, S = RB + 1, nb = c.nb, blk = c.blk, mix = c.mix;
  const HBITS = 15, CHAIN = 4, RM = PIX_RING - 1;
  const head = new Int32Array(1 << HBITS).fill(-1), prev = new Int32Array(PIX_RING);
  let tok = new Int32Array(1 << 16);
  const L = new Intervals(W), U = new Intervals(W);
  const hash = (p: number): number => Math.imul(u[p], 0x9e3779b1) >>> (32 - HBITS);
  const insert = (p: number): void => { const h = hash(p); prev[p & RM] = head[h]; head[h] = p; };
  /** Common prefix of canvas bytes at a and b (same alignment mod 4), up to max. */
  const run = (a: number, b: number, max: number): number => {
    let l = 0;
    while (l < max && ((a + l) & 3) !== 0) { if (px[a + l] !== px[b + l]) return l; l++; }
    while (l + 4 <= max && u[(a + l) >> 2] === u[(b + l) >> 2]) l += 4;
    while (l < max && px[a + l] === px[b + l]) l++;
    return l;
  };
  /** Match length at byte pb (row offset xb) against d bytes back, using intervals iv for whole pixels. */
  const along = (iv: Intervals, pb: number, xb: number, d: number, max: number): number => {
    let l = 0;
    while (l < max && ((xb + l) & 3) !== 0) { if (px[pb + l] !== px[pb + l - d]) return l; l++; }
    if (l >= max) return l;
    const x = (xb + l) >> 2, np = iv.from(x);
    l += 4 * np;
    if (l >= max) return max;
    if (x + np >= W) return l;
    for (let t = 0; t < 3 && l < max && px[pb + l] === px[pb + l - d]; t++) l++;
    return l;
  };
  let a = 1, b = 0, n = 0, pending = 0;
  const upOk = S <= 32768;
  for (let y = 0; y < H; y++) {
    if (tok.length < n + S + 8) { const t = new Int32Array(Math.max(tok.length * 2, n + S + 8)); t.set(tok.subarray(0, n)); tok = t; }
    const row = y * W, rowB = row * 4, brow = y * nb;
    // ---- intervals: equal to the left, equal to above (inlined: this loop sees every block)
    {
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
    }
    // ---- Adler-32: the filter byte, then runs of identical pixels ([s − 1, e) per left interval)
    a %= ADLER; b = (b + a) % ADLER; pending = 0;
    for (let k = 0, x = 0; x < W;) {
      const s0 = k < L.n ? L.e[k] - 1 : W;
      const end = x < s0 ? s0 : L.e[k + 1];
      const len = x < s0 ? 1 : end - x;
      const q = (row + x) * 4, x0 = px[q], x1 = px[q + 1], x2 = px[q + 2], x3 = px[q + 3];
      const sum = x0 + x1 + x2 + x3, t = 4 * x0 + 3 * x1 + 2 * x2 + x3;
      if (len === 1) {
        // unreduced: after 1024 singles a < 1.1e6 and b < 4.6e9, far inside 2^53
        b += 4 * a + t; a += sum;
        if (++pending === 1024) { a %= ADLER; b %= ADLER; pending = 0; }
        x++;
      } else {
        b = (b + 4 * a * len + len * t + 2 * sum * len * (len - 1)) % ADLER;
        a = (a + len * sum) % ADLER;
        pending = 0; x = end; k += 2;
      }
    }
    // ---- tokens
    tok[n++] = 0;                                                     // filter byte: None
    let xb = 0;
    while (xb < RB) {
      const pb = rowB + xb, max = Math.min(258, RB - xb);
      let best = 0, dist = 0;
      if (max >= 3) {
        if (xb >= 4) { best = along(L, pb, xb, 4, max); dist = 4; }
        if (y > 0 && upOk && best < max) { const l = along(U, pb, xb, RB, max); if (l > best) { best = l; dist = S; } }
        if (best < 32 && (xb & 3) === 0) {
          const p = pb >> 2;
          let j = head[hash(p)], chain = CHAIN;
          while (j >= 0 && chain-- > 0 && p - j <= RM) {
            const qy = (j / W) | 0, qxb = (j - qy * W) * 4, bd = (y - qy) * S + xb - qxb;
            if (bd > 32768) break;                                    // the chain only gets farther
            const m = Math.min(max, RB - qxb);
            if (best < m && px[j * 4 + best] === px[pb + best]) { const l = run(pb, j * 4, m); if (l > best) { best = l; dist = bd; } }
            const pj = prev[j & RM];
            if (pj >= j) break;
            j = pj;
          }
        }
      }
      if (best >= 3) {
        tok[n++] = 256 + ((best << 16) | dist);
        // index the pixels the match covers: all of a short one, the last two of a long one
        const p0 = (rowB + ((xb + 3) & ~3)) >> 2, p1 = (pb + best) >> 2;
        for (let p = best <= 32 ? p0 : Math.max(p0, p1 - 2); p < p1; p++) insert(p);
        xb += best;
      } else {
        tok[n++] = px[pb];
        if ((xb & 3) === 0) insert(pb >> 2);
        xb++;
      }
    }
  }
  a %= ADLER; b %= ADLER;
  return { tok, n, adler: ((b << 16) | a) >>> 0 };
}

export function encodePNGSync(c: Canvas): Uint8Array {
  const { tok, n, adler } = tokenizeCanvas(c);
  return concat([header(c.w, c.h, c.dpi), chunk('IDAT', zlibFrom(tok, n, adler)), IEND]);
}
