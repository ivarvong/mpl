// Font faces and text shaping, as matplotlib 3.11 does it through FreeType 2.14 + HarfBuzz (libraqm),
// unhinted. Faces are baked by tools/gen_fonts.py; everything here is integer-exact against
// FT2Font._layout for the supported character set:
//   - char size: FT_Set_Char_Size(pt·64, dpi) → 16.16 x_scale = FT_DivFix(ppem26, upem)
//   - advances: FT_MulFix(hAdvance, x_scale), in 26.6
//   - kerning: HarfBuzz em_mult on the hb-ft font scale, in 26.6
//   - substitutions: the GSUB lookups behind ccmp/locl/rlig/calt/clig/liga for Latin text
import { DEJAVU_SANS } from './data/fonts/dejavu-sans.ts';
import { DEJAVU_SANS_BOLD } from './data/fonts/dejavu-sans-bold.ts';
import { DEJAVU_SERIF } from './data/fonts/dejavu-serif.ts';
import { DEJAVU_SERIF_BOLD } from './data/fonts/dejavu-serif-bold.ts';
import { INTER_REGULAR } from './data/fonts/inter-regular.ts';
import { INTER_MEDIUM } from './data/fonts/inter-medium.ts';
import { INTER_SEMIBOLD } from './data/fonts/inter-semibold.ts';
import { INTER_BOLD } from './data/fonts/inter-bold.ts';
import { lookup } from './std.ts';
import { assertNever } from './types.ts';

const getOr = <K, V>(m: ReadonlyMap<K, V>, k: K, d: V): V => { const o = lookup(m, k); return o.kind === 'some' ? o.value : d; };

// ------------------------------------------------------------------ baked data shapes
type Recs = readonly (readonly [number, number])[];
export type SubTable =
  | { readonly t: 1; readonly map: readonly (readonly [number, number])[] }
  | { readonly t: 4; readonly ligs: readonly (readonly number[])[] }
  | { readonly t: 5; readonly f: 3; readonly inp: readonly (readonly number[])[]; readonly recs: Recs }
  | { readonly t: 6; readonly f: 1; readonly rules: readonly { readonly g: number; readonly bt: readonly number[]; readonly inp: readonly number[]; readonly la: readonly number[]; readonly recs: Recs }[] }
  | { readonly t: 6; readonly f: 2; readonly cov: readonly number[]; readonly bcd: Readonly<Record<string, number>>; readonly icd: Readonly<Record<string, number>>;
      readonly lcd: Readonly<Record<string, number>>; readonly rules: readonly { readonly c: number; readonly bt: readonly number[]; readonly inp: readonly number[]; readonly la: readonly number[]; readonly recs: Recs }[] }
  | { readonly t: 6; readonly f: 3; readonly bt: readonly (readonly number[])[]; readonly inp: readonly (readonly number[])[]; readonly la: readonly (readonly number[])[]; readonly recs: Recs };
export type FaceData = {
  readonly family: string; readonly weight: number; readonly upm: number;
  /** OS/2 sTypoAscender, −sTypoDescender, sTypoLineGap (else hhea), font units */
  readonly typo: readonly [number, number, number];
  readonly cmap: Readonly<Record<string, number>>;
  /** gid → [advance, xMin, xMax, yMin, yMax], font units, control-point box */
  readonly glyphs: Readonly<Record<string, readonly [number, number, number, number, number]>>;
  /** gid → contours, flat [x, y, tag] with FreeType tags (1 on, 0 conic, 2 cubic) */
  readonly outlines: Readonly<Record<string, readonly (readonly number[])[]>>;
  readonly kern: Readonly<Record<string, number>>;
  readonly gsub: { readonly order: readonly number[]; readonly lookups: Readonly<Record<string, { readonly flag: number; readonly subs: readonly SubTable[] }>>; readonly gclass: Readonly<Record<string, number>> };
};

// ------------------------------------------------------------------ compiled GSUB
// The baked subtables are lists (what the font stores); shaping wants membership tests. Each face
// compiles them once at load into Sets and Maps, and each lookup gets the set of glyphs it can
// start on, so the common case (this lookup does nothing to this glyph) is one Set probe.
type GSet = ReadonlySet<number>;
type CRule = { readonly bt: readonly number[]; readonly inp: readonly number[]; readonly la: readonly number[]; readonly recs: Recs };
type CSub =
  | { readonly t: 1; readonly map: ReadonlyMap<number, number> }
  | { readonly t: 4; readonly ligs: ReadonlyMap<number, readonly (readonly number[])[]> }
  | { readonly t: 5; readonly inp: readonly GSet[]; readonly recs: Recs }
  | { readonly t: 61; readonly rules: ReadonlyMap<number, readonly CRule[]> }
  | { readonly t: 62; readonly cov: GSet; readonly bcd: ReadonlyMap<number, number>; readonly icd: ReadonlyMap<number, number>;
      readonly lcd: ReadonlyMap<number, number>; readonly rules: ReadonlyMap<number, readonly CRule[]> }
  | { readonly t: 63; readonly bt: readonly GSet[]; readonly inp: readonly GSet[]; readonly la: readonly GSet[]; readonly recs: Recs };
type Lookup = { readonly flag: number; readonly subs: readonly CSub[]; readonly first: GSet };

const numMap = (o: Readonly<Record<string, number>>): ReadonlyMap<number, number> => new Map(Object.entries(o).map(([k, v]) => [Number(k), v] as const));
function groupBy<T>(xs: readonly T[], key: (x: T) => number): ReadonlyMap<number, readonly T[]> {
  const m = new Map<number, T[]>();
  for (const x of xs) { const k = key(x); const o = lookup(m, k); if (o.kind === 'some') o.value.push(x); else m.set(k, [x]); }
  return m;
}
/** One subtable compiled, plus the glyphs it can start on (for 6.2, its coverage). */
function compileSub(st: SubTable): { readonly sub: CSub; readonly first: readonly number[] } {
  switch (st.t) {
    case 1: return { sub: { t: 1, map: new Map(st.map.map(([a, b]) => [a, b] as const)) }, first: st.map.map((p) => p[0]) };
    case 4: return { sub: { t: 4, ligs: groupBy(st.ligs, (l) => l[0]) }, first: st.ligs.map((l) => l[0]) };
    case 5: return { sub: { t: 5, inp: st.inp.map((c) => new Set(c)), recs: st.recs }, first: st.inp.length > 0 ? st.inp[0] : [] };
    case 6:
      switch (st.f) {
        case 1: return { sub: { t: 61, rules: groupBy(st.rules.map((r) => ({ g: r.g, bt: r.bt, inp: r.inp, la: r.la, recs: r.recs })), (r) => r.g) }, first: st.rules.map((r) => r.g) };
        case 2: return { sub: { t: 62, cov: new Set(st.cov), bcd: numMap(st.bcd), icd: numMap(st.icd), lcd: numMap(st.lcd), rules: groupBy(st.rules, (r) => r.c) }, first: st.cov };
        case 3: return { sub: { t: 63, bt: st.bt.map((c) => new Set(c)), inp: st.inp.map((c) => new Set(c)), la: st.la.map((c) => new Set(c)), recs: st.recs }, first: st.inp.length > 0 ? st.inp[0] : [] };
        default: return assertNever(st);
      }
    default: return assertNever(st);
  }
}
function compileLookup(l: { readonly flag: number; readonly subs: readonly SubTable[] }): Lookup {
  const cs = l.subs.map(compileSub);
  return { flag: l.flag, subs: cs.map((c) => c.sub), first: new Set(cs.flatMap((c) => c.first)) };
}

/** A loaded face: baked data plus lookup structures. `id` is "Family:weight". */
export type Face = {
  readonly id: string; readonly family: string; readonly weight: number; readonly upm: number;
  readonly cmap: ReadonlyMap<string, number>;
  readonly glyphs: ReadonlyMap<number, readonly [number, number, number, number, number]>;
  readonly outlines: ReadonlyMap<number, readonly (readonly number[])[]>;
  readonly kern: ReadonlyMap<number, number>;            // key: left * 65536 + right
  readonly lookups: ReadonlyMap<number, Lookup>;
  /** GDEF glyph class (1 base, 2 ligature, 3 mark) */
  readonly gclass: ReadonlyMap<number, number>;
  readonly data: FaceData;
  /** Text._get_layout's minimum ascent and descent, font units */
  readonly minAscent: number; readonly minDescent: number;
};

function load(d: FaceData): Face {
  const glyphs = new Map(Object.entries(d.glyphs).map(([k, v]) => [Number(k), v] as const));
  const cmap = new Map(Object.entries(d.cmap));
  return {
    id: `${d.family}:${d.weight}`, family: d.family, weight: d.weight, upm: d.upm, cmap, glyphs,
    outlines: new Map(Object.entries(d.outlines).map(([k, v]) => [Number(k), v] as const)),
    kern: new Map(Object.entries(d.kern).map(([k, v]) => { const [a, b] = k.split(','); return [Number(a) * 65536 + Number(b), v] as const; })),
    lookups: new Map(Object.entries(d.gsub.lookups).map(([k, v]) => [Number(k), compileLookup(v)] as const)),
    gclass: numMap(d.gsub.gclass),
    data: d, minAscent: d.typo[0], minDescent: d.typo[1],
  };
}

/** When each face was built at module load (performance.now() ms). Faces load before any caller
 *  can enable a tracer, so they record plain timestamps and a startup trace turns them into spans. */
export type FaceLoad = { readonly id: string; readonly startMs: number; readonly endMs: number; readonly glyphs: number };
const faceLoads: FaceLoad[] = [];
const timedLoad = (d: FaceData): Face => {
  const t = performance.now(), f = load(d);
  faceLoads.push({ id: f.id, startMs: t, endMs: performance.now(), glyphs: f.glyphs.size });
  return f;
};
export const FACES: readonly Face[] = [DEJAVU_SANS, DEJAVU_SANS_BOLD, DEJAVU_SERIF, DEJAVU_SERIF_BOLD, INTER_REGULAR, INTER_MEDIUM, INTER_SEMIBOLD, INTER_BOLD].map(timedLoad);
export const FACE_LOADS: readonly FaceLoad[] = faceLoads;
export const DEFAULT_FACE: Face = FACES[0];

/** matplotlib's named weights. */
const WEIGHTS: ReadonlyMap<string, number> = new Map([
  ['ultralight', 100], ['light', 200], ['normal', 400], ['regular', 400], ['book', 400], ['roman', 400], ['medium', 500],
  ['semibold', 600], ['demibold', 600], ['demi', 600], ['bold', 700], ['heavy', 800], ['extra bold', 800], ['black', 800],
]);
/** matplotlib's weights: a number, or a named weight (unknown names read as normal). */
export const parseWeight = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? getOr(WEIGHTS, v, 400) : 400);

/** font_manager.findfont, reduced: first family in the list that we have, then the nearest weight. */
export function resolveFace(families: readonly string[], weight: number): Face {
  for (const fam of families) {
    // matplotlib's generic families resolve through font.sans-serif / font.serif, whose first entries we ship
    const name = fam === 'sans-serif' ? 'DejaVu Sans' : fam === 'serif' ? 'DejaVu Serif' : fam;
    const cands = FACES.filter((f) => f.family.toLowerCase() === name.toLowerCase());
    if (cands.length > 0) return cands.reduce((a, b) => (Math.abs(b.weight - weight) < Math.abs(a.weight - weight) ? b : a));
  }
  return weight >= 600 ? FACES[1] : DEFAULT_FACE;
}
export const faceById = (id: string): Face => { const i = FACES.findIndex((f) => f.id === id); return i >= 0 ? FACES[i] : DEFAULT_FACE; };

// ------------------------------------------------------------------ FreeType fixed point
export function mulFix(a: number, b: number): number {
  let s = 1;
  if (a < 0) { a = -a; s = -s; }
  if (b < 0) { b = -b; s = -s; }
  const c = Math.floor((a * b + 0x8000) / 65536);
  return s > 0 ? c : -c;
}
export function divFix(a: number, b: number): number {
  let s = 1;
  if (a < 0) { a = -a; s = -s; }
  if (b < 0) { b = -b; s = -s; }
  const q = b > 0 ? Math.floor((a * 65536 + Math.floor(b / 2)) / b) : 0x7fffffff;
  return s > 0 ? q : -q;
}
export const mulDiv = (a: number, b: number, c: number): number => {
  const s = (a < 0 ? -1 : 1) * (b < 0 ? -1 : 1);
  return s * Math.floor((Math.abs(a) * Math.abs(b) + Math.floor(c / 2)) / c);
};
/** FT_Set_Char_Size(face, (FT_F26Dot6)(pt·64), 0, dpi, dpi) → 16.16 scale. */
export function ftScale(face: Face, sizePt: number, dpi: number): number {
  const ppem26 = Math.trunc((Math.trunc(sizePt * 64) * Math.trunc(dpi) + 36) / 72);
  return divFix(ppem26, face.upm);
}
/** hb-ft's font scale and HarfBuzz em_mult: (v · ((xs << 16) / upem) + 32768) >> 16. */
function hbKern(face: Face, v: number, scale: number): number {
  const xs = Math.floor((scale * face.upm + 32768) / 65536);
  const mult = Math.floor(xs * 65536 / face.upm);
  return Math.floor((v * mult + 32768) / 65536);
}

// ------------------------------------------------------------------ GSUB
const LOOKUP_IGNORE_MARKS = 8, LOOKUP_IGNORE_BASE = 2, LOOKUP_IGNORE_LIGS = 4;

function ignorable(face: Face, flag: number, g: number): boolean {
  if (flag === 0) return false;
  const c = getOr(face.gclass, g, 0);
  return ((flag & LOOKUP_IGNORE_MARKS) !== 0 && c === 3) || ((flag & LOOKUP_IGNORE_BASE) !== 0 && c === 1) || ((flag & LOOKUP_IGNORE_LIGS) !== 0 && c === 2);
}

/** Next non-ignorable index after i (or before, with dir −1); −1 if none. */
function step(face: Face, flag: number, buf: readonly number[], i: number, dir: 1 | -1): number {
  for (let j = i + dir; j >= 0 && j < buf.length; j += dir) if (!ignorable(face, flag, buf[j])) return j;
  return -1;
}

type Matcher = (g: number, k: number) => boolean;
/** Match a sequence starting at (or around) i; returns the matched buffer indices or empty. */
function matchSeq(face: Face, flag: number, buf: readonly number[], start: number, n: number, m: Matcher, dir: 1 | -1, first: boolean): number[] {
  const out: number[] = [];
  let j = first ? start : step(face, flag, buf, start, dir);
  for (let k = 0; k < n; k++) {
    if (j < 0 || !m(buf[j], k)) return [];
    out.push(j);
    if (k < n - 1) j = step(face, flag, buf, j, dir);
  }
  return out;
}

function applyLookup(face: Face, li: number, buf: number[], i: number): number {
  const found = lookup(face.lookups, li);
  if (found.kind === 'none') return -1;                  // a lookup outside the baked closure
  const L = found.value;
  if (!L.first.has(buf[i]) || ignorable(face, L.flag, buf[i])) return -1;
  for (const st of L.subs) {
    const r = applySub(face, L.flag, st, buf, i);
    if (r >= 0) return r;
  }
  return -1;
}

const inSets = (sets: readonly GSet[]): Matcher => (x, k) => sets[k].has(x);

/** Apply one subtable at i. Returns the index to continue from, or −1 if it didn't apply. */
function applySub(face: Face, flag: number, st: CSub, buf: number[], i: number): number {
  const g = buf[i];
  switch (st.t) {
    case 1: { const o = lookup(st.map, g); if (o.kind === 'none') return -1; buf[i] = o.value; return i + 1; }
    case 4: {
      for (const lig of getOr(st.ligs, g, [])) {
        const comps = lig.slice(1, -1);
        const idx = matchSeq(face, flag, buf, i, comps.length, (x, k) => x === comps[k], 1, false);
        if (comps.length > 0 && idx.length === 0) continue;
        for (const j of idx.toReversed()) buf.splice(j, 1);
        buf[i] = lig[lig.length - 1];
        return i + 1;
      }
      return -1;
    }
    case 5: {
      const inp = matchSeq(face, flag, buf, i, st.inp.length, inSets(st.inp), 1, true);
      if (inp.length === 0) return -1;
      return context(face, buf, inp, st.recs);
    }
    case 61: {
      for (const r of getOr(st.rules, g, [])) {
        const inp = matchSeq(face, flag, buf, i, r.inp.length + 1, (x, k) => (k === 0 ? x === g : x === r.inp[k - 1]), 1, true);
        if (inp.length === 0) continue;
        if (r.bt.length > 0 && matchSeq(face, flag, buf, i, r.bt.length, (x, k) => x === r.bt[k], -1, false).length === 0) continue;
        if (r.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], r.la.length, (x, k) => x === r.la[k], 1, false).length === 0) continue;
        return context(face, buf, inp, r.recs);
      }
      return -1;
    }
    case 62: {
      if (!st.cov.has(g)) return -1;
      const cls = (cd: ReadonlyMap<number, number>, x: number): number => getOr(cd, x, 0);
      for (const r of getOr(st.rules, cls(st.icd, g), [])) {
        const inp = matchSeq(face, flag, buf, i, r.inp.length + 1, (x, k) => (k === 0 ? true : cls(st.icd, x) === r.inp[k - 1]), 1, true);
        if (inp.length === 0) continue;
        if (r.bt.length > 0 && matchSeq(face, flag, buf, i, r.bt.length, (x, k) => cls(st.bcd, x) === r.bt[k], -1, false).length === 0) continue;
        if (r.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], r.la.length, (x, k) => cls(st.lcd, x) === r.la[k], 1, false).length === 0) continue;
        return context(face, buf, inp, r.recs);
      }
      return -1;
    }
    case 63: {
      const inp = matchSeq(face, flag, buf, i, st.inp.length, inSets(st.inp), 1, true);
      if (inp.length === 0) return -1;
      if (st.bt.length > 0 && matchSeq(face, flag, buf, i, st.bt.length, inSets(st.bt), -1, false).length === 0) return -1;
      if (st.la.length > 0 && matchSeq(face, flag, buf, inp[inp.length - 1], st.la.length, inSets(st.la), 1, false).length === 0) return -1;
      return context(face, buf, inp, st.recs);
    }
    default: return assertNever(st);
  }
}

/** Apply nested lookups at matched input positions; continue after the match. */
function context(face: Face, buf: number[], inp: readonly number[], recs: Recs): number {
  let end = inp[inp.length - 1] + 1;
  for (const [seq, li] of recs) {
    if (seq >= inp.length) continue;
    const before = buf.length;
    applyLookup(face, li, buf, inp[seq]);
    end += buf.length - before;                         // ligatures shrink the buffer
  }
  return end;
}

/** Characters → glyph ids, with the default GSUB features applied in lookup order. */
export function shapeGlyphs(face: Face, text: string): number[] {
  const buf = [...text].map((ch) => getOr(face.cmap, ch, 0));   // .notdef for unmapped
  for (const li of face.data.gsub.order) {
    for (let i = 0; i < buf.length;) {
      const r = applyLookup(face, li, buf, i);
      i = r > i ? r : i + 1;
    }
  }
  return buf;
}

// ------------------------------------------------------------------ positions
const advanceUnits = (face: Face, g: number): number => getOr(face.glyphs, g, [0, 0, 0, 0, 0] as const)[0];

/** Pen positions in 26.6 for shaped glyphs; n+1 entries, the last is the total advance. */
export function penPositions(face: Face, gids: readonly number[], scale: number): Int32Array {
  const pens = new Int32Array(gids.length + 1);
  let pen = 0;
  for (let i = 0; i < gids.length; i++) {
    if (i > 0) pen += hbKern(face, getOr(face.kern, gids[i - 1] * 65536 + gids[i], 0), scale);
    pens[i] = pen;
    // hb-ft: FT_Get_Advance (unhinted) is FT_MulDiv(adv, x_scale, 64) in 16.16, rounded to 26.6
    pen += Math.floor((mulDiv(advanceUnits(face, gids[i]), scale, 64) + 512) / 1024);
  }
  pens[gids.length] = pen;
  return pens;
}

/** `table[key] * scale` with scale = 1 / upem * size * dpi / 72, as _get_layout computes it. */
export function minMetrics(face: Face, sizePt: number, dpi: number): { readonly ascent: number; readonly descent: number } {
  const scale = 1 / face.upm * sizePt * dpi / 72;
  return { ascent: face.minAscent * scale, descent: face.minDescent * scale };
}

/** Ink extent of shaped glyphs (union of scaled outline cboxes, 26.6 → px): what FT2Font.set_text measures. */
export function inkExtent(face: Face, gids: readonly number[], scale: number): { readonly yMax: number; readonly yMin: number } {
  let lo = 32000 * 64, hi = -32000 * 64;
  for (const g of gids) {
    const b = getOr(face.glyphs, g, [0, 0, 0, 0, 0] as const);
    const y0 = mulFix(b[3], scale), y1 = mulFix(b[4], scale);
    if (y0 < lo) lo = y0; if (y1 > hi) hi = y1;
  }
  return gids.length === 0 || lo > hi ? { yMax: 0, yMin: 0 } : { yMax: hi / 64, yMin: lo / 64 };
}

/** Mathtext glyph metrics (by character): linearHoriAdvance and the scaled outline's cbox, in px. */
export function mathMetrics(face: Face, ch: string, sizePt: number, dpi: number): { readonly advance: number; readonly iceberg: number; readonly depth: number } {
  const [adv, , , yMin, yMax] = getOr(face.glyphs, getOr(face.cmap, ch, 0), [0, 0, 0, 0, 0] as const);
  const scale = ftScale(face, sizePt, dpi);
  return { advance: mulDiv(adv, scale, 64) / 65536, iceberg: mulFix(yMax, scale) / 64, depth: -mulFix(yMin, scale) / 64 };
}
export const glyphOf = (face: Face, ch: string): number => getOr(face.cmap, ch, 0);
