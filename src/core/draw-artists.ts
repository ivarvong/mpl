// Artists -> scene nodes, plus what loc='best' needs to avoid. Plan/apply:
// one typed-array transform pass; everything after is bounded by pixels.
import type { Frame } from './frame.ts';
import { tx, ty } from './frame.ts';
import type { Box } from './legend-index.ts';
import { lineStroke, markersNode } from './marks.ts';
import type { XY } from './path.ts';
import { isRectilinear, simplifyPolyline } from './path.ts';
import { inkOf, pathNode, rectNode, snap, snapOffset } from './scene.ts';
import { MARKERS } from './data/markers.ts';
import { yaArrowPath } from './arrow.ts';
import { lookup } from './std.ts';
import { forward, forwardAll } from './scale.ts';
import type { AxLineArtist, BarArtist, PolygonArtist, SegmentsArtist, Clip, FillArtist, Handle, LineArtist, Node, Option, Seg, Stroke, TextArtist, Theme, ScatterArtist, SpanArtist, AnnotationArtist, AnnotationCoords, Paint } from './types.ts';
import { labelNodes } from './draw-axis.ts';
import { placeText, pxPerPt, strokePx } from './text.ts';
import type { Face } from './fonts.ts';
import { resolveFace } from './fonts.ts';
import { assertNever, none, some } from './types.ts';
import { stepped } from './steps.ts';
import type { SpanHandle } from '../trace.ts';

export type Drawn = { readonly nodes: readonly Node[]; readonly lines: readonly XY[]; readonly boxes: readonly Box[]; readonly handle: Option<Handle> };

/** Scale transform (one pass per axis; identity for linear), then the affine map to device px. An axes-fraction
 *  coordinate (axhline's x, axvline's y) goes through transAxes instead: v·w + x0 (the blended transform's row). */
function transform(x: Float64Array, y: Float64Array, coords: LineArtist['coords'], f: Frame): { readonly xs: Float64Array; readonly ys: Float64Array; readonly ysUp: Float64Array } {
  const n = Math.min(x.length, y.length);
  const xs = new Float64Array(n), ys = new Float64Array(n), ysUp = new Float64Array(n);
  const dataX = coords.x === 'data', dataY = coords.y === 'data';
  const dx = dataX ? forwardAll(f.xscale, x) : x, dy = dataY ? forwardAll(f.yscale, y) : y;
  // Agg folds the y flip into the affine (trans_affine::multiply): y_dev = y·(−ay) + (H − cy).
  const ax = dataX ? f.ax : f.box.w, cx = dataX ? f.cx : f.box.x0;
  const ay = dataY ? f.ay : f.box.h, cy = dataY ? f.cy : f.box.b;
  const nay = -ay, tyDev = f.H - cy;
  for (let i = 0; i < n; i++) {
    xs[i] = dx[i] * ax + cx; ys[i] = dy[i] * nay + tyDev; ysUp[i] = dy[i] * ay + cy;
  }
  return { xs, ys, ysUp };
}

/** A Line2D stroke (already in device px): snapped when rectilinear, else simplified when long. */
function strokeNodes(xs: Float64Array, ys: Float64Array, stroke: Stroke, theme: Theme, span: SpanHandle): readonly Node[] {
  if (xs.length === 0 || stroke.color.alpha <= 0) return [];
  let px = xs, py = ys;
  if (isRectilinear(xs, ys)) {
    px = xs.map((v) => snap(v, stroke.width)); py = ys.map((v) => snap(v, stroke.width));
  } else if (theme.simplify.kind === 'on' && xs.length >= 128) {   // Path.should_simplify
    const s = simplifyPolyline(xs, ys, theme.simplify.thresholdPx);
    px = s.xs; py = s.ys;
    span.setAttribute('simplified', px.length);
  }
  return [{ kind: 'polyline', xs: px, ys: py, stroke }];
}

export function drawLine(a: LineArtist, f: Frame, theme: Theme, k: number, clip: Clip, span: SpanHandle): Drawn {
  // the stroke follows the drawstyle's step vertices; markers sit on the data points (Line2D.draw)
  const path = stepped(a.x, a.y, a.drawstyle);
  const line = transform(path.x, path.y, a.coords, f);
  const pts = a.drawstyle === 'default' ? line : transform(a.x, a.y, a.coords, f);
  const nodes: Node[] = [];
  if (a.stroke.kind === 'on') nodes.push(...strokeNodes(line.xs, line.ys, lineStroke(theme, a.stroke.color, a.stroke.widthPt, a.stroke.style, k), theme, span));
  if (a.markers.kind === 'on') {
    const m = markersNode(a.markers, pts.xs, pts.ys, k);
    if (m.kind === 'some') { nodes.push(m.value); span.setAttribute('markerCount', m.value.kind === 'markers' ? m.value.xs.length : 0); }
  }
  return {
    nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [],
    lines: [{ xs: line.xs, ys: line.ysUp }], boxes: [],
    handle: some({ kind: 'line', stroke: a.stroke, markers: a.markers }),
  };
}

/**
 * axline (lines.AxLine.get_transform): in scaled coordinates, intersect the line with the four view-limit
 * edges, sort the points and keep the middle two; Line2D's unit path [(0, 0), (1, 1)] maps onto them.
 */
export function drawAxLine(a: AxLineArtist, f: Frame, theme: Theme, k: number, clip: Clip, span: SpanHandle): Drawn {
  const handle = some<Handle>({ kind: 'line', stroke: a.stroke, markers: { kind: 'none' } });
  const x1 = forward(f.xscale, a.x1), y1 = forward(f.yscale, a.y1);
  let slope: number;
  if (a.through.kind === 'point') {
    const dx = forward(f.xscale, a.through.x2) - x1, dy = forward(f.yscale, a.through.y2) - y1;
    slope = dx === 0 ? Infinity : dy / dx;   // identical points are rejected by axline()
  } else slope = a.through.slope;
  const vxlo = forward(f.xscale, f.xlim[0]), vxhi = forward(f.xscale, f.xlim[1]);
  const vylo = forward(f.yscale, f.ylim[0]), vyhi = forward(f.yscale, f.ylim[1]);
  let start: readonly [number, number], stop: readonly [number, number];
  if (slope === 0) { start = [vxlo, y1]; stop = [vxhi, y1]; }
  else if (!Number.isFinite(slope)) { start = [x1, vylo]; stop = [x1, vyhi]; }
  else {
    const pts: (readonly [number, number])[] = [
      [vxlo, y1 + (vxlo - x1) * slope], [vxhi, y1 + (vxhi - x1) * slope],
      [x1 + (vylo - y1) / slope, vylo], [x1 + (vyhi - y1) / slope, vyhi],
    ];
    pts.sort((p, q) => (p[0] !== q[0] ? p[0] - q[0] : p[1] - q[1]));   // Python tuple order
    start = pts[1]; stop = pts[2];
  }
  const xs = Float64Array.of(start[0] * f.ax + f.cx, stop[0] * f.ax + f.cx);
  const ys = Float64Array.of(start[1] * -f.ay + (f.H - f.cy), stop[1] * -f.ay + (f.H - f.cy));
  const up = Float64Array.of(start[1] * f.ay + f.cy, stop[1] * f.ay + f.cy);
  const nodes = a.stroke.kind === 'on' ? strokeNodes(xs, ys, lineStroke(theme, a.stroke.color, a.stroke.widthPt, a.stroke.style, k), theme, span) : [];
  return { nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [], lines: [{ xs, ys: up }], boxes: [], handle };
}

/**
 * A LineCollection (Collection.draw). One solid segment takes the single-path optimization, draw_markers
 * with the segment as the marker at display (0, 0), i.e. pixel (0, H); otherwise draw_path_collection
 * strokes each segment with its own colour and dashes, in order. Either way Agg's PathSnapper snaps
 * an axis-aligned segment to floor(v + 0.5) + (odd width ? 0.5 : 0). GC defaults: butt caps, round joins.
 */
export function drawSegments(a: SegmentsArtist, f: Frame, theme: Theme, k: number, clip: Clip): Drawn {
  const n = Math.min(a.x0.length, a.y0.length, a.x1.length, a.y1.length);
  const first = a.colors[0], style0 = a.styles[0];
  const handle = some<Handle>({ kind: 'collection', color: first, widthPt: a.widthPt, style: style0 });
  const strokeOf = (i: number): Stroke => {
    const st = lineStroke(theme, a.colors[i % a.colors.length], a.widthPt, a.styles[i % a.styles.length], k);
    return { ...st, cap: 'butt', join: 'round' };
  };
  const X0 = forwardAll(f.xscale, a.x0), X1 = forwardAll(f.xscale, a.x1), Y0 = forwardAll(f.yscale, a.y0), Y1 = forwardAll(f.yscale, a.y1);
  const single = n === 1 && a.colors.length === 1 && a.styles.length === 1 && style0 === 'solid';
  const nodes: Node[] = [];
  for (let i = 0; i < n; i++) {
    const stroke = strokeOf(i);
    if (stroke.color.alpha <= 0 || stroke.width <= 0) continue;
    const tyDev = single ? -f.cy : f.H - f.cy;
    const xs = Float64Array.of(X0[i] * f.ax + f.cx, X1[i] * f.ax + f.cx);
    const ys = Float64Array.of(Y0[i] * -f.ay + tyDev, Y1[i] * -f.ay + tyDev);
    if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) continue;
    const off = snapOffset(stroke.width);
    const fix = (v: number): number => (isRectilinear(xs, ys) ? Math.floor(v + 0.5) + off : single ? v + 0.5 : v);
    const segs: Seg[] = [['M', fix(xs[0]), fix(ys[0])], ['L', fix(xs[1]), fix(ys[1])]];
    nodes.push(single
      ? { kind: 'markers', shape: segs, xs: Float64Array.of(0), ys: Float64Array.of(f.H), ink: { kind: 'stroke', stroke } }
      : pathNode(segs, { kind: 'stroke', stroke }));
  }
  return { nodes: nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [], lines: [], boxes: [], handle };
}

/** A Polygon patch: filled and/or stroked (miter joins, butt caps), snapped when rectilinear. */
export function drawPolygon(a: PolygonArtist, f: Frame, k: number, clip: Clip): Drawn {
  const handle = some<Handle>({ kind: 'patch', face: a.face, edge: a.edge });
  const stroke: Option<Stroke> = a.edge.kind === 'on' && a.edge.widthPt > 0
    ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const n = Math.min(a.x.length, a.y.length);
  const X = forwardAll(f.xscale, a.x), Y = forwardAll(f.yscale, a.y);
  const xs = new Float64Array(n), ys = new Float64Array(n), up = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = X[i] * f.ax + f.cx; ys[i] = Y[i] * -f.ay + (f.H - f.cy); up[i] = Y[i] * f.ay + f.cy; }
  const lines = [{ xs, ys: up }];
  // an unfilled, open outline fills nothing (Patch fill=False)
  const ink = inkOf(a.closed ? a.face : { kind: 'none' }, stroke);
  if (n === 0 || ink.kind === 'none') return { nodes: [], lines, boxes: [], handle };
  // Polygon(closed=True) appends the first vertex, which becomes the CLOSEPOLY
  const cx = a.closed ? Float64Array.of(...xs, xs[0]) : xs, cy = a.closed ? Float64Array.of(...ys, ys[0]) : ys;
  const off = stroke.kind === 'some' ? snapOffset(stroke.value.width) : 0;
  const rect = isRectilinear(cx, cy);
  const fix = (v: number): number => (rect ? Math.floor(v + 0.5) + off : v);
  const segs: Seg[] = Array.from(xs, (x, i): Seg => [i === 0 ? 'M' : 'L', fix(x), fix(ys[i])]);
  if (a.closed) segs.push(['Z']);
  return { nodes: [{ kind: 'group', clip, nodes: [pathNode(segs, ink.value)], tag: '' }], lines, boxes: [], handle };
}

type Pending = { readonly x: number; readonly w: number; y: number; h: number; readonly i: number };

export function drawBar(a: BarArtist, f: Frame, k: number, clip: Clip, span: SpanHandle): Drawn {
  const stroke: Option<Stroke> = a.edge.kind === 'on'
    ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } })
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
  const stroke: Option<Stroke> = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
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
  const off = a.edge.kind === 'on' ? snapOffset(strokePx(a.edge.widthPt, k)) : 0;
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
  const y = a.coords === 'data' ? ty(f, a.y) : f.H - (a.y * f.box.h + f.box.b);
  const nodes = a.text === '' ? [] : labelNodes(placeText(a.text, a.sizePt, dpi, face, x, y, { kind: 'horizontal', ha: a.ha, va: a.va }), k, a.color);
  return { nodes, lines: [], boxes: [], handle: none };
}

/** ax.annotate: Annotation.draw draws its FancyArrowPatch (ArrowStyle.Simple via the YAArrow emulation), then the text. */
export function drawAnnotation(a: AnnotationArtist, f: Frame, W: number, dpi: number, theme: Theme, k: number, clip: Clip): Drawn {
  // _get_xy_transform, in display (y-up) px: 'data' is transData; "<ref> <unit>" is
  // Affine2D().scale(unit).translate(*ref.p0), with 'offset' anchored at the annotated point.
  const up0 = (c: AnnotationCoords, x: number, y: number, offsetFrom: readonly [number, number]): readonly [number, number] => {
    if (c.kind === 'data') return [forward(f.xscale, x) * f.ax + f.cx, forward(f.yscale, y) * f.ay + f.cy];
    const p0: readonly [number, number] = c.ref === 'figure' ? [0, 0] : c.ref === 'axes' ? [f.box.x0, f.box.b] : offsetFrom;
    const size: readonly [number, number] = c.ref === 'figure' ? [W, f.H] : [f.box.w, f.box.h];
    const s: readonly [number, number] = c.unit === 'points' ? [dpi / 72, dpi / 72]
      : c.unit === 'pixels' ? [1, 1]
      : c.unit === 'fontsize' ? [a.sizePt * dpi / 72, a.sizePt * dpi / 72]
      : size;
    return [x * s[0] + p0[0], y * s[1] + p0[1]];
  };
  const xyUp = up0(a.xycoords, a.x, a.y, [0, 0]);
  const textUp = up0(a.textcoords, a.tx, a.ty, xyUp);
  // Annotation._check_xy (annotation_clip None): a 'data' annotation draws only while xy is inside the axes
  if (a.xycoords.kind === 'data' && !(xyUp[0] >= f.box.x0 && xyUp[0] <= f.box.x1 && xyUp[1] >= f.box.b && xyUp[1] <= f.box.t)) {
    return { nodes: [], lines: [], boxes: [], handle: none };
  }
  const x1 = textUp[0], y1 = f.H - textUp[1];
  const face = resolveFace(theme.font.families, a.weight);
  const box = placeText(a.text, a.sizePt, dpi, face, x1, y1, { kind: 'horizontal', ha: a.ha, va: a.va });
  const textNodes = a.text === '' ? [] : labelNodes(box, k, a.color);
  // matplotlib works in y-up display space; Agg flips with height - y
  const up = (y: number): number => f.H - y;
  const arrowNodes = ((): readonly Node[] => {
    if (a.arrow.kind === 'none') return [];
    const ar = a.arrow.value;
    const bbox = a.text === '' ? { x0: x1, y0: textUp[1], x1, y1: textUp[1] } : { x0: box.x0, y0: up(box.y1), x1: box.x1, y1: up(box.y0) };
    const path = yaArrowPath(bbox, xyUp, a.text !== '',
      { widthPt: ar.widthPt, headWidthPt: ar.headWidthPt, headLengthPt: ar.headLengthPt, shrink: ar.shrink, mutationPt: a.sizePt }, k);
    const segs = path.map((sg): Seg => {
      switch (sg.kind) {
        case 'M': return ['M', sg.p[0], up(sg.p[1])];
        case 'L': return ['L', sg.p[0], up(sg.p[1])];
        case 'Q': return ['Q', sg.c[0], up(sg.c[1]), sg.p[0], up(sg.p[1])];
        case 'Z': return ['Z'];
        default: return assertNever(sg);
      }
    });
    // FancyArrowPatch: round join and cap; a curved path is never snapped
    const stroke: Option<Stroke> = ar.linewidthPt > 0 ? some({ color: ar.edge, width: strokePx(ar.linewidthPt, k), cap: 'round', join: 'round', dash: { kind: 'solid' } }) : none;
    const ink = inkOf({ kind: 'solid', color: ar.face }, stroke);
    return ink.kind === 'some' ? [pathNode(segs, ink.value)] : [];
  })();
  const nodes: readonly Node[] = [{ kind: 'group', clip, nodes: [...arrowNodes, ...textNodes], tag: '' }];
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
  const strokeOf = (edge: Paint): Option<Stroke> =>
    edge.kind === 'solid' && a.edgeWidthPt > 0 ? some({ color: edge.color, width: strokePx(a.edgeWidthPt, k), cap: 'butt', join: 'round', dash: { kind: 'solid' } }) : none;
  const nodes: Node[] = [];
  if (groups.size === 1) {
    // Collection.draw: one path, one size, one face and edge colour -> renderer.draw_markers
    for (const g of groups.values()) {
      const ink = inkOf(g.face, strokeOf(g.edge));
      if (ink.kind === 'none') continue;
      const m = markersNode({ kind: 'on', shape: a.shape, sizePt: g.sizePt, edgeWidthPt: a.edgeWidthPt, face: g.face, edge: g.edge },
                            Float64Array.from(g.xs), Float64Array.from(g.ys), k, true);  // PathCollection: no snapping, draw_markers offset
      if (m.kind === 'some') nodes.push(m.value);
    }
  } else {
    // Otherwise RendererAgg::_draw_path_collection_generic: each point's path is scaled by sqrt(s) * dpi / 72 and
    // translated to its exact (unrounded) offset, then filled and stroked in order, with no pixel-centre shift.
    for (let i = 0; i < n; i++) {
      if (!(Number.isFinite(xs[i]) && Number.isFinite(ys[i]))) continue;
      const ink = inkOf(MARKERS[a.shape].filled ? a.faces[i] : { kind: 'none' }, strokeOf(a.edges[i]));
      if (ink.kind === 'none') continue;
      const sizePx = Math.sqrt(Math.max(0, a.sizePt2[i])) * k, x = xs[i], y = ys[i];
      const segs = MARKERS[a.shape].segs.map((sg): Seg => {
        switch (sg[0]) {
          case 'M': return ['M', x + sg[1] * sizePx, y - sg[2] * sizePx];
          case 'L': return ['L', x + sg[1] * sizePx, y - sg[2] * sizePx];
          case 'Q': return ['Q', x + sg[1] * sizePx, y - sg[2] * sizePx, x + sg[3] * sizePx, y - sg[4] * sizePx];
          case 'C': return ['C', x + sg[1] * sizePx, y - sg[2] * sizePx, x + sg[3] * sizePx, y - sg[4] * sizePx, x + sg[5] * sizePx, y - sg[6] * sizePx];
          case 'Z': return ['Z'];
          default: return assertNever(sg);
        }
      });
      nodes.push(pathNode(snapRectilinear(segs, snapOffset(strokePx(a.edgeWidthPt, k))), ink.value));
    }
  }
  const out: readonly Node[] = nodes.length > 0 ? [{ kind: 'group', clip, nodes, tag: '' }] : [];
  return { nodes: out, lines: [], boxes: [], handle: some({ kind: 'line', stroke: { kind: 'none' }, markers: { kind: 'none' } }) };
}

/**
 * _draw_path_collection_generic runs every member path through PathSnapper (check_snap, SNAP_AUTO):
 * a straight-segment path of ≤ 1024 vertices whose segments are all axis-aligned within 1e-4 px
 * lands on floor(v + 0.5) + off, off = 0.5 for an odd rounded gc linewidth, else 0. Anything else
 * (curves, diagonals) passes through untouched. Fixture scatter_sizes (square markers, lw 1).
 */
function snapRectilinear(segs: readonly Seg[], off: number): readonly Seg[] {
  const pts: (readonly [number, number])[] = [];
  for (const sg of segs) {
    if (sg[0] === 'M' || sg[0] === 'L') pts.push([sg[1], sg[2]]);
    else if (sg[0] !== 'Z') return segs;
  }
  if (segs.length > 1024) return segs;
  const axisAligned = pts.every((p, i) => i === 0 || Math.abs(p[0] - pts[i - 1][0]) < 1e-4 || Math.abs(p[1] - pts[i - 1][1]) < 1e-4);
  if (!axisAligned) return segs;
  const fix = (v: number): number => Math.floor(v + 0.5) + off;
  return segs.map((sg): Seg => (sg[0] === 'M' || sg[0] === 'L' ? [sg[0], fix(sg[1]), fix(sg[2])] : sg));
}

/** axvspan / axhspan: spans in data × axes-fraction coordinates. */
export function drawSpan(a: SpanArtist, f: Frame, k: number, clip: Clip): Drawn {
  const stroke: Option<Stroke> = a.edge.kind === 'on' && a.edge.widthPt > 0 ? some({ color: a.edge.color, width: strokePx(a.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } }) : none;
  const ink = inkOf(a.face, stroke);
  if (ink.kind === 'none') return { nodes: [], lines: [], boxes: [], handle: some({ kind: 'patch', face: a.face, edge: a.edge }) };
  const off = stroke.kind === 'some' ? snapOffset(stroke.value.width) : 0;
  if (a.orientation === 'vertical') {
    const x0 = tx(f, a.a0), x1 = tx(f, a.a1);
    const y0 = f.H - (a.f0 * f.box.h + f.box.b), y1 = f.H - (a.f1 * f.box.h + f.box.b);
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
