// The annotated-SVG sidecar: per Axes, a compact JSON description of what was drawn, so a small client script
// (src/interactive/client.ts) can do hover readouts, nearest-point tooltips, highlighting and legend toggles over
// the server-rendered SVG without re-rendering anything. Schema (v1), all pixel values in SVG user units, y down:
//   { v: 1, box: [x0, yTop, x1, yBot],
//     x | y: { s: 'linear' | 'log' | 'date' | 'cat', lim: [lo, hi], inv: bool, g: share group, b?: log base, names?: categories, t?: axis label },
//     cb?: 1 (a colorbar's Axes), ti?: the Axes title,
//     a: [ { k: kind, l?: label, c?: color, s?: 'x' | 'y' | 'xy' (how the pointer snaps), ds?: 'pre' | 'mid' | 'post',
//            o?: 'h' (horizontal bars), d?: [x0, y0, x1, y1, …] data, p?: [px0, py0, …] pixels, b?: bar bases, n?: points before decimation,
//            r?: marker radius in pixels (series the pointer picks in 2D) } ],
//     lg: [ [artist, x0, y0, x1, y1], … ] legend entry boxes }
// `g` is the index of the first Axes holding this axis: Axes that share an axis (sharex/sharey, twinx) have the same `g`,
// and their limits move together (mpl/zoom relies on it). `a[i]` is the artist tagged data-artist="artist/i/<kind>". Date values are matplotlib date numbers (days since
// 1970-01-01 UTC). Points whose snap coordinates fall outside the axes box, or that are not finite, are left out; an
// artist with more than MAX_POINTS points is decimated (see `decimate`).
// Pixel points `p` are rounded to 0.01 px, or to the path data's own decimals under toSVG({ precision: 0 | 1 }), so they
// equal the drawn vertex coordinates when the path is that coarse and are within 0.005 px of them otherwise (precision
// 2–4 or default). The box stays at 1e-4 whatever the precision: rects keep 4 decimals.
// Markers are the exception: Agg snaps marker positions to pixel centres (floor(v + 0.5) + 0.5), as matplotlib does, so
// a <use> sits up to 1 px (plus rounding) from its sidecar point, which is the exact data transform.
import type { AxesAnnot } from '../core/layout.ts';
import type { Frame } from '../core/frame.ts';
import { tx, ty } from '../core/frame.ts';
import type { Artist, AxesSpec, AxisSpec, Paint, Scale } from '../core/types.ts';
import { assertNever } from '../core/types.ts';

/** Most points kept per artist. Ordered series keep each bucket's min and max (peaks survive); scatter keeps every k-th. */
export const MAX_POINTS = 2000;

type Json = Readonly<Record<string, unknown>>;
const POW10 = [1, 10, 100];
/** Pixels at `dp` decimals (0–2): 0.01 px by default, the path data's own rounding under toSVG({ precision: 0 | 1 }). */
const pxAt = (dp: number) => (v: number): number => Math.round(v * POW10[dp]) / POW10[dp];
const px = pxAt(2);
/** 12 significant digits: enough for date numbers to ~10 ms, and short for typical data. */
const num = (v: number): number => Number(v.toPrecision(12));
const xmlText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function axisJson(spec: AxisSpec, sc: Scale, lim: readonly [number, number], g: number, label: string): Json {
  const base = { lim: [num(lim[0]), num(lim[1])], inv: lim[0] > lim[1], g, ...(label === '' ? {} : { t: label }) };
  switch (spec.kind) {
    case 'datetime': return { s: 'date', ...base };
    case 'category': return { s: 'cat', ...base, names: spec.names };
    case 'numeric':
      switch (sc.kind) {
        case 'linear': return { s: 'linear', ...base };
        case 'log': return { s: 'log', ...base, b: sc.base };
        default: return assertNever(sc);
      }
    default: return assertNever(spec);
  }
}

const paintHex = (...ps: readonly Paint[]): readonly string[] => ps.flatMap((p) => (p.kind === 'solid' && p.color.alpha > 0 ? [p.color.hex] : []));

/** A data series as drawn: data coordinates, the matching pixels, optional bases (bars). */
type Series = { readonly x: ArrayLike<number>; readonly y: ArrayLike<number>; readonly base: ArrayLike<number>; readonly snap: 'x' | 'y' | 'xy' };

function seriesOf(a: Artist): Series {
  const none: Series = { x: [], y: [], base: [], snap: 'xy' };
  switch (a.kind) {
    case 'line': {
      if (a.coords.x !== 'data' || a.coords.y !== 'data') return none;   // axhline/axvline: a reference, not data
      const x = a.x, y = a.y;
      let ordered = a.stroke.kind === 'on';
      for (let i = 1; ordered && i < x.length; i++) if (x[i] < x[i - 1]) ordered = false;
      return { x, y, base: [], snap: ordered ? 'x' : 'xy' };
    }
    case 'scatter': return { x: a.x, y: a.y, base: [], snap: 'xy' };
    case 'bar': {
      const n = a.x.length, x = new Float64Array(n), y = new Float64Array(n), base = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        if (a.orientation === 'vertical') { x[i] = a.x[i] + a.w[i] / 2; y[i] = a.y[i] + a.h[i]; base[i] = a.y[i]; }
        else { x[i] = a.x[i] + a.w[i]; y[i] = a.y[i] + a.h[i] / 2; base[i] = a.x[i]; }
      }
      return { x, y, base, snap: a.orientation === 'vertical' ? 'x' : 'y' };
    }
    case 'fill': case 'text': case 'annotation': case 'span': case 'axline': case 'segments': case 'polygon':
    case 'errorbar': case 'image': case 'sticky': return none;
    default: return assertNever(a);
  }
}

function colorOf(a: Artist): readonly string[] {
  switch (a.kind) {
    case 'line': return [...(a.stroke.kind === 'on' ? [a.stroke.color.hex] : []), ...(a.markers.kind === 'on' ? paintHex(a.markers.face, a.markers.edge) : [])];
    case 'scatter': return paintHex(...a.collection.faces, ...a.collection.edges);
    case 'bar': return [...paintHex(a.face), ...(a.edge.kind === 'on' ? [a.edge.color.hex] : [])];
    case 'fill': case 'polygon': case 'span': return paintHex(a.face);
    case 'axline': return a.stroke.kind === 'on' ? [a.stroke.color.hex] : [];
    case 'segments': return a.colors.slice(0, 1).map((c) => c.hex);
    case 'text': case 'annotation': return [a.color.hex];
    case 'errorbar': return [a.handle.bar.color.hex];
    case 'image': case 'sticky': return [];
    default: return assertNever(a);
  }
}

/** Indices to keep, in order: ≤ MAX_POINTS. Ordered series: per bucket of consecutive points, its min and max value. */
export function decimate(values: ArrayLike<number>, snap: Series['snap'], max: number = MAX_POINTS): readonly number[] {
  const n = values.length;
  if (n <= max || snap === 'xy') { const k = Math.max(1, Math.ceil(n / max)); return Array.from({ length: Math.ceil(n / k) }, (_, i) => i * k); }
  const buckets = Math.floor(max / 2), out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.floor((b * n) / buckets), hi = Math.floor(((b + 1) * n) / buckets);
    let mn = lo, mx = lo;
    for (let i = lo; i < hi; i++) { if (values[i] < values[mn]) mn = i; if (values[i] > values[mx]) mx = i; }
    if (mn === mx) out.push(mn); else out.push(Math.min(mn, mx), Math.max(mn, mx));
  }
  return out;
}

/** A marker's radius in pixels: scatter sizes are pt^2 (the largest of them), line markers a diameter in pt. */
function markerRadius(a: Artist, dpi: number): number {
  const pt = a.kind === 'scatter' ? Math.sqrt(Math.max(0, ...a.collection.sizesPt2)) : a.kind === 'line' && a.markers.kind === 'on' ? a.markers.sizePt : 0;
  return (pt / 2) * (dpi / 72);
}

function artistJson(a: Artist, f: Frame, rp: (v: number) => number, dpi: number): Json {
  const head: Record<string, unknown> = { k: a.kind };
  if (a.kind !== 'text' && a.kind !== 'annotation' && a.label.kind === 'text') head['l'] = a.label.text;
  const c = colorOf(a);
  if (c.length > 0) head['c'] = c[0];
  const s = seriesOf(a);
  if (s.x.length === 0) return head;
  const b = f.box, tol = 0.5;
  const inX = (v: number): boolean => v >= b.x0 - tol && v <= b.x1 + tol, inY = (v: number): boolean => v >= b.yTop - tol && v <= b.yBot + tol;
  const N = s.x.length, keep = new Int32Array(N), pxs = new Float64Array(N), pys = new Float64Array(N), vals = new Float64Array(N);
  const bar = a.kind === 'bar';
  let m = 0;
  for (let i = 0; i < N; i++) {
    const xv = s.x[i], yv = s.y[i], X = tx(f, xv), Y = ty(f, yv);
    if (!Number.isFinite(xv) || !Number.isFinite(yv) || !Number.isFinite(X) || !Number.isFinite(Y)) continue;
    // bars count when their centre is inside (their far end may be clipped); points need both coordinates inside
    if (!(bar && s.snap === 'x' ? inX(X) : bar && s.snap === 'y' ? inY(Y) : inX(X) && inY(Y))) continue;
    keep[m] = i; pxs[m] = X; pys[m] = Y; vals[m] = s.snap === 'y' ? xv : yv; m++;
  }
  const sel = decimate(vals.subarray(0, m), s.snap);
  const d: number[] = [], p: number[] = [], base: number[] = [];
  for (const j of sel) { const i = keep[j]; d.push(num(s.x[i]), num(s.y[i])); p.push(rp(pxs[j]), rp(pys[j])); if (s.base.length > 0) base.push(num(s.base[i])); }
  const out: Record<string, unknown> = { ...head, s: s.snap, d, p };
  if (a.kind === 'line' && a.drawstyle !== 'default') out['ds'] = a.drawstyle.slice(6);
  if (a.kind === 'bar' && a.orientation === 'horizontal') out['o'] = 'h';
  if (base.some((v) => v !== 0)) out['b'] = base;
  if (sel.length < m) out['n'] = m;
  const r = s.snap === 'xy' ? markerRadius(a, dpi) : 0;
  if (r > 0) out['r'] = px(r);
  return out;
}

/** The sidecar of one Axes, as XML-escaped JSON text (it sits inside an SVG <metadata> element). */
export function axesSidecar(ax: AxesSpec, an: AxesAnnot, dp = 2, dpi = 100): string {
  const f = an.frame, b = f.box;
  const j = {
    // the box to the SVG's own 1e-4 (points are 0.01 px): the client's pixel → data mapping rests on it
    v: 1, box: [b.x0, b.yTop, b.x1, b.yBot].map((v) => Math.round(v * 1e4) / 1e4),
    x: axisJson(ax.x, f.xscale, f.xlim, ax.xShare, ax.xlabel), y: axisJson(ax.y, f.yscale, f.ylim, ax.yShare, ax.ylabel),
    ...(ax.role.kind === 'colorbar' ? { cb: 1 } : {}),
    ...(ax.title === '' ? {} : { ti: ax.title }),
    a: ax.artists.map((a) => artistJson(a, f, pxAt(Math.max(0, Math.min(2, dp))), dpi)),
    lg: an.legend.map((e) => [e.artist, px(e.box.x0), px(e.box.y0), px(e.box.x1), px(e.box.y1)]),
  };
  return xmlText(JSON.stringify(j));
}
