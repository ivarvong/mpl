// The compact, lossless encoding of baked font faces. Every table of a face is a flat list of
// integers written as base64 VLQ (the source-map alphabet: 5 bits per character, a continuation
// bit, sign in the lowest bit), delta-coded where neighbours are close. Decoding yields exactly
// the FaceData that scripts/gen_fonts.py baked: same numbers, same key order (test/fontcodec.test.ts
// pins each face's JSON hash). scripts/encode_fonts.ts is the inverse.
//
//   cmap      per entry, in baked order: Δcode point, gid
//   cover     per run: first − previous last, last − first
//   glyphs    per gid, ascending: Δgid, advance, xMin, xMax − xMin, yMin, yMax − yMin
//   outlines  per gid, ascending: Δgid, contours; per contour: points; per point: 3·Δx + tag, Δy
//             (Δ from the previous point of the glyph, across contours; tags are 0, 1, 2)
//   offsets   per gid, ascending: Δgid, contours; per contour: length, then the values
//   kern      per pair, in baked order: Δleft, right, value
import type { FaceData, SubTable } from './fonts.ts';

/** The faces mpljs ships. Families and weights are matplotlib's names for them. */
export const FACE_CATALOG = [
  { id: 'DejaVu Sans:400', family: 'DejaVu Sans', weight: 400, module: 'dejavu-sans', binding: 'dejavuSans' },
  { id: 'DejaVu Sans:700', family: 'DejaVu Sans', weight: 700, module: 'dejavu-sans-bold', binding: 'dejavuSansBold' },
  { id: 'DejaVu Serif:400', family: 'DejaVu Serif', weight: 400, module: 'dejavu-serif', binding: 'dejavuSerif' },
  { id: 'DejaVu Serif:700', family: 'DejaVu Serif', weight: 700, module: 'dejavu-serif-bold', binding: 'dejavuSerifBold' },
  { id: 'Inter:400', family: 'Inter', weight: 400, module: 'inter-regular', binding: 'interRegular' },
  { id: 'Inter:500', family: 'Inter', weight: 500, module: 'inter-medium', binding: 'interMedium' },
  { id: 'Inter:600', family: 'Inter', weight: 600, module: 'inter-semibold', binding: 'interSemibold' },
  { id: 'Inter:700', family: 'Inter', weight: 700, module: 'inter-bold', binding: 'interBold' },
] as const;
export type CatalogEntry = (typeof FACE_CATALOG)[number];
/** "Family:weight" of a shipped face. */
export type FaceId = CatalogEntry['id'];

/** One face as its module (mpljs/fonts/<name>) exports it: metadata plus encoded tables. */
export type BakedFace = {
  readonly id: FaceId;
  readonly upm: number;
  readonly typo: readonly [number, number, number];
  readonly cmap: string; readonly cover: string; readonly glyphs: string;
  readonly outlines: string; readonly offsets: string; readonly kern: string;
  readonly gsub: { readonly order: readonly number[]; readonly lookups: Readonly<Record<string, { readonly flag: number; readonly subs: readonly SubTable[] }>>; readonly gclass: Readonly<Record<string, number>> };
};

export const VLQ_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) DIGIT[VLQ_ALPHABET.charCodeAt(i)] = i;

/** base64 VLQ → integers. */
export function decodeVlq(s: string): Int32Array {
  const out = new Int32Array(s.length);
  let n = 0, v = 0, shift = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i), d = c < 128 ? DIGIT[c] : -1;
    if (d < 0) throw new Error(`font data: bad VLQ character ${JSON.stringify(s[i])} at ${i}`);
    v += (d & 31) * 2 ** shift;
    if ((d & 32) !== 0) { shift += 5; continue; }
    out[n++] = v % 2 === 1 ? -(v - 1) / 2 : v / 2;
    v = 0; shift = 0;
  }
  if (shift !== 0) throw new Error('font data: truncated VLQ');
  return out.subarray(0, n);
}

/** A cursor over a decoded table. */
class Ints {
  private i = 0;
  private readonly a: Int32Array;
  constructor(a: Int32Array) { this.a = a; }
  get done(): boolean { return this.i >= this.a.length; }
  next(): number {
    if (this.i >= this.a.length) throw new Error('font data: table ends early');
    return this.a[this.i++];
  }
}

/** The baked FaceData of an encoded face, exactly as it was baked. */
export function decodeFace(b: BakedFace, entry: CatalogEntry): FaceData {
  const cmap: Record<string, number> = {};
  for (let r = new Ints(decodeVlq(b.cmap)), cp = 0; !r.done;) { cp += r.next(); cmap[String.fromCodePoint(cp)] = r.next(); }

  const cover: (readonly [number, number])[] = [];
  for (let r = new Ints(decodeVlq(b.cover)), last = 0; !r.done;) { const first = last + r.next(); last = first + r.next(); cover.push([first, last]); }

  const glyphs: Record<string, readonly [number, number, number, number, number]> = {};
  for (let r = new Ints(decodeVlq(b.glyphs)), g = 0; !r.done;) {
    g += r.next();
    const adv = r.next(), x0 = r.next(), x1 = x0 + r.next(), y0 = r.next(), y1 = y0 + r.next();
    glyphs[g] = [adv, x0, x1, y0, y1];
  }

  const outlines: Record<string, readonly (readonly number[])[]> = {};
  for (let r = new Ints(decodeVlq(b.outlines)), g = 0; !r.done;) {
    g += r.next();
    const contours: number[][] = [];
    let x = 0, y = 0;
    for (let c = r.next(); c > 0; c--) {
      const pts: number[] = [];
      for (let p = r.next(); p > 0; p--) {
        const v = r.next(), tag = ((v % 3) + 3) % 3;
        x += (v - tag) / 3; y += r.next();
        pts.push(x, y, tag);
      }
      contours.push(pts);
    }
    outlines[g] = contours;
  }

  const offsets: Record<string, readonly (readonly number[])[]> = {};
  for (let r = new Ints(decodeVlq(b.offsets)), g = 0; !r.done;) {
    g += r.next();
    const contours: number[][] = [];
    for (let c = r.next(); c > 0; c--) { const vals: number[] = []; for (let k = r.next(); k > 0; k--) vals.push(r.next()); contours.push(vals); }
    offsets[g] = contours;
  }

  const kern: Record<string, number> = {};
  for (let r = new Ints(decodeVlq(b.kern)), left = 0; !r.done;) { left += r.next(); const right = r.next(); kern[`${left},${right}`] = r.next(); }

  return { family: entry.family, weight: entry.weight, upm: b.upm, typo: b.typo, cmap, cover, glyphs, outlines, offsets, kern, gsub: b.gsub };
}
