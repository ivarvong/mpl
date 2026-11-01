// Axes.autoscale_view: one fused pass over all artists (of an axes and its shared
// twins) for finite min/max, the smallest positive value (minpos) and sticky edges;
// then nonsingular -> limit_range_for_scale -> margins in transformed space -> stickies.
import { logNonsingular } from './log.ts';
import { forward, inverse } from './scale.ts';
import { nonsingular } from './ticker.ts';
import { dateNonsingular } from './dates.ts';
import type { Artist, AxisSpec, Scale } from './types.ts';
import { assertNever } from './types.ts';

export type Extent = { readonly lo: number; readonly hi: number; readonly minpos: number; readonly count: number; readonly stickies: readonly number[] };
type Acc = { lo: number; hi: number; minpos: number; count: number };

function scan(v: Float64Array, acc: Acc): void {
  let lo = acc.lo, hi = acc.hi, mp = acc.minpos, count = 0;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (x === x && x !== Infinity && x !== -Infinity) { if (x < lo) lo = x; if (x > hi) hi = x; if (x > 0 && x < mp) mp = x; count++; }
  }
  acc.lo = lo; acc.hi = hi; acc.minpos = mp; acc.count += count;
}
function scanSpans(start: Float64Array, len: Float64Array, acc: Acc): void {
  let lo = acc.lo, hi = acc.hi, mp = acc.minpos;
  for (let i = 0; i < start.length; i++) {
    const p = start[i], q = p + len[i];
    if (p < lo) lo = p; if (p > hi) hi = p; if (q < lo) lo = q; if (q > hi) hi = q;
    if (p > 0 && p < mp) mp = p; if (q > 0 && q < mp) mp = q;
  }
  acc.lo = lo; acc.hi = hi; acc.minpos = mp; acc.count += 2 * start.length;
}
const uniqSorted = (v: readonly number[]): readonly number[] => [...new Set(v)].toSorted((p, q) => p - q);
const emptyAcc = (): Acc => ({ lo: Infinity, hi: -Infinity, minpos: Infinity, count: 0 });

export function dataExtents(artists: readonly Artist[]): { readonly x: Extent; readonly y: Extent } {
  const X = emptyAcc(), Y = emptyAcc();
  const sx: number[] = [], sy: number[] = [];
  for (const a of artists) {
    switch (a.kind) {
      case 'line': scan(a.x, X); scan(a.y, Y); break;
      case 'bar':
        scanSpans(a.x, a.w, X); scanSpans(a.y, a.h, Y);
        switch (a.orientation) {                    // the base is a sticky edge
          case 'vertical': for (const v of a.y) sy.push(v); break;
          case 'horizontal': for (const v of a.x) sx.push(v); break;
          default: assertNever(a.orientation);
        }
        break;
      case 'fill': scan(a.x, X); scan(a.y1, Y); scan(a.y2, Y); break;
      case 'scatter': scan(a.x, X); scan(a.y, Y); break;
      case 'annotation': break;
      case 'span':
        if (a.orientation === 'vertical') { scan(new Float64Array([a.a0, a.a1]), X); }
        else { scan(new Float64Array([a.a0, a.a1]), Y); }
        break;
      case 'text': break;                            // text does not update data limits
      default: assertNever(a);
    }
  }
  return { x: { ...X, stickies: uniqSorted(sx) }, y: { ...Y, stickies: uniqSorted(sy) } };
}

/** Shared axes autoscale over the union of their data limits. */
export const unionExtent = (es: readonly Extent[]): Extent => ({
  lo: Math.min(...es.map((e) => e.lo)), hi: Math.max(...es.map((e) => e.hi)), minpos: Math.min(...es.map((e) => e.minpos)),
  count: es.reduce((a, e) => a + e.count, 0), stickies: uniqSorted(es.flatMap((e) => e.stickies)),
});

/**
 * Which locator's limit rules apply: the axis' default major locator (Axis._set_scale / unit converter).
 * Derived from the whole AxisSpec, so a new axis kind or scale is a compile error here.
 */
type LimitRules =
  | { readonly kind: 'maxn' }                         // AutoLocator (MaxNLocator)
  | { readonly kind: 'log'; readonly base: number }   // LogLocator
  | { readonly kind: 'base' }                         // StrCategoryLocator: ticker.Locator defaults
  | { readonly kind: 'date' };                        // AutoDateLocator

function rulesFor(spec: AxisSpec): LimitRules {
  switch (spec.kind) {
    case 'numeric':
      switch (spec.scale.kind) {
        case 'linear': return { kind: 'maxn' };
        case 'log': return { kind: 'log', base: spec.scale.base };
        default: return assertNever(spec.scale);
      }
    case 'category': return { kind: 'base' };
    case 'datetime': return { kind: 'date' };
    default: return assertNever(spec);
  }
}

/** Locator.nonsingular */
function locatorNonsingular(r: LimitRules, lo: number, hi: number, minpos: number): readonly [number, number] {
  switch (r.kind) {
    case 'maxn': case 'base': return nonsingular(lo, hi, 0.05, 1e-15, true);
    case 'log': return logNonsingular(lo, hi, r.base, minpos);
    case 'date': return dateNonsingular(lo, hi);
    default: return assertNever(r);
  }
}
/** Locator.view_limits (autolimit_mode 'data') */
function locatorViewLimits(r: LimitRules, lo: number, hi: number, minpos: number): readonly [number, number] {
  switch (r.kind) {
    case 'maxn': return nonsingular(lo, hi, 1e-12, 1e-13, true);
    case 'base': case 'date': return nonsingular(lo, hi, 0.001, 1e-15, true);
    case 'log': return logNonsingular(lo, hi, r.base, minpos);
    default: return assertNever(r);
  }
}
/** Scale.limit_range_for_scale */
function limitRange(s: Scale, lo: number, hi: number, minpos: number): readonly [number, number] {
  switch (s.kind) {
    case 'linear': return [lo, hi];
    case 'log': { const mp = Number.isFinite(minpos) ? minpos : 1e-300; return [lo <= 0 ? mp : lo, hi <= 0 ? mp : hi]; }
    default: return assertNever(s);
  }
}

/** handle_single_axis */
export function autoscaleExtent(e: Extent, spec: AxisSpec, s: Scale, margin: number): readonly [number, number] {
  const rules = rulesFor(spec);
  const [n0, n1] = locatorNonsingular(rules, e.count > 0 ? e.lo : -Infinity, e.count > 0 ? e.hi : Infinity, e.minpos);
  const tol = 1e-5 * Math.abs(n1 - n0);
  const below = e.stickies.filter((v) => v < n0 + tol);         // searchsorted(x0 + tol) - 1
  const above = e.stickies.filter((v) => v >= n1 - tol);        // searchsorted(x1 - tol)
  const [r0, r1] = limitRange(s, n0, n1, e.minpos);
  const t0 = forward(s, r0), t1 = forward(s, r1);
  let delta = (t1 - t0) * margin;
  if (!Number.isFinite(delta)) delta = 0;
  let lo = inverse(s, t0 - delta), hi = inverse(s, t1 + delta);
  if (below.length > 0) lo = Math.max(lo, below[below.length - 1]);
  if (above.length > 0) hi = Math.min(hi, above[0]);
  return locatorViewLimits(rules, lo, hi, e.minpos);
}

export function viewLimits(spec: AxisSpec, s: Scale, e: Extent, margin: number): readonly [number, number] {
  switch (spec.limits.kind) {
    case 'fixed': return [spec.limits.lo, spec.limits.hi];
    case 'auto': return autoscaleExtent(e, spec, s, margin);
    default: return assertNever(spec.limits);
  }
}
