// Annotation arrows without an arrowstyle: matplotlib 3.11.2 Annotation.update_positions ("approximately
// simulate the YAArrow") feeding FancyArrowPatch with ConnectionStyle.Arc3(rad=0) and ArrowStyle.Simple.
// Ported from text.py, patches.py and bezier.py so the vertices match to the last bit (pure).
// All coordinates are display px with y UP, as matplotlib computes them; the caller flips for Agg.

import type { Option } from './types.ts';
import { none, some } from './types.ts';

export type Pt = readonly [number, number];
type Quad = readonly [Pt, Pt, Pt];
type Inside = (p: Pt) => boolean;
export type Box = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
/** Path codes in matplotlib's order: M, L, Q (one CURVE3 pair), Z. */
export type ArrowSeg =
  | { readonly kind: 'M'; readonly p: Pt }
  | { readonly kind: 'L'; readonly p: Pt }
  | { readonly kind: 'Q'; readonly c: Pt; readonly p: Pt }
  | { readonly kind: 'Z' };

export type SimpleArrowSpec = {
  /** arrowprops width / headwidth / headlength in pt, shrink as a fraction */
  readonly widthPt: number; readonly headWidthPt: number; readonly headLengthPt: number; readonly shrink: number;
  /** mutation_scale: the annotation's font size in pt */
  readonly mutationPt: number;
};

/** bezier.inside_circle */
const insideCircle = (cx: number, cy: number, r: number): Inside => {
  const r2 = r ** 2;
  return ([x, y]) => (x - cx) ** 2 + (y - cy) ** 2 < r2;
};

/** BezierSegment.__call__ for a quadratic: (1-t)^2 P0 + (1-t) t (2 P1) + t^2 P2, summed in that order. */
const quadAt = (q: Quad, t: number): Pt => {
  const a = (1 - t) ** 2, b = (1 - t) * t, c = t ** 2;
  return [a * q[0][0] + b * (2 * q[1][0]) + c * q[2][0], a * q[0][1] + b * (2 * q[1][1]) + c * q[2][1]];
};

const samePt = (a: Pt, b: Pt): boolean => a[0] === b[0] && a[1] === b[1];

/** bezier.find_bezier_t_intersecting_with_closedpath (bisection, tolerance 0.01); none when both ends agree. */
function findT(q: Quad, inside: Inside, tolerance = 0.01): Option<readonly [number, number]> {
  let t0 = 0, t1 = 1;
  let start = quadAt(q, t0), end = quadAt(q, t1);
  let startInside = inside(start);
  const endInside = inside(end);
  if (startInside === endInside && !samePt(start, end)) return none;
  for (;;) {
    if (Math.hypot(start[0] - end[0], start[1] - end[1]) < tolerance) return some([t0, t1]);
    const mt = 0.5 * (t0 + t1);
    const middle = quadAt(q, mt);
    const middleInside = inside(middle);
    if (startInside !== middleInside) {
      t1 = mt;
      if (samePt(end, middle)) return some([t0, t1]);
      end = middle;
    } else {
      t0 = mt;
      if (samePt(start, middle)) return some([t0, t1]);
      start = middle; startInside = middleInside;
    }
  }
}

/** bezier.split_de_casteljau for a quadratic. */
function splitQuad(q: Quad, t: number): readonly [Quad, Quad] {
  const lerp = (a: Pt, b: Pt): Pt => [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t];
  const a = lerp(q[0], q[1]), b = lerp(q[1], q[2]), m = lerp(a, b);
  return [[q[0], a, m], [m, b, q[2]]];
}

/** bezier.split_bezier_intersecting_with_closedpath */
function splitAt(q: Quad, inside: Inside): Option<readonly [Quad, Quad]> {
  const t = findT(q, inside);
  return t.kind === 'none' ? none : some(splitQuad(q, (t.value[0] + t.value[1]) / 2));
}

/** ConnectionStyle._Base._clip on a single quadratic: keep the part outside `start`, then inside `stop`. */
function clip(q: Quad, start: Option<Inside>, stop: Option<Inside>): Quad {
  const s = start.kind === 'some' ? splitAt(q, start.value) : none;   // a ValueError leaves the path as is
  const afterStart = s.kind === 'some' ? s.value[1] : q;
  const e = stop.kind === 'some' ? splitAt(afterStart, stop.value) : none;
  return e.kind === 'some' ? e.value[0] : afterStart;
}

/** bezier.get_cos_sin */
const cosSin = (x0: number, y0: number, x1: number, y1: number): Pt => {
  const dx = x1 - x0, dy = y1 - y0, d = (dx * dx + dy * dy) ** 0.5;
  return d === 0 ? [0, 0] : [dx / d, dy / d];
};

/** bezier.get_normal_points: (left, right) */
const normalPoints = (cx: number, cy: number, cos: number, sin: number, len: number): readonly [Pt, Pt] =>
  len === 0 ? [[cx, cy], [cx, cy]] : [[len * sin + cx, len * -cos + cy], [len * -sin + cx, len * cos + cy]];

/** bezier.get_intersection; undefined for (near) parallel lines */
function intersection(c1: Pt, cs1: Pt, c2: Pt, cs2: Pt): Option<Pt> {
  const [cos1, sin1] = cs1, [cos2, sin2] = cs2;
  const rhs1 = sin1 * c1[0] - cos1 * c1[1], rhs2 = sin2 * c2[0] - cos2 * c2[1];
  const a = sin1, b = -cos1, c = sin2, d = -cos2;
  const adbc = a * d - b * c;
  if (Math.abs(adbc) < 1e-12) return none;
  const a_ = d / adbc, b_ = -b / adbc, c_ = -c / adbc, d_ = a / adbc;
  return some([a_ * rhs1 + b_ * rhs2, c_ * rhs1 + d_ * rhs2]);
}

/** bezier.check_if_parallel === -1 (antiparallel) */
const antiparallel = (dx1: number, dy1: number, dx2: number, dy2: number): boolean =>
  Math.abs(Math.abs(Math.atan2(dx1, dy1) - Math.atan2(dx2, dy2)) - Math.PI) < 1e-5;

/** bezier.get_parallels: (left, right) quadratics offset by width */
function parallels(q: Quad, width: number): readonly [Quad, Quad] {
  const [[c1x, c1y], [cmx, cmy], [c2x, c2y]] = q;
  const anti = antiparallel(c1x - cmx, c1y - cmy, cmx - c2x, cmy - c2y);
  const cs1 = anti ? cosSin(c1x, c1y, c2x, c2y) : cosSin(c1x, c1y, cmx, cmy);
  const cs2 = anti ? cs1 : cosSin(cmx, cmy, c2x, c2y);
  const [l1, r1] = normalPoints(c1x, c1y, cs1[0], cs1[1], width);
  const [l2, r2] = normalPoints(c2x, c2y, cs2[0], cs2[1], width);
  const li = intersection(l1, cs1, l2, cs2), ri = intersection(r1, cs1, r2, cs2);
  const both = li.kind === 'some' && ri.kind === 'some';   // one ValueError falls back for both sides
  const lm: Pt = both && li.kind === 'some' ? li.value : [0.5 * (l1[0] + l2[0]), 0.5 * (l1[1] + l2[1])];
  const rm: Pt = both && ri.kind === 'some' ? ri.value : [0.5 * (r1[0] + r2[0]), 0.5 * (r1[1] + r2[1])];
  return [[l1, lm, l2], [r1, rm, r2]];
}

/** bezier.find_control_points */
const controlPoints = (c1: Pt, mm: Pt, c2: Pt): Quad =>
  [c1, [0.5 * (4 * mm[0] - (c1[0] + c2[0])), 0.5 * (4 * mm[1] - (c1[1] + c2[1]))], c2];

/** bezier.make_wedged_bezier2(w1=1, wm=0.5, w2=0): (left, right) */
function wedged(q: Quad, width: number): readonly [Quad, Quad] {
  const [[c1x, c1y], [cmx, cmy], [c3x, c3y]] = q;
  const cs1 = cosSin(c1x, c1y, cmx, cmy), cs2 = cosSin(cmx, cmy, c3x, c3y);
  const [l1, r1] = normalPoints(c1x, c1y, cs1[0], cs1[1], width * 1);
  const [l3, r3] = normalPoints(c3x, c3y, cs2[0], cs2[1], width * 0);
  const c12x = (c1x + cmx) * 0.5, c12y = (c1y + cmy) * 0.5, c23x = (cmx + c3x) * 0.5, c23y = (cmy + c3y) * 0.5;
  const c123x = (c12x + c23x) * 0.5, c123y = (c12y + c23y) * 0.5;
  const cs123 = cosSin(c12x, c12y, c23x, c23y);
  const [lm, rm] = normalPoints(c123x, c123y, cs123[0], cs123[1], width * 0.5);
  return [controlPoints(l1, lm, l3), controlPoints(r1, rm, r3)];
}

/** ArrowStyle.Simple.transmute */
function simple(q: Quad, mutation: number, headLength: number, headWidth: number, tailWidth: number): readonly ArrowSeg[] {
  const [, p1, p2] = q;
  const hl = headLength * mutation;
  const split = splitAt(q, insideCircle(p2[0], p2[1], hl));
  const along = (): Pt => {   // _point_along_a_line(x2, y2, x1, y1, head_length)
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1], ff = hl / (dx * dx + dy * dy) ** 0.5;
    return [p2[0] - ff * dx, p2[1] - ff * dy];
  };
  const arrowIn: Quad = split.kind === 'none'
    ? ((a: Pt): Quad => [a, [0.5 * (a[0] + p2[0]), 0.5 * (a[1] + p2[1])], p2])(along())
    : split.value[1];
  const [hl0, hr0] = wedged(arrowIn, (headWidth * mutation) / 2);
  if (split.kind === 'none') {
    return [{ kind: 'M', p: hr0[0] }, { kind: 'Q', c: hr0[1], p: hr0[2] }, { kind: 'Q', c: hl0[1], p: hl0[0] }, { kind: 'Z' }];
  }
  const [tl, tr] = parallels(split.value[0], (tailWidth * mutation) / 2);
  return [
    { kind: 'M', p: tr[0] }, { kind: 'Q', c: tr[1], p: tr[2] },
    { kind: 'L', p: hr0[0] }, { kind: 'Q', c: hr0[1], p: hr0[2] }, { kind: 'Q', c: hl0[1], p: hl0[0] },
    { kind: 'L', p: tl[2] }, { kind: 'Q', c: tl[1], p: tl[0] },
    { kind: 'L', p: tr[0] }, { kind: 'Z' },
  ];
}

/** min(candidates, key=|c - v|): the first closest (position, relpos) pair */
const pick = (c: readonly (readonly [number, number])[], v: number): readonly [number, number] =>
  c.reduce((best, cur) => (Math.abs(cur[0] - v) < Math.abs(best[0] - v) ? cur : best));

/**
 * The arrow path for annotate(..., arrowprops={...}) with no 'arrowstyle', from the text's window extent
 * `bbox` to the annotated point `xy`. `k` is points_to_pixels(1) (FancyArrowPatch's dpi_cor).
 */
export function yaArrowPath(bbox: Box, xy: Pt, hasText: boolean, spec: SimpleArrowSpec, k: number): readonly ArrowSeg[] {
  const [x1, y1] = xy;
  const [x, relx] = pick([[bbox.x0, 0], [(bbox.x0 + bbox.x1) / 2, 0.5], [bbox.x1, 1]], x1);
  const [y, rely] = pick([[bbox.y0, 0], [(bbox.y0 + bbox.y1) / 2, 0.5], [bbox.y1, 1]], y1);
  const r = Math.hypot(y - y1, x - x1);
  const shrinkPx = ((spec.shrink * r) / k) * k;
  const w = bbox.x1 - bbox.x0, h = bbox.y1 - bbox.y0;
  const begin: Pt = [bbox.x0 + w * relx, bbox.y0 + h * rely];
  // ConnectionStyle.Arc3(rad=0).connect
  const q0: Quad = [begin, [(begin[0] + x1) / 2, (begin[1] + y1) / 2], [x1, y1]];
  // patchA: the text bbox padded by 4 pt (Rectangle.contains with radius = its 1.0 linewidth tests the bare rectangle)
  const pad = 4 * k;
  const rx0 = bbox.x0 - pad / 2, ry0 = bbox.y0 - pad / 2, rx1 = rx0 + (w + pad), ry1 = ry0 + (h + pad);
  const inA: Option<Inside> = hasText ? some(([px, py]: Pt) => px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1) : none;
  const q1 = clip(q0, inA, none);
  const q2 = shrinkPx !== 0 ? clip(q1, some(insideCircle(q1[0][0], q1[0][1], shrinkPx)), some(insideCircle(q1[2][0], q1[2][1], shrinkPx))) : q1;
  const ms = spec.mutationPt;
  return simple(q2, ms * k, spec.headLengthPt / ms, spec.headWidthPt / ms, spec.widthPt / ms);
}
