// Agg's vector pipeline after the path converters: conv_curve (curve3_div/curve4_div),
// conv_dash (vcgen_dash) and conv_stroke (vcgen_stroke + math_stroke), ported from
// matplotlib's vendored agg24-svn with the same float operations in the same order.
import type { Cap, Join, Seg } from '../../core/types.ts';
import { assertNever } from '../../core/types.ts';

/** Where polygons go: Agg's rasterizer add_vertex interface. */
export interface PathSink { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; close(): void }

/** A flattened subpath. */
export type Sub = { readonly xs: number[]; readonly ys: number[]; readonly closed: boolean };

const EPS = 1e-14;                      // vertex_dist_epsilon
const INTERSECTION_EPS = 1e-30;
const COLLINEARITY_EPS = 1e-30;
const RECURSION_LIMIT = 32;
const TOL2 = 0.25;                      // (0.5 / approximation_scale)^2

// ------------------------------------------------------------------ curves
function bez3(out: Sub, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, level: number): void {
  if (level > RECURSION_LIMIT) return;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2, x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2;
  const dx = x3 - x1, dy = y3 - y1;
  let d = Math.abs((x2 - x3) * dy - (y2 - y3) * dx);
  if (d > COLLINEARITY_EPS) {
    if (d * d <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x123); out.ys.push(y123); return; }
  } else {
    const da = dx * dx + dy * dy;
    if (da === 0) d = sq(x1, y1, x2, y2);
    else {
      d = ((x2 - x1) * dx + (y2 - y1) * dy) / da;
      if (d > 0 && d < 1) return;
      if (d <= 0) d = sq(x2, y2, x1, y1);
      else if (d >= 1) d = sq(x2, y2, x3, y3);
      else d = sq(x2, y2, x1 + d * dx, y1 + d * dy);
    }
    if (d < TOL2) { out.xs.push(x2); out.ys.push(y2); return; }
  }
  bez3(out, x1, y1, x12, y12, x123, y123, level + 1);
  bez3(out, x123, y123, x23, y23, x3, y3, level + 1);
}

function bez4(out: Sub, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number, level: number): void {
  if (level > RECURSION_LIMIT) return;
  const x12 = (x1 + x2) / 2, y12 = (y1 + y2) / 2, x23 = (x2 + x3) / 2, y23 = (y2 + y3) / 2;
  const x34 = (x3 + x4) / 2, y34 = (y3 + y4) / 2;
  const x123 = (x12 + x23) / 2, y123 = (y12 + y23) / 2, x234 = (x23 + x34) / 2, y234 = (y23 + y34) / 2;
  const x1234 = (x123 + x234) / 2, y1234 = (y123 + y234) / 2;
  const dx = x4 - x1, dy = y4 - y1;
  let d2 = Math.abs((x2 - x4) * dy - (y2 - y4) * dx);
  let d3 = Math.abs((x3 - x4) * dy - (y3 - y4) * dx);
  switch (((d2 > COLLINEARITY_EPS ? 1 : 0) << 1) + (d3 > COLLINEARITY_EPS ? 1 : 0)) {
    case 0: {
      let k = dx * dx + dy * dy;
      if (k === 0) { d2 = sq(x1, y1, x2, y2); d3 = sq(x4, y4, x3, y3); }
      else {
        k = 1 / k;
        d2 = k * ((x2 - x1) * dx + (y2 - y1) * dy);
        d3 = k * ((x3 - x1) * dx + (y3 - y1) * dy);
        if (d2 > 0 && d2 < 1 && d3 > 0 && d3 < 1) return;
        if (d2 <= 0) d2 = sq(x2, y2, x1, y1); else if (d2 >= 1) d2 = sq(x2, y2, x4, y4); else d2 = sq(x2, y2, x1 + d2 * dx, y1 + d2 * dy);
        if (d3 <= 0) d3 = sq(x3, y3, x1, y1); else if (d3 >= 1) d3 = sq(x3, y3, x4, y4); else d3 = sq(x3, y3, x1 + d3 * dx, y1 + d3 * dy);
      }
      if (d2 > d3) { if (d2 < TOL2) { out.xs.push(x2); out.ys.push(y2); return; } }
      else if (d3 < TOL2) { out.xs.push(x3); out.ys.push(y3); return; }
      break;
    }
    case 1:
      if (d3 * d3 <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    case 2:
      if (d2 * d2 <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    case 3:
      if ((d2 + d3) * (d2 + d3) <= TOL2 * (dx * dx + dy * dy)) { out.xs.push(x23); out.ys.push(y23); return; }
      break;
    default: throw new Error('unreachable: two-bit collinearity code');
  }
  bez4(out, x1, y1, x12, y12, x123, y123, x1234, y1234, level + 1);
  bez4(out, x1234, y1234, x234, y234, x34, y34, x4, y4, level + 1);
}

const sq = (x1: number, y1: number, x2: number, y2: number): number => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };

/**
 * conv_curve over a Seg list, split into subpaths at M (and after Z). Curve start
 * points are the current point; curve_div emits interior points then the end point.
 * `dx, dy` translate every vertex first (conv_transform).
 */
export function flatten(segs: readonly Seg[], dx: number, dy: number): Sub[] {
  const out: Sub[] = [];
  let cur: Sub = { xs: [], ys: [], closed: false };
  let sx = 0, sy = 0, lx = 0, ly = 0;
  const flush = (): void => { if (cur.xs.length > 0) out.push(cur); };
  for (const s of segs) {
    switch (s[0]) {
      case 'M': flush(); cur = { xs: [s[1] + dx], ys: [s[2] + dy], closed: false }; sx = lx = s[1] + dx; sy = ly = s[2] + dy; break;
      case 'L': if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); } lx = s[1] + dx; ly = s[2] + dy; cur.xs.push(lx); cur.ys.push(ly); break;
      case 'Q': {
        if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); }
        const x2 = s[1] + dx, y2 = s[2] + dy, x3 = s[3] + dx, y3 = s[4] + dy;
        bez3(cur, lx, ly, x2, y2, x3, y3, 0); cur.xs.push(x3); cur.ys.push(y3); lx = x3; ly = y3; break;
      }
      case 'C': {
        if (cur.xs.length === 0) { cur.xs.push(sx); cur.ys.push(sy); }
        const x2 = s[1] + dx, y2 = s[2] + dy, x3 = s[3] + dx, y3 = s[4] + dy, x4 = s[5] + dx, y4 = s[6] + dy;
        bez4(cur, lx, ly, x2, y2, x3, y3, x4, y4, 0); cur.xs.push(x4); cur.ys.push(y4); lx = x4; ly = y4; break;
      }
      case 'Z': cur = { xs: cur.xs, ys: cur.ys, closed: true }; flush(); cur = { xs: [], ys: [], closed: false }; lx = sx; ly = sy; break;
      default: assertNever(s);
    }
  }
  flush();
  return out;
}

/** Fill: every subpath becomes a polygon (the rasterizer auto-closes). */
export function fillPath(subs: readonly Sub[], sink: PathSink): void {
  for (const s of subs) {
    sink.moveTo(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) sink.lineTo(s.xs[i], s.ys[i]);
    sink.close();
  }
}

// ------------------------------------------------------------------ vertex_sequence<vertex_dist>
/** Agg's vertex_sequence: drops coincident vertices, caches each vertex's distance to the next. */
class VSeq {
  xs: number[] = []; ys: number[] = []; ds: number[] = [];
  get size(): number { return this.xs.length; }
  private link(i: number, j: number): boolean {
    const dx = this.xs[j] - this.xs[i], dy = this.ys[j] - this.ys[i];
    const d = Math.sqrt(dx * dx + dy * dy);
    const ok = d > EPS;
    this.ds[i] = ok ? d : 1 / EPS;
    return ok;
  }
  private removeLast(): void { if (this.xs.length > 0) { this.xs.pop(); this.ys.pop(); this.ds.pop(); } }
  add(x: number, y: number): void {
    const n = this.size;
    if (n > 1 && !this.link(n - 2, n - 1)) this.removeLast();
    this.xs.push(x); this.ys.push(y); this.ds.push(0);
  }
  modifyLast(x: number, y: number): void { this.removeLast(); this.add(x, y); }
  close(closed: boolean): void {
    while (this.size > 1) {
      if (this.link(this.size - 2, this.size - 1)) break;
      const x = this.xs[this.size - 1], y = this.ys[this.size - 1];
      this.removeLast(); this.modifyLast(x, y);
    }
    if (closed) while (this.size > 1) { if (this.link(this.size - 1, 0)) break; this.removeLast(); }
  }
}

// ------------------------------------------------------------------ math_stroke
type LJ = 'miter' | 'miterRevert' | 'round' | 'bevel';
type Stroker = { readonly w: number; readonly wAbs: number; readonly wEps: number; readonly cap: Cap; readonly join: LJ; readonly miterLimit: number };
type Out = { xs: number[]; ys: number[] };

/** matplotlib's GCAgg mapping: 'miter' → miter_join_revert, 'projecting' (square) caps. */
export function stroker(width: number, cap: Cap, join: Join, miterLimit: number): Stroker {
  const w = width * 0.5;
  const lj: LJ = join === 'miter' ? 'miterRevert' : join === 'round' ? 'round' : 'bevel';
  return { w, wAbs: Math.abs(w), wEps: w / 1024, cap, join: lj, miterLimit };
}

const cross = (x1: number, y1: number, x2: number, y2: number, x: number, y: number): number => (x - x2) * (y2 - y1) - (y - y2) * (x2 - x1);

function intersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number, o: { x: number; y: number }): boolean {
  const num = (ay - cy) * (dx - cx) - (ax - cx) * (dy - cy);
  const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(den) < INTERSECTION_EPS) return false;
  const r = num / den;
  o.x = ax + r * (bx - ax); o.y = ay + r * (by - ay);
  return true;
}

function calcArc(st: Stroker, vc: Out, x: number, y: number, dx1: number, dy1: number, dx2: number, dy2: number): void {
  let a1 = Math.atan2(dy1, dx1);
  let a2 = Math.atan2(dy2, dx2);
  let da = Math.acos(st.wAbs / (st.wAbs + 0.125)) * 2;
  vc.xs.push(x + dx1); vc.ys.push(y + dy1);
  if (a1 > a2) a2 += 2 * Math.PI;
  const n = Math.trunc((a2 - a1) / da);
  da = (a2 - a1) / (n + 1);
  a1 += da;
  for (let i = 0; i < n; i++) { vc.xs.push(x + Math.cos(a1) * st.w); vc.ys.push(y + Math.sin(a1) * st.w); a1 += da; }
  vc.xs.push(x + dx2); vc.ys.push(y + dy2);
}

const P = { x: 0, y: 0 };

function calcMiter(st: Stroker, vc: Out, v0x: number, v0y: number, v1x: number, v1y: number, v2x: number, v2y: number,
                   dx1: number, dy1: number, dx2: number, dy2: number, lj: LJ, mlimit: number, dbevel: number): void {
  let xi = v1x, yi = v1y, di = 1;
  const lim = st.wAbs * mlimit;
  let exceeded = true, failed = true;
  if (intersect(v0x + dx1, v0y - dy1, v1x + dx1, v1y - dy1, v1x + dx2, v1y - dy2, v2x + dx2, v2y - dy2, P)) {
    xi = P.x; yi = P.y;
    const ex = xi - v1x, ey = yi - v1y;
    di = Math.sqrt(ex * ex + ey * ey);
    if (di <= lim) { vc.xs.push(xi); vc.ys.push(yi); exceeded = false; }
    failed = false;
  } else {
    const x2 = v1x + dx1, y2 = v1y - dy1;
    if ((cross(v0x, v0y, v1x, v1y, x2, y2) < 0) === (cross(v1x, v1y, v2x, v2y, x2, y2) < 0)) {
      vc.xs.push(v1x + dx1); vc.ys.push(v1y - dy1); exceeded = false;
    }
  }
  if (!exceeded) return;
  switch (lj) {
    case 'miterRevert':
      vc.xs.push(v1x + dx1, v1x + dx2); vc.ys.push(v1y - dy1, v1y - dy2); return;
    case 'round':
      calcArc(st, vc, v1x, v1y, dx1, -dy1, dx2, -dy2); return;
    case 'miter': case 'bevel':
      if (failed) {
        vc.xs.push(v1x + dx1 + dy1 * mlimit, v1x + dx2 - dy2 * mlimit);
        vc.ys.push(v1y - dy1 + dx1 * mlimit, v1y - dy2 - dx2 * mlimit);
      } else {
        const x1 = v1x + dx1, y1 = v1y - dy1, x2 = v1x + dx2, y2 = v1y - dy2;
        di = (lim - dbevel) / (di - dbevel);
        vc.xs.push(x1 + (xi - x1) * di, x2 + (xi - x2) * di);
        vc.ys.push(y1 + (yi - y1) * di, y2 + (yi - y2) * di);
      }
      return;
    default: assertNever(lj);
  }
}

function calcCap(st: Stroker, vc: Out, v0x: number, v0y: number, v1x: number, v1y: number, len: number): void {
  vc.xs.length = 0; vc.ys.length = 0;
  let dx1 = (v1y - v0y) / len, dy1 = (v1x - v0x) / len;
  dx1 *= st.w; dy1 *= st.w;
  if (st.cap !== 'round') {
    let dx2 = 0, dy2 = 0;
    if (st.cap === 'square') { dx2 = dy1; dy2 = dx1; }
    vc.xs.push(v0x - dx1 - dx2, v0x + dx1 - dx2);
    vc.ys.push(v0y + dy1 - dy2, v0y - dy1 - dy2);
    return;
  }
  let da = Math.acos(st.wAbs / (st.wAbs + 0.125)) * 2;
  const n = Math.trunc(Math.PI / da);
  da = Math.PI / (n + 1);
  vc.xs.push(v0x - dx1); vc.ys.push(v0y + dy1);
  let a1 = Math.atan2(dy1, -dx1) + da;
  for (let i = 0; i < n; i++) { vc.xs.push(v0x + Math.cos(a1) * st.w); vc.ys.push(v0y + Math.sin(a1) * st.w); a1 += da; }
  vc.xs.push(v0x + dx1); vc.ys.push(v0y - dy1);
}

const INNER_MITER_LIMIT = 1.01;

function calcJoin(st: Stroker, vc: Out, v0x: number, v0y: number, v1x: number, v1y: number, v2x: number, v2y: number, len1: number, len2: number): void {
  const dx1 = st.w * (v1y - v0y) / len1, dy1 = st.w * (v1x - v0x) / len1;
  const dx2 = st.w * (v2y - v1y) / len2, dy2 = st.w * (v2x - v1x) / len2;
  vc.xs.length = 0; vc.ys.length = 0;
  const cp = cross(v0x, v0y, v1x, v1y, v2x, v2y);
  if (cp > EPS && st.w > 0) {
    let limit = (len1 < len2 ? len1 : len2) / st.wAbs;
    if (limit < INNER_MITER_LIMIT) limit = INNER_MITER_LIMIT;
    calcMiter(st, vc, v0x, v0y, v1x, v1y, v2x, v2y, dx1, dy1, dx2, dy2, 'miterRevert', limit, 0);
    return;
  }
  const mx = (dx1 + dx2) / 2, my = (dy1 + dy2) / 2;
  const dbevel = Math.sqrt(mx * mx + my * my);
  if ((st.join === 'round' || st.join === 'bevel') && st.wAbs - dbevel < st.wEps) {
    if (intersect(v0x + dx1, v0y - dy1, v1x + dx1, v1y - dy1, v1x + dx2, v1y - dy2, v2x + dx2, v2y - dy2, P)) { vc.xs.push(P.x); vc.ys.push(P.y); }
    else { vc.xs.push(v1x + dx1); vc.ys.push(v1y - dy1); }
    return;
  }
  switch (st.join) {
    case 'miter': case 'miterRevert':
      calcMiter(st, vc, v0x, v0y, v1x, v1y, v2x, v2y, dx1, dy1, dx2, dy2, st.join, st.miterLimit, dbevel); return;
    case 'round': calcArc(st, vc, v1x, v1y, dx1, -dy1, dx2, -dy2); return;
    case 'bevel': vc.xs.push(v1x + dx1, v1x + dx2); vc.ys.push(v1y - dy1, v1y - dy2); return;
    default: assertNever(st.join);
  }
}

// ------------------------------------------------------------------ vcgen_stroke
function emit(vc: Out, sink: PathSink, first: { v: boolean }): void {
  for (let i = 0; i < vc.xs.length; i++) {
    if (first.v) { sink.moveTo(vc.xs[i], vc.ys[i]); first.v = false; } else sink.lineTo(vc.xs[i], vc.ys[i]);
  }
}

/** One subpath through vcgen_stroke: the outline polygon(s) into the sink. */
function strokeSeq(st: Stroker, v: VSeq, closedIn: boolean, sink: PathSink): void {
  v.close(closedIn);
  const n = v.size;
  const closed = n < 3 ? false : closedIn;
  if (n < 2 + (closed ? 1 : 0)) return;
  const vc: Out = { xs: [], ys: [] };
  const X = v.xs, Y = v.ys, D = v.ds;
  const prev = (i: number): number => (i + n - 1) % n, next = (i: number): number => (i + 1) % n;
  const first = { v: true };
  let i: number;
  if (!closed) {
    calcCap(st, vc, X[0], Y[0], X[1], Y[1], D[0]); emit(vc, sink, first);
    for (i = 1; i < n - 1; i++) { calcJoin(st, vc, X[prev(i)], Y[prev(i)], X[i], Y[i], X[next(i)], Y[next(i)], D[prev(i)], D[i]); emit(vc, sink, first); }
    calcCap(st, vc, X[n - 1], Y[n - 1], X[n - 2], Y[n - 2], D[n - 2]); emit(vc, sink, first);
    for (i = n - 2; i >= 1; i--) { calcJoin(st, vc, X[next(i)], Y[next(i)], X[i], Y[i], X[prev(i)], Y[prev(i)], D[i], D[prev(i)]); emit(vc, sink, first); }
    sink.close();
    return;
  }
  for (i = 0; i < n; i++) { calcJoin(st, vc, X[prev(i)], Y[prev(i)], X[i], Y[i], X[next(i)], Y[next(i)], D[prev(i)], D[i]); emit(vc, sink, first); }
  sink.close();
  first.v = true;
  for (i = n - 1; i >= 0; i--) { calcJoin(st, vc, X[next(i)], Y[next(i)], X[i], Y[i], X[prev(i)], Y[prev(i)], D[i], D[prev(i)]); emit(vc, sink, first); }
  sink.close();
}

/** Stroke flattened subpaths (conv_adaptor_vcgen<vcgen_stroke>). */
export function strokePath(subs: readonly Sub[], st: Stroker, sink: PathSink): void {
  for (const s of subs) {
    const v = new VSeq();
    v.modifyLast(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) v.add(s.xs[i], s.ys[i]);
    strokeSeq(st, v, s.closed, sink);
  }
}

// ------------------------------------------------------------------ vcgen_dash
/**
 * conv_dash: each subpath is cut into dashes; returns open subpaths for the stroker.
 * pattern alternates on/off lengths in px; offset is dash_start.
 */
export function dashPath(subs: readonly Sub[], pattern: readonly number[], offset: number): Sub[] {
  const dashes = pattern.length % 2 === 0 ? pattern : [...pattern, ...pattern];
  const nd = dashes.length;
  const out: Sub[] = [];
  if (nd < 2) return out;
  let total = 0;
  for (const d of dashes) total += d;
  if (!(total > 0)) return [...subs];
  let curDash = 0, curStart = 0;
  const calcStart = (ds0: number): void => {
    let ds = ds0;
    curDash = 0; curStart = 0;
    while (ds > 0) {
      if (ds > dashes[curDash]) { ds -= dashes[curDash]; curDash++; curStart = 0; if (curDash >= nd) curDash = 0; }
      else { curStart = ds; ds = 0; }
    }
  };
  calcStart(Math.abs(offset));
  for (const s of subs) {
    const v = new VSeq();
    v.modifyLast(s.xs[0], s.ys[0]);
    for (let i = 1; i < s.xs.length; i++) v.add(s.xs[i], s.ys[i]);
    v.close(s.closed);
    const n = v.size;
    if (n < 2) continue;
    // the generator emits move_to/line_to; the stroke adaptor splits at every move_to
    let cur: Sub = { xs: [v.xs[0]], ys: [v.ys[0]], closed: false };
    const moveTo = (x: number, y: number): void => { if (cur.xs.length > 1) out.push(cur); cur = { xs: [x], ys: [y], closed: false }; };
    const lineTo = (x: number, y: number): void => { cur.xs.push(x); cur.ys.push(y); };
    let srcV = 1, i1 = 0, i2 = 1;
    let rest = v.ds[i1];
    if (offset >= 0) calcStart(offset);
    for (;;) {
      const dashRest = dashes[curDash] - curStart;
      const isMove = (curDash & 1) === 1;
      let x: number, y: number, stop = false;
      if (rest > dashRest) {
        rest -= dashRest;
        curDash++; if (curDash >= nd) curDash = 0;
        curStart = 0;
        x = v.xs[i2] - (v.xs[i2] - v.xs[i1]) * rest / v.ds[i1];
        y = v.ys[i2] - (v.ys[i2] - v.ys[i1]) * rest / v.ds[i1];
      } else {
        curStart += rest;
        x = v.xs[i2]; y = v.ys[i2];
        srcV++;
        i1 = i2;
        rest = v.ds[i1];
        if (s.closed) { if (srcV > n) stop = true; else i2 = srcV >= n ? 0 : srcV; }
        else if (srcV >= n) stop = true; else i2 = srcV;
      }
      if (isMove) moveTo(x, y); else lineTo(x, y);
      if (stop) break;
    }
    if (cur.xs.length > 1) out.push(cur);
  }
  return out;
}
