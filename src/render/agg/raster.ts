// Anti-aliased polygon rasterizer: a port of Agg 2.4's rasterizer_scanline_aa with
// rasterizer_sl_clip<ras_conv_dbl> and rasterizer_cells_aa, as vendored by matplotlib.
//
// Same arithmetic, different storage. Agg keeps a sorted list of cells and sums
// duplicates during the sweep; here cells accumulate into a dense bbox-sized
// cover/area grid. Summation is commutative, so the coverage is identical.
// Two passes (plan/apply): segments are clipped and collected first so the grid
// is sized to their bounding box, then walked once.

/** Integer pixel box, half-open: [x0, x1) × [y0, y1). */
export type IBox = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
/**
 * Coverage as Agg's packed scanlines: per row, runs of constant 8-bit alpha. Row r's runs
 * are [rows[r], rows[r+1]) in sx (column, relative to x0), sl (length), sv (alpha > 0).
 * Size is O(outline), not O(area): a full-canvas rectangle is one run per row.
 */
export type Coverage = {
  readonly x0: number; readonly y0: number; readonly w: number; readonly h: number;
  readonly rows: Int32Array; readonly sx: Int32Array; readonly sl: Int32Array; readonly sv: Uint8Array;
};

/** Run-length encode a dense alpha mask (glyph bitmaps). */
export function denseCoverage(x0: number, y0: number, w: number, h: number, a: Uint8Array): Coverage {
  const rows = new Int32Array(h + 1), sx: number[] = [], sl: number[] = [], sv: number[] = [];
  for (let r = 0; r < h; r++) {
    rows[r] = sx.length;
    for (let c = 0; c < w;) {
      const v = a[r * w + c];
      let e = c + 1;
      while (e < w && a[r * w + e] === v) e++;
      if (v !== 0) { sx.push(c); sl.push(e - c); sv.push(v); }
      c = e;
    }
  }
  rows[h] = sx.length;
  return { x0, y0, w, h, rows, sx: Int32Array.from(sx), sl: Int32Array.from(sl), sv: Uint8Array.from(sv) };
}
export type FillRule = 'nonzero' | 'evenodd';

export const EMPTY: Coverage = { x0: 0, y0: 0, w: 0, h: 0, rows: new Int32Array(1), sx: new Int32Array(0), sl: new Int32Array(0), sv: new Uint8Array(0) };

const SHIFT = 8, SCALE = 256, MASK = 255;
const DX_LIMIT = 16384 << SHIFT;
const iround = (v: number): number => (v < 0 ? Math.trunc(v - 0.5) : Math.trunc(v + 0.5));
const xi = (v: number): number => iround(v * SCALE);

/** Growable int32 segment list (x1, y1, x2, y2 in 1/256 px). */
type Segs = { buf: Int32Array; n: number };
function pushSeg(s: Segs, x1: number, y1: number, x2: number, y2: number): void {
  if (s.n + 4 > s.buf.length) { const b = new Int32Array(s.buf.length * 2); b.set(s.buf); s.buf = b; }
  s.buf[s.n] = x1; s.buf[s.n + 1] = y1; s.buf[s.n + 2] = x2; s.buf[s.n + 3] = y2; s.n += 4;
}

/**
 * Path sink with Agg semantics: move_to auto-closes the previous contour, close
 * returns to the contour start, and every edge is clipped (in doubles, pixel units)
 * against the clip box exactly as rasterizer_sl_clip does before conversion to
 * 24.8 fixed point.
 */
export class Rasterizer {
  private readonly segs: Segs = { buf: new Int32Array(1024), n: 0 };
  private cx0: number; private cy0: number; private cx1: number; private cy1: number;
  private x1 = 0; private y1 = 0; private f1 = 0;
  private sx = 0; private sy = 0;
  private status: 0 | 1 | 2 | 3 = 0;   // initial | move_to | line_to | closed

  constructor(clip: IBox) { this.cx0 = clip.x0; this.cy0 = clip.y0; this.cx1 = clip.x1; this.cy1 = clip.y1; }

  reset(clip: IBox): void {
    this.segs.n = 0; this.status = 0;
    this.cx0 = clip.x0; this.cy0 = clip.y0; this.cx1 = clip.x1; this.cy1 = clip.y1;
  }

  private flags(x: number, y: number): number {
    return (x > this.cx1 ? 1 : 0) | (y > this.cy1 ? 2 : 0) | (x < this.cx0 ? 4 : 0) | (y < this.cy0 ? 8 : 0);
  }
  private flagsY(y: number): number { return (y > this.cy1 ? 2 : 0) | (y < this.cy0 ? 8 : 0); }

  moveTo(x: number, y: number): void {
    this.close();
    this.sx = x; this.sy = y;
    this.x1 = x; this.y1 = y; this.f1 = this.flags(x, y);
    this.status = 1;
  }

  lineTo(x2: number, y2: number): void {
    this.clipLine(x2, y2);
    this.status = 2;
  }

  close(): void {
    if (this.status === 2) { this.clipLine(this.sx, this.sy); this.status = 3; }
  }

  private lineY(x1: number, y1: number, x2: number, y2: number, f1: number, f2: number): void {
    f1 &= 10; f2 &= 10;
    if ((f1 | f2) === 0) { this.emit(xi(x1), xi(y1), xi(x2), xi(y2)); return; }
    if (f1 === f2) return;
    let tx1 = x1, ty1 = y1, tx2 = x2, ty2 = y2;
    if (f1 & 8) { tx1 = x1 + (this.cy0 - y1) * (x2 - x1) / (y2 - y1); ty1 = this.cy0; }
    if (f1 & 2) { tx1 = x1 + (this.cy1 - y1) * (x2 - x1) / (y2 - y1); ty1 = this.cy1; }
    if (f2 & 8) { tx2 = x1 + (this.cy0 - y1) * (x2 - x1) / (y2 - y1); ty2 = this.cy0; }
    if (f2 & 2) { tx2 = x1 + (this.cy1 - y1) * (x2 - x1) / (y2 - y1); ty2 = this.cy1; }
    this.emit(xi(tx1), xi(ty1), xi(tx2), xi(ty2));
  }

  private clipLine(x2: number, y2: number): void {
    const f2 = this.flags(x2, y2);
    const f1 = this.f1, x1 = this.x1, y1 = this.y1;
    if ((f1 & 10) === (f2 & 10) && (f1 & 10) !== 0) { this.x1 = x2; this.y1 = y2; this.f1 = f2; return; }
    const X0 = this.cx0, X1 = this.cx1;
    const at = (cx: number): number => y1 + (cx - x1) * (y2 - y1) / (x2 - x1);
    switch (((f1 & 5) << 1) | (f2 & 5)) {
      case 0: this.lineY(x1, y1, x2, y2, f1, f2); break;
      case 1: { const y3 = at(X1), f3 = this.flagsY(y3); this.lineY(x1, y1, X1, y3, f1, f3); this.lineY(X1, y3, X1, y2, f3, f2); break; }
      case 2: { const y3 = at(X1), f3 = this.flagsY(y3); this.lineY(X1, y1, X1, y3, f1, f3); this.lineY(X1, y3, x2, y2, f3, f2); break; }
      case 3: this.lineY(X1, y1, X1, y2, f1, f2); break;
      case 4: { const y3 = at(X0), f3 = this.flagsY(y3); this.lineY(x1, y1, X0, y3, f1, f3); this.lineY(X0, y3, X0, y2, f3, f2); break; }
      case 6: {
        const y3 = at(X1), y4 = at(X0), f3 = this.flagsY(y3), f4 = this.flagsY(y4);
        this.lineY(X1, y1, X1, y3, f1, f3); this.lineY(X1, y3, X0, y4, f3, f4); this.lineY(X0, y4, X0, y2, f4, f2); break;
      }
      case 8: { const y3 = at(X0), f3 = this.flagsY(y3); this.lineY(X0, y1, X0, y3, f1, f3); this.lineY(X0, y3, x2, y2, f3, f2); break; }
      case 9: {
        const y3 = at(X0), y4 = at(X1), f3 = this.flagsY(y3), f4 = this.flagsY(y4);
        this.lineY(X0, y1, X0, y3, f1, f3); this.lineY(X0, y3, X1, y4, f3, f4); this.lineY(X1, y4, X1, y2, f4, f2); break;
      }
      case 12: this.lineY(X0, y1, X0, y2, f1, f2); break;
      default: throw new Error('clip flags: x cannot be both left and right of the box');
    }
    this.f1 = f2; this.x1 = x2; this.y1 = y2;
  }

  private emit(x1: number, y1: number, x2: number, y2: number): void { pushSeg(this.segs, x1, y1, x2, y2); }

  /** Close, accumulate every segment into a bbox grid, and sweep to coverage. */
  sweep(rule: FillRule): Coverage {
    this.close();
    const s = this.segs.buf, n = this.segs.n;
    if (n === 0) return EMPTY;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < n; i += 2) {
      const ex = s[i] >> SHIFT, ey = s[i + 1] >> SHIFT;
      if (ex < minX) minX = ex; if (ex > maxX) maxX = ex;
      if (ey < minY) minY = ey; if (ey > maxY) maxY = ey;
    }
    // Cells live in [minX, maxX] × [minY, maxY]; the clip box bounds the visible part.
    const gx0 = Math.max(minX, this.cx0), gy0 = Math.max(minY, this.cy0);
    const gx1 = Math.min(maxX + 1, this.cx1), gy1 = Math.min(maxY + 1, this.cy1);
    if (gx1 <= gx0 || gy1 <= gy0) return EMPTY;
    const grid = new Grid(gx0, gy0, gx1 - gx0, gy1 - gy0);
    for (let i = 0; i < n; i += 4) line(grid, s[i], s[i + 1], s[i + 2], s[i + 3]);
    return grid.sweep(rule);
  }
}

/**
 * Sparse cells, as Agg keeps them: (x, y, cover, area), merged while consecutive
 * contributions hit the same cell (Agg's "current cell"), then bucketed by row and
 * sorted by x for the sweep. Work is O(outline · log), independent of filled area.
 * A cell left of the grid only contributes its cover (it sits at column 0 with area 0).
 */
const grow = (a: Int32Array): Int32Array<ArrayBuffer> => { const b = new Int32Array(a.length * 2); b.set(a); return b; };
let CX = new Int32Array(4096), CY = new Int32Array(4096), CC = new Int32Array(4096), CA = new Int32Array(4096);

class Grid {
  readonly x0: number; readonly y0: number; readonly w: number; readonly h: number;
  n = 0; private cx = 0x7fffffff; private cy = 0x7fffffff;
  constructor(x0: number, y0: number, w: number, h: number) { this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; }
  add(ex: number, ey: number, cover: number, area: number): void {
    const r = ey - this.y0;
    if (r < 0 || r >= this.h) return;
    let c = ex - this.x0;
    if (c >= this.w) return;
    if (c < 0) { c = 0; area = 0; }
    if (c === this.cx && r === this.cy) { CC[this.n - 1] += cover; CA[this.n - 1] += area; return; }
    if (this.n === CX.length) { CX = grow(CX); CY = grow(CY); CC = grow(CC); CA = grow(CA); }
    CX[this.n] = c; CY[this.n] = r; CC[this.n] = cover; CA[this.n] = area; this.n++;
    this.cx = c; this.cy = r;
  }
  sweep(rule: FillRule): Coverage {
    const { w, h, n } = this;
    // bucket by row (counting sort), then order each row by x
    const start = new Int32Array(h + 1);
    for (let i = 0; i < n; i++) start[CY[i] + 1]++;
    for (let r = 0; r < h; r++) start[r + 1] += start[r];
    const fill = start.slice(0, h), order = new Int32Array(n);
    for (let i = 0; i < n; i++) order[fill[CY[i]]++] = i;
    const evenOdd = rule === 'evenodd';
    const alpha = (v0: number): number => {
      let v = v0 >> (SHIFT * 2 + 1 - 8);
      if (v < 0) v = -v;
      if (evenOdd) { v &= 511; if (v > 256) v = 512 - v; }
      return v > 255 ? 255 : v;
    };
    const rows = new Int32Array(h + 1);
    let cap = Math.max(16, n * 2), m = 0;
    let sx = new Int32Array(cap), sl = new Int32Array(cap), sv = new Uint8Array(cap);
    const push = (x: number, len: number, v: number): void => {
      if (m === cap) {
        cap *= 2;
        const a = new Int32Array(cap); a.set(sx); sx = a;
        const b = new Int32Array(cap); b.set(sl); sl = b;
        const c = new Uint8Array(cap); c.set(sv); sv = c;
      }
      sx[m] = x; sl[m] = len; sv[m] = v; m++;
    };
    // per-row order by x: insertion sort (rows hold a handful of cells), typed sort for long rows
    let kx = new Int32Array(64), ki = new Int32Array(64), kf = new Float64Array(64);
    for (let r = 0; r < h; r++) {
      rows[r] = m;
      const a = start[r], k = start[r + 1] - a;
      if (k === 0) continue;
      if (kx.length < k) { kx = new Int32Array(k * 2); ki = new Int32Array(k * 2); kf = new Float64Array(k * 2); }
      if (k <= 48) {
        for (let j = 0; j < k; j++) {
          const i = order[a + j], x = CX[i];
          let t = j;
          while (t > 0 && (kx[t - 1] > x || (kx[t - 1] === x && ki[t - 1] > i))) { kx[t] = kx[t - 1]; ki[t] = ki[t - 1]; t--; }
          kx[t] = x; ki[t] = i;
        }
      } else {
        const ks = kf.subarray(0, k);
        for (let j = 0; j < k; j++) { const i = order[a + j]; ks[j] = CX[i] * 4194304 + i; }
        ks.sort();
        for (let j = 0; j < k; j++) { const i = ks[j] % 4194304; kx[j] = CX[i]; ki[j] = i; }
      }
      let cover = 0, j = 0;
      while (j < k) {
        const x = kx[j];
        let area = 0;
        while (j < k && kx[j] === x) { const i = ki[j]; cover += CC[i]; area += CA[i]; j++; }
        let next = x;
        if (area !== 0) { const v = alpha((cover << (SHIFT + 1)) - area); if (v !== 0) push(x, 1, v); next = x + 1; }
        const nx = j < k ? kx[j] : w;
        if (nx > next && cover !== 0) { const v = alpha(cover << (SHIFT + 1)); if (v !== 0) push(next, nx - next, v); }
      }
    }
    rows[h] = m;
    return { x0: this.x0, y0: this.y0, w, h, rows, sx: sx.subarray(0, m), sl: sl.subarray(0, m), sv: sv.subarray(0, m) };
  }
}

// rasterizer_cells_aa::render_hline. (cx, ey) is Agg's "current cell".
function renderHline(g: Grid, ey: number, x1: number, y1: number, x2: number, y2: number): void {
  let ex1 = x1 >> SHIFT;
  const ex2 = x2 >> SHIFT;
  const fx1 = x1 & MASK, fx2 = x2 & MASK;
  if (y1 === y2) return;
  if (ex1 === ex2) { const d = y2 - y1; g.add(ex1, ey, d, (fx1 + fx2) * d); return; }
  let p = (SCALE - fx1) * (y2 - y1), first = SCALE, incr = 1, dx = x2 - x1;
  if (dx < 0) { p = fx1 * (y2 - y1); first = 0; incr = -1; dx = -dx; }
  let delta = Math.trunc(p / dx), mod = p % dx;
  if (mod < 0) { delta--; mod += dx; }
  g.add(ex1, ey, delta, (fx1 + first) * delta);
  ex1 += incr;
  y1 += delta;
  if (ex1 !== ex2) {
    p = SCALE * (y2 - y1 + delta);
    let lift = Math.trunc(p / dx), rem = p % dx;
    if (rem < 0) { lift--; rem += dx; }
    mod -= dx;
    while (ex1 !== ex2) {
      delta = lift;
      mod += rem;
      if (mod >= 0) { mod -= dx; delta++; }
      g.add(ex1, ey, delta, SCALE * delta);
      y1 += delta;
      ex1 += incr;
    }
  }
  const d = y2 - y1;
  g.add(ex1, ey, d, (fx2 + SCALE - first) * d);
}

// rasterizer_cells_aa::line
function line(g: Grid, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  if (dx >= DX_LIMIT || dx <= -DX_LIMIT) {
    const cx = (x1 >> 1) + (x2 >> 1) + ((x1 & 1) & (x2 & 1));
    const cy = (y1 >> 1) + (y2 >> 1) + ((y1 & 1) & (y2 & 1));
    line(g, x1, y1, cx, cy); line(g, cx, cy, x2, y2);
    return;
  }
  let dy = y2 - y1;
  let ey1 = y1 >> SHIFT;
  const ey2 = y2 >> SHIFT;
  const fy1 = y1 & MASK, fy2 = y2 & MASK;
  if (ey1 === ey2) { renderHline(g, ey1, x1, fy1, x2, fy2); return; }
  let incr = 1;
  if (dx === 0) {
    const ex = x1 >> SHIFT;
    const twoFx = (x1 - (ex << SHIFT)) << 1;
    let first = SCALE;
    if (dy < 0) { first = 0; incr = -1; }
    let delta = first - fy1;
    g.add(ex, ey1, delta, twoFx * delta);
    ey1 += incr;
    delta = first + first - SCALE;
    const area = twoFx * delta;
    while (ey1 !== ey2) { g.add(ex, ey1, delta, area); ey1 += incr; }
    delta = fy2 - SCALE + first;
    g.add(ex, ey1, delta, twoFx * delta);
    return;
  }
  let p = (SCALE - fy1) * dx, first = SCALE;
  if (dy < 0) { p = fy1 * dx; first = 0; incr = -1; dy = -dy; }
  let delta = Math.trunc(p / dy), mod = p % dy;
  if (mod < 0) { delta--; mod += dy; }
  let xFrom = x1 + delta;
  renderHline(g, ey1, x1, fy1, xFrom, first);
  ey1 += incr;
  if (ey1 !== ey2) {
    p = SCALE * dx;
    let lift = Math.trunc(p / dy), rem = p % dy;
    if (rem < 0) { lift--; rem += dy; }
    mod -= dy;
    while (ey1 !== ey2) {
      delta = lift;
      mod += rem;
      if (mod >= 0) { mod -= dy; delta++; }
      const xTo = xFrom + delta;
      renderHline(g, ey1, xFrom, SCALE - first, xTo, first);
      xFrom = xTo;
      ey1 += incr;
    }
  }
  renderHline(g, ey1, xFrom, SCALE - first, x2, fy2);
}
