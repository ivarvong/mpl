// Line strokes, dash patterns and markers (pure).
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
export function lineStroke(theme: Theme, color: Rgb, widthPt: number, style: LineStyleName, k: number): Stroke {
  const dash = dashFor(theme, style, widthPt, k);
  const solid = dash.kind === 'solid';
  const cap: Cap = solid ? theme.lines.solidCap : theme.lines.dashCap;
  const join: Join = solid ? theme.lines.solidJoin : theme.lines.dashJoin;
  return { color, width: widthPt * k, cap, join, dash };
}

/** Marker outline at the origin in px (y down). Vertices snap to integers at/above the marker's threshold. */
export function markerShape(name: MarkerName, sizePx: number): readonly Seg[] {
  const def = MARKERS[name];
  const doSnap = sizePx >= def.snapPx;
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
 * One instanced Markers node. Agg draw_markers snaps each origin to the pixel centre;
 * opaque identical markers at the same snapped pixel are indistinguishable, so they dedupe.
 */
export function markersNode(m: Extract<LineMarkers, { kind: 'on' }>, xs: Float64Array, ys: Float64Array, k: number): Option<Node> {
  const def = MARKERS[m.shape];
  const ew = m.edgeWidthPt * k;
  const stroke: Option<Stroke> = m.edge.kind === 'solid' && ew > 0
    ? some({ color: m.edge.color, width: ew, cap: def.cap, join: def.join, dash: { kind: 'solid' } })
    : none;
  const ink = inkOf(def.filled ? m.face : { kind: 'none' }, stroke);
  if (ink.kind === 'none') return none;
  const fillAlpha = ink.value.kind === 'stroke' ? 1 : ink.value.fill.alpha;
  const strokeAlpha = ink.value.kind === 'fill' ? 1 : ink.value.stroke.color.alpha;
  const dedupe = fillAlpha === 1 && strokeAlpha === 1;
  const seen = new Set<number>();
  // a snapped marker path lands on PathSnapper's grid: +0.5 for odd edge widths, +0 for even
  // (including no edge); an unsnapped one gets draw_markers' plain +0.5 shift
  const off = m.sizePt * k >= def.snapPx ? snapOffset(ew) : 0.5;
  const ox = new Float64Array(xs.length), oy = new Float64Array(xs.length);
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i], y = ys[i];
    if (!(Number.isFinite(x) && Number.isFinite(y))) continue;
    const px = Math.floor(x + 0.5), py = Math.floor(y + 0.5);
    if (dedupe) { const key = px * 1048576 + py; if (seen.has(key)) continue; seen.add(key); }
    ox[n] = px + off; oy[n] = py + off; n++;
  }
  if (n === 0) return none;
  return some({ kind: 'markers', shape: markerShape(m.shape, m.sizePt * k), xs: ox.subarray(0, n), ys: oy.subarray(0, n), ink: ink.value });
}
