// Artists -> scene nodes, plus what loc='best' needs to avoid. Plan/apply:
// one typed-array transform pass; everything after is bounded by pixels.
import type { Frame } from './frame.ts';
import { tx, ty } from './frame.ts';
import type { Box } from './legend-index.ts';
import { lineStroke, markersNode } from './marks.ts';
import type { XY } from './path.ts';
import { isRectilinear, simplifyPolyline } from './path.ts';
import { inkOf, rectNode, snap, snapOffset } from './scene.ts';
import { lookup } from './std.ts';
import { forwardAll } from './scale.ts';
import type { BarArtist, Clip, FillArtist, Handle, LineArtist, Node, Option, Seg, Stroke, TextArtist, Theme, ScatterArtist, SpanArtist, AnnotationArtist, Paint } from './types.ts';
import { labelNodes } from './draw-axis.ts';
import { placeText, pxPerPt } from './text.ts';
import type { Face } from './fonts.ts';
import { resolveFace } from './fonts.ts';
import { none, some } from './types.ts';
import type { SpanHandle } from '../trace.ts';

export type Drawn = { readonly nodes: readonly Node[]; readonly lines: readonly XY[]; readonly boxes: readonly Box[]; readonly handle: Option<Handle> };

/** Scale transform (one pass per axis; identity for linear), then the affine map to device px. */
function transform(a: LineArtist, f: Frame): { readonly xs: Float64Array; readonly ys: Float64Array; readonly ysUp: Float64Array } {
  const n = Math.min(a.x.length, a.y.length);
  const xs = new Float64Array(n), ys = new Float64Array(n), ysUp = new Float64Array(n);
  const dx = forwardAll(f.xscale, a.x), dy = forwardAll(f.yscale, a.y);
  // Agg folds the y flip into the affine (trans_affine::multiply): y_dev = y·(−ay) + (H − cy).
  const ax = f.ax, cx = f.cx, ay = f.ay, cy = f.cy, nay = -f.ay, tyDev = f.H - f.cy;
  for (let i = 0; i < n; i++) {
    xs[i] = dx[i] * ax + cx; ys[i] = dy[i] * nay + tyDev; ysUp[i] = dy[i] * ay + cy;
  }
  return { xs, ys, ysUp };
}

export function drawLine(a: LineArtist, f: Frame, theme: Theme, k: number, clip: Clip, span: SpanHandle): Drawn {
  const { xs, ys, ysUp } = transform(a, f);
  const nodes: Node[] = [];
  if (a.stroke.kind === 'on' && xs.length > 0) {
    const stroke = lineStroke(theme, a.stroke.color, a.stroke.widthPt, a.stroke.style, k);
    let px = xs, py = ys;
    if (isRectilinear(xs, ys)) {
      px = xs.map((v) => snap(v, stroke.width)); py = ys.map((v) => snap(v, stroke.width));
    } else if (theme.simplify.kind === 'on' && xs.length >= 128) {   // Path.should_simplify
      const s = simplifyPolyline(xs, ys, theme.simplify.thresholdPx);
      px = s.xs; py = s.ys;
      span.setAttribute('simplified', px.length);
    }
    if (stroke.color.alpha > 0) nodes.push({ kind: 'polyline', xs: px, ys: py, stroke });
  }
  if (a.markers.kind === 'on') {
    const m = markersNode(a.markers, xs, ys, k);
    if (m.kind === 'some') { nodes.push(m.value); span.setAttribute('markerCount', m.value.kind === 'markers' ? m.value.xs.length : 0); }
  }
  return {
    nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [],
    lines: [{ xs, ys: ysUp }], boxes: [],
    handle: some({ kind: 'line', stroke: a.stroke, markers: a.markers }),
  };
}

type Pending = { readonly x: number; readonly w: number; y: number; h: number; readonly i: number };

export function drawBar(a: BarArtist, f: Frame, k: number, clip: Clip, span: SpanHandle): Drawn {
  const stroke: Option<Stroke> = a.edge.kind === 'on'
    ? some({ color: a.edge.color, width: a.edge.widthPt * k, cap: 'butt', join: 'miter', dash: { kind: 'solid' } })
    : none;
  const lw = stroke.kind === 'some' ? stroke.value.width : 0;
  // Exact culling for opaque, unstroked bars of one colour: zero-area rects draw nothing; a rect
  // nested inside another in the same snapped column is fully covered.
  const f0 = a.face;
  const uniform = a.faces.every((p) => p.kind === f0.kind && (p.kind !== 'solid' || (f0.kind === 'solid' && p.color.hex === f0.color.hex && p.color.alpha === f0.color.alpha)));
  const cullable = stroke.kind === 'none' && uniform && f0.kind === 'solid' && f0.color.alpha === 1;
  const columns = new Map<number, Pending[]>();
  const kept: Pending[] = [];
  const boxes: Box[] = [];
  for (let i = 0; i < a.x.length; i++) {
    const xa = tx(f, a.x[i]), xb = tx(f, a.x[i] + a.w[i]), ya = ty(f, a.y[i]), yb = ty(f, a.y[i] + a.h[i]);
    boxes.push({ x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: f.H - Math.max(ya, yb), y1: f.H - Math.min(ya, yb) });
    const x0 = snap(Math.min(xa, xb), lw), x1 = snap(Math.max(xa, xb), lw);
    const y0 = snap(Math.min(ya, yb), lw), y1 = snap(Math.max(ya, yb), lw);
    const r: Pending = { x: x0, w: x1 - x0, y: y0, h: y1 - y0, i };
    if (cullable) {
      if (r.w <= 0 || r.h <= 0) continue;
      const key = x0 * 1048576 + x1;
      const found = lookup(columns, key);
      const col: Pending[] = found.kind === 'some' ? found.value : [];
      if (found.kind === 'none') columns.set(key, col);
      if (col.findIndex((c) => c.y <= y0 && c.y + c.h >= y1) >= 0) continue;          // covered by an earlier bar
      const inner = col.findIndex((c) => y0 <= c.y && y1 >= c.y + c.h);
      if (inner >= 0) { col[inner].y = y0; col[inner].h = y1 - y0; continue; }       // covers an earlier bar: grow it in place
      col.push(r);
    }
    kept.push(r);
  }
  span.setAttribute('emitted', kept.length);
  const rects = kept.flatMap((r) => { const ink = inkOf(a.faces[r.i], stroke); return ink.kind === 'some' ? [rectNode(r.x, r.y, r.w, r.h, ink.value)] : []; });
  const nodes: readonly Node[] = rects.length > 0 ? [{ kind: 'group', clip, nodes: rects, tag: '' }] : [];   // patches clip to the axes, as lines do
  return { nodes, lines: [], boxes, handle: some({ kind: 'patch', face: a.face, edge: a.edge }) };
}

/**
 * fill_between as FillBetweenPolyCollection builds it: [start, (x, y1)…, end, (x, y2) reversed],
 * closed. Vertices go through the same folded affine as lines; Agg fills with the non-zero rule.
 */
export function drawFill(a: FillArtist, f: Frame, k: number, clip: Clip): Drawn {
  const n = Math.min(a.x.length, a.y1.length, a.y2.length);
  const handle = some<Handle>({ kind: 'patch', face: a.face, edge: a.edge });
  // GraphicsContext defaults for collections: butt caps, round joins
  const stroke: Option<Stroke> = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: a.edge.widthPt * k, cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (n === 0 || ink.kind === 'none') return { nodes: [], lines: [], boxes: [], handle };
  // Two code paths in Collection.draw. With edges (a single edge color), the single-path
  // optimization draws the polygon with draw_markers: one "marker" at offset (0, 0), which Agg
  // places at pixel (0, H), its path shifted by (0.5, 0.5) since a curvy polygon doesn't snap.
  // Without edges (edgecolor 'none' is an empty array) it goes through draw_path_collection,
  // i.e. an ordinary path: y = y·(−ay) + (H − cy).
  const asMarker = a.edge.kind === 'on';
  const X = forwardAll(f.xscale, a.x), Y1 = forwardAll(f.yscale, a.y1), Y2 = forwardAll(f.yscale, a.y2);
  const ty0 = asMarker ? -f.cy : f.H - f.cy, nay = -f.ay;
  const ptsX: number[] = [X[0] * f.ax + f.cx], ptsY: number[] = [Y2[0] * nay + ty0];
  const push = (x: number, y: number): void => { ptsX.push(x * f.ax + f.cx); ptsY.push(y * nay + ty0); };
  for (let i = 0; i < n; i++) push(X[i], Y1[i]);
  push(X[n - 1], Y2[n - 1]);
  for (let i = n - 1; i >= 0; i--) push(X[i], Y2[i]);
  // PathSnapper, SNAP_AUTO: a path of ≤ 1024 vertices (with the close) whose segments are all
  // axis-aligned within 1e-4 px snaps to floor(v + 0.5) + (odd rounded stroke width ? 0.5 : 0).
  // An edgeless collection snaps as width 0 (fixtures fill_rect_snap at 100 and 150 dpi). An
  // unsnapped path through draw_markers takes the plain +0.5 shift.
  let rectilinear = ptsX.length + 1 <= 1024;
  for (let i = 1; i < ptsX.length && rectilinear; i++) rectilinear = Math.abs(ptsX[i] - ptsX[i - 1]) < 1e-4 || Math.abs(ptsY[i] - ptsY[i - 1]) < 1e-4;
  const off = a.edge.kind === 'on' ? snapOffset(a.edge.widthPt * k) : 0;
  const fix = (v: number): number => (rectilinear ? Math.floor(v + 0.5) + off : asMarker ? v + 0.5 : v);
  const segs: Seg[] = ptsX.map((x, i): Seg => [i === 0 ? 'M' : 'L', fix(x), fix(ptsY[i])]);
  segs.push(['Z']);
  const up = new Float64Array(2 * n), xs = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) { xs[i] = X[i] * f.ax + f.cx; up[i] = Y1[i] * f.ay + f.cy; xs[n + i] = X[n - 1 - i] * f.ax + f.cx; up[n + i] = Y2[n - 1 - i] * f.ay + f.cy; }
  const node: Node = asMarker
    ? { kind: 'markers', shape: segs, xs: Float64Array.of(0), ys: Float64Array.of(f.H), ink: ink.value }
    : { kind: 'path', segs, ink: ink.value };
  return { nodes: [{ kind: 'group', clip, nodes: [node], tag: '' }], lines: [{ xs, ys: up }], boxes: [], handle };
}

/** ax.text: position through transData or transAxes (Python-side, then flipped), laid out like Text. */
export function drawText(a: TextArtist, f: Frame, dpi: number, face: Face): Drawn {
  const k = pxPerPt(dpi);
  const x = a.coords === 'data' ? tx(f, a.x) : a.x * f.box.w + f.box.x0;
  const y = a.coords === 'data' ? ty(f, a.y) : f.H - (a.y * f.box.h + (f.H - f.box.yBot));
  const nodes = a.text === '' ? [] : labelNodes(placeText(a.text, a.sizePt, dpi, face, x, y, { kind: 'horizontal', ha: a.ha, va: a.va }), k, a.color);
  return { nodes, lines: [], boxes: [], handle: none };
}

/** ax.annotate: straight leader line with triangular head into (x, y), plus text at (tx, ty). */
export function drawAnnotation(a: AnnotationArtist, f: Frame, dpi: number, theme: Theme, k: number, clip: Clip): Drawn {
  const toPx = (cx: 'data' | 'axes', x: number, y: number): readonly [number, number] =>
    (cx === 'data' ? [tx(f, x), ty(f, y)] as const : [f.box.x0 + x * f.box.w, f.H - (f.box.yBot + y * f.box.h)] as const);
  const [x0, y0] = toPx(a.xycoords, a.x, a.y);
  const [x1, y1] = toPx(a.textcoords, a.tx, a.ty);
  // Shrink at both ends by 2 pt each, as FancyArrowPatch default shrinkA/B ~ 2 (points).
  const shrinkPx = 2 * k;
  const dx0 = x0 - x1, dy0 = y0 - y1;
  const L0 = Math.hypot(dx0, dy0) || 1;
  const ux0 = dx0 / L0, uy0 = dy0 / L0;
  const sx0 = x0 - ux0 * shrinkPx, sy0 = y0 - uy0 * shrinkPx;
  const tx0 = x1 + ux0 * shrinkPx, ty0 = y1 + uy0 * shrinkPx;
  const dx = sx0 - tx0, dy = sy0 - ty0;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const shaftEndX = sx0 - ux * (a.arrow.headLengthPt * k);
  const shaftEndY = sy0 - uy * (a.arrow.headLengthPt * k);
  const halfW = (a.arrow.headWidthPt * k) / 2;
  const nx = -uy, ny = ux;
  const headP1x = sx0, headP1y = sy0;
  const headP2x = shaftEndX + nx * halfW, headP2y = shaftEndY + ny * halfW;
  const headP3x = shaftEndX - nx * halfW, headP3y = shaftEndY - ny * halfW;
  const stroke: Stroke = { color: a.arrow.color, width: a.arrow.widthPt * k, cap: 'butt', join: 'miter', dash: { kind: 'solid' } };
  const segs: Seg[] = [['M', tx0, ty0], ['L', shaftEndX, shaftEndY]];
  const head: Seg[] = [['M', headP1x, headP1y], ['L', headP2x, headP2y], ['L', headP3x, headP3y], ['Z']];
  const lineNode: Node = { kind: 'path', segs, ink: { kind: 'stroke', stroke } };
  const headNode: Node = { kind: 'path', segs: head, ink: { kind: 'fill', fill: a.arrow.color } };
  const face = resolveFace(theme.font.families, a.weight);
  const textNodes = a.text === '' ? [] : labelNodes(placeText(a.text, a.sizePt, dpi, face, x1, y1, { kind: 'horizontal', ha: a.ha, va: a.va }), k, a.color);
  const nodes: readonly Node[] = [{ kind: 'group', clip, nodes: [lineNode, headNode, ...textNodes], tag: '' }];
  return { nodes, lines: [], boxes: [], handle: none };
}

/** ax.scatter: markers-only collection with sizes in pt^2. */
export function drawScatter(a: ScatterArtist, f: Frame, _theme: Theme, k: number, clip: Clip): Drawn {
  const n = Math.min(a.x.length, a.y.length, a.sizePt2.length);
  if (n === 0) return { nodes: [], lines: [], boxes: [], handle: some({ kind: 'line', stroke: { kind: 'none' }, markers: { kind: 'none' } }) };
  const xs = new Float64Array(n), ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = tx(f, a.x[i]); ys[i] = ty(f, a.y[i]); }
  // Group by (size, face, edge) to support per-point sizes and colours
  type Key = string;
  const keyOf = (i: number): Key => {
    const sPt = Math.max(0, a.sizePt2[i]);
    const size = Math.sqrt(sPt);
    const face = a.faces[i];
    const edge = a.edges[i];
    const fc = face.kind === 'solid' ? `${face.color.hex}/${face.color.alpha}` : 'none';
    const ec = edge.kind === 'solid' ? `${edge.color.hex}/${edge.color.alpha}` : 'none';
    return `${size.toFixed(4)}|${fc}|${ec}`;
  };
  const groups = new Map<Key, { sizePt: number; face: Paint; edge: Paint; xs: number[]; ys: number[] }>();
  for (let i = 0; i < n; i++) {
    const sPt2 = Math.max(0, a.sizePt2[i]);
    const sizePt = Math.sqrt(sPt2);   // points
    const kkey = keyOf(i);
    const g = groups.get(kkey);
    if (!g) {
      groups.set(kkey, { sizePt, face: a.faces[i], edge: a.edges[i], xs: [xs[i]], ys: [ys[i]] });
    } else {
      g.xs.push(xs[i]); g.ys.push(ys[i]);
    }
  }
  const nodes: Node[] = [];
  for (const g of groups.values()) {
    const stroke: Option<Stroke> = g.edge.kind === 'solid' && a.edgeWidthPt > 0 ? some({ color: g.edge.color, width: a.edgeWidthPt * k, cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
    const ink = inkOf(g.face, stroke);
    if (ink.kind === 'none') continue;
    const m = markersNode({ kind: 'on', shape: a.shape, sizePt: g.sizePt, edgeWidthPt: a.edgeWidthPt, face: g.face, edge: g.edge },
                          Float64Array.from(g.xs), Float64Array.from(g.ys), k, true);  // PathCollection: no snapping, draw_markers offset
    if (m.kind === 'some') nodes.push(m.value);
  }
  const out: readonly Node[] = nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [];
  return { nodes: out, lines: [], boxes: [], handle: some({ kind: 'line', stroke: { kind: 'none' }, markers: { kind: 'none' } }) };
}

/** axvspan / axhspan: spans in data × axes-fraction coordinates. */
export function drawSpan(a: SpanArtist, f: Frame, k: number, clip: Clip): Drawn {
  const stroke: Option<Stroke> = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: a.edge.widthPt * k, cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (ink.kind === 'none') return { nodes: [], lines: [], boxes: [], handle: some({ kind: 'patch', face: a.face, edge: a.edge }) };
  const off = stroke.kind === 'some' ? snapOffset(stroke.value.width) : 0;
  if (a.orientation === 'vertical') {
    const x0 = tx(f, a.a0), x1 = tx(f, a.a1);
    const y0 = f.H - (a.f0 * f.box.h + (f.H - f.box.yBot)), y1 = f.H - (a.f1 * f.box.h + (f.H - f.box.yBot));
    const X0 = Math.floor(Math.min(x0, x1) + 0.5) + off, X1 = Math.floor(Math.max(x0, x1) + 0.5) + off;
    const Y0 = Math.floor(Math.min(y0, y1) + 0.5) + off, Y1 = Math.floor(Math.max(y0, y1) + 0.5) + off;
    const rect = rectNode(X0, Y0, X1 - X0, Y1 - Y0, ink.value);
    return { nodes: [{ kind: 'group', clip, nodes: [rect], tag: '' }], lines: [], boxes: [], handle: some({ kind: 'patch', face: a.face, edge: a.edge }) };
  } else {
    const y0 = ty(f, a.a0), y1 = ty(f, a.a1);
    const x0 = a.f0 * f.box.w + f.box.x0, x1 = a.f1 * f.box.w + f.box.x0;
    const X0 = Math.floor(Math.min(x0, x1) + 0.5) + off, X1 = Math.floor(Math.max(x0, x1) + 0.5) + off;
    const Y0 = Math.floor(Math.min(y0, y1) + 0.5) + off, Y1 = Math.floor(Math.max(y0, y1) + 0.5) + off;
    const rect = rectNode(X0, Y0, X1 - X0, Y1 - Y0, ink.value);
    return { nodes: [{ kind: 'group', clip, nodes: [rect], tag: '' }], lines: [], boxes: [], handle: some({ kind: 'patch', face: a.face, edge: a.edge }) };
  }
}
