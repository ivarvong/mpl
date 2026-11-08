// Line strokes, dash patterns and markers (pure).
import { strokePx } from './text.ts';
import { MARKERS } from './data/markers.ts';
import { inkOf, snapOffset } from './scene.ts';
import type { Cap, Dash, Join, LineMarkers, LineStyleName, MarkerName, Node, Option, Rgb, Seg, Stroke, Theme } from './types.ts';
import { assertNever, none, some } from './types.ts';

/** lines._get_dash_pattern + _scale_dashes, in px. */
export function dashFor(theme: Theme, style: LineStyleName, widthPt: number, k: number): Dash {
  const scale = theme.lines.scaleDashes ? widthPt : 1;
  const pattern = (p: readonly number[]): Dash => ({ kind: 'dashed', pattern: p.map((d) => d * scale * k), offset: 0 });
  switch (style) {
    case 'solid': return { kind: 'solid' };
    case 'dashed': return pattern(theme.lines.patterns.dashed);
    case 'dashdot': return pattern(theme.lines.patterns.dashdot);
    case 'dotted': return pattern(theme.lines.patterns.dotted);
    default: return assertNever(style);
  }
}

/** Line2D stroke: solid lines use the solid cap/join, dashed ones the dash cap/join. */
export function lineStroke(theme: Theme, color: Rgb, widthPt: number, style: LineStyleName, k: number, capOverride: Option<Cap> = none): Stroke {
  const dash = dashFor(theme, style, widthPt, k);
  const solid = dash.kind === 'solid';
  const cap: Cap = capOverride.kind === 'some' ? capOverride.value : (solid ? theme.lines.solidCap : theme.lines.dashCap);
  const join: Join = solid ? theme.lines.solidJoin : theme.lines.dashJoin;
  return { color, width: strokePx(widthPt, k), cap, join, dash };
}

/** Marker outline at the origin in px (y down). Vertices snap to integers at/above the marker's threshold. */
export function markerShape(name: MarkerName, sizePx: number, doSnap: boolean = sizePx >= MARKERS[name].snapPx): readonly Seg[] {
  const def = MARKERS[name];
  const v = (x: number): number => (doSnap ? Math.floor(x + 0.5) : x);
  const X = (x: number): number => v(x * sizePx), Y = (y: number): number => v(-y * sizePx);
  return def.segs.map((s): Seg => {
    switch (s[0]) {
      case 'M': return ['M', X(s[1]), Y(s[2])];
      case 'L': return ['L', X(s[1]), Y(s[2])];
      case 'Q': return ['Q', X(s[1]), Y(s[2]), X(s[3]), Y(s[4])];
      case 'C': return ['C', X(s[1]), Y(s[2]), X(s[3]), Y(s[4]), X(s[5]), Y(s[6])];
      case 'Z': return ['Z'];
      default: return assertNever(s);
    }
  });
}

/**
 * PathSnapper's SNAP_AUTO test (path_converters.h should_snap), on a path in px: at most 1024 segments, no curves, and
 * every line_to axis-aligned within 1e-4 px of the previous vertex (a move_to only moves the pen, so '+' snaps).
 * A collection's GraphicsContext keeps snap None, which is this test.
 */
export function snapsAuto(segs: readonly Seg[]): boolean {
  if (segs.length > 1024 || segs.length === 0) return false;
  let px = 0, py = 0;
  for (const sg of segs) {
    switch (sg[0]) {
      case 'M': px = sg[1]; py = sg[2]; break;
      case 'L':
        if (Math.abs(px - sg[1]) >= 1e-4 && Math.abs(py - sg[2]) >= 1e-4) return false;
        px = sg[1]; py = sg[2]; break;
      case 'Q': case 'C': return false;
      case 'Z': break;
      default: return assertNever(sg);
    }
  }
  return true;
}
const autoSnaps = (name: MarkerName, sizePx: number): boolean => snapsAuto(markerShape(name, sizePx, false));

/**
 * One instanced Markers node: renderer.draw_markers. Agg snaps each origin to the pixel centre; opaque identical
 * markers at the same snapped pixel are indistinguishable, so they dedupe. A Line2D snaps its marker path when the
 * marker is at least its snap threshold, and strokes with the marker's own join and cap. With `collection` (a
 * PathCollection's single-path draw) the GraphicsContext keeps its defaults instead: round join, butt cap, and
 * SNAP_AUTO, which snaps only an axis-aligned path (a square, not a triangle or diamond).
 */
export function markersNode(m: Extract<LineMarkers, { kind: 'on' }>, xs: Float64Array, ys: Float64Array, k: number, collection: boolean = false, snapOn: boolean = true): Option<Node> {
  const def = MARKERS[m.shape];
  const ew = strokePx(m.edgeWidthPt, k);
  const stroke: Option<Stroke> = m.edge.kind === 'solid' && ew > 0
    ? some({ color: m.edge.color, width: ew, cap: collection ? 'butt' : def.cap, join: collection ? 'round' : def.join, dash: { kind: 'solid' } })
    : none;
  // Line2D fills every marker path with its face colour (unfillable ones such as 'x' and '|' enclose no area; the carets do)
  const ink = inkOf(m.face, stroke);
  if (ink.kind === 'none') return none;
  const fillAlpha = ink.value.kind === 'stroke' ? 1 : ink.value.fill.alpha;
  const strokeAlpha = ink.value.kind === 'fill' ? 1 : ink.value.stroke.color.alpha;
  const dedupe = fillAlpha === 1 && strokeAlpha === 1;
  const seen = new Set<number>();
  // a snapped marker path lands on PathSnapper's grid: +0.5 for odd edge widths, +0 for even
  // (including no edge); an unsnapped one gets draw_markers' plain +0.5 shift
  // matplotlib's SVG backend (snapOn false) writes each marker at its exact offset with the unsnapped path
  const snapping = snapOn && (collection ? autoSnaps(m.shape, m.sizePt * k) : m.sizePt * k >= def.snapPx);
  const off = snapping ? snapOffset(ew) : snapOn ? 0.5 : 0;
  const ox = new Float64Array(xs.length), oy = new Float64Array(xs.length);
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!(Number.isFinite(x) && Number.isFinite(y))) continue;
    if (!snapOn) { ox[n] = x; oy[n] = y; n++; continue; }
    const px = Math.floor(x + 0.5), py = Math.floor(y + 0.5);
    if (dedupe) { const key = px * 1048576 + py; if (seen.has(key)) continue; seen.add(key); }
    ox[n] = px + off; oy[n] = py + off; n++;
  }
  if (n === 0) return none;
  return some({ kind: 'markers', shape: markerShape(m.shape, m.sizePt * k, snapping), xs: ox.subarray(0, n), ys: oy.subarray(0, n), ink: ink.value });
}
