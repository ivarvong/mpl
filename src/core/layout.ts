// Layout: FigureSpec -> Scene. Pure; composes the stages:
//   extents (shared across twins) -> view limits -> ticks -> artists -> axes -> spines -> text -> legend -> z-order
import type { Extent } from './autoscale.ts';
import { dataExtents, unionExtent, viewLimits } from './autoscale.ts';
import type { AxisDrawn, Sides, UpEdges } from './draw-axis.ts';
import { drawAxis, labelNodes } from './draw-axis.ts';
import type { Drawn } from './draw-artists.ts';
import { drawAxLine, drawBar, drawFill, drawLine, drawPolygon, drawSegments, drawText, drawScatter, drawSpan, drawAnnotation, drawImage, handleOf } from './draw-artists.ts';
import type { Frame } from './frame.ts';
import { axesBox, frame, geomHeight } from './frame.ts';
import type { Device } from './frame.ts';
import { forward } from './scale.ts';
import { layoutLegend } from './legend.ts';
import type { Box } from './legend-index.ts';
import { tickLabelText } from './log.ts';
import { inkOf, pathNode, rectNode, snap } from './scene.ts';
import { lookup } from './std.ts';
import type { TextBox } from './text.ts';
import { measure, placeText, pxPerPt, windowExtent } from './text.ts';
import { resolveFace } from './fonts.ts';
import type { TickSet } from './ticks.ts';
import { computeTicks, scaleOf, tickSpace } from './ticks.ts';
import type { HAlign, Option, Artist, AxesMeta, AxesRole, AxesSpec, AxisBelow, AxisMeta, Clip, FigureSpec, LegendEntry, Node, Placement, Position, PxBox, Rgb, TightBox, Scale, Scene, Stroke, Theme, TickTheme } from './types.ts';
import { assertNever, none, some } from './types.ts';
import type { Tracer } from '../trace.ts';

const axisZ = (b: AxisBelow): number => {
  switch (b) {
    case 'below': return 0.5;
    case 'line': return 1.5;
    case 'above': return 2.5;
    default: return assertNever(b);
  }
};
/** Axis.get_ticklabels lists only drawn labels: none once label_outer has hidden them. */
const axisMeta = (lim: readonly [number, number], t: TickSet, hidden: boolean): AxisMeta =>
  ({ lim, ticks: t.locs, labels: hidden ? [] : t.labels.map(tickLabelText), offset: t.offset, minor: t.minor, minorLabels: hidden ? [] : t.minorLabels.map(tickLabelText) });

// ---------------------------------------------------------------- what a role implies
type AxisVisibility = { readonly kind: 'hidden' } | { readonly kind: 'shown'; readonly sides: Sides };
type Roles = { readonly x: AxisVisibility; readonly y: AxisVisibility; readonly patch: boolean; readonly yOnRight: boolean };
const themeSides = (t: TickTheme): Sides => ({ near: t.near, far: t.far, labels: t.labelNear ? 'near' : 'none' });

/** label_outer: ticks stay, their labels go. */
const unlabel = (v: AxisVisibility, off: boolean): AxisVisibility => (off && v.kind === 'shown' ? { kind: 'shown', sides: { ...v.sides, labels: 'none' } } : v);

/** twinx(): the twin hides its x axis and patch and ticks its y on the right; the host's y is ticked left only. */
function roleImplies(role: AxesRole, hasTwin: boolean, theme: Theme, hidden: AxesSpec['hiddenLabels']): Roles {
  const r = ((): Roles => {
    switch (role.kind) {
      case 'primary':
        return { x: { kind: 'shown', sides: themeSides(theme.xtick) },
                 y: { kind: 'shown', sides: hasTwin ? { near: true, far: false, labels: 'near' } : themeSides(theme.ytick) },
                 patch: true, yOnRight: false };
      case 'twinx':
        return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, patch: false, yOnRight: true };
      case 'colorbar':
        // vertical: ticks on the right; horizontal: ticks on the bottom; patch on for solids
        if (role.orientation === 'horizontal') {
          return { x: { kind: 'shown', sides: { near: true, far: false, labels: 'near' } },
                   y: { kind: 'hidden' }, patch: true, yOnRight: false };
        }
        return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, patch: true, yOnRight: true };
      default: return assertNever(role);
    }
  })();
  return { ...r, x: unlabel(r.x, hidden.x), y: unlabel(r.y, hidden.y) };
}

/** Each artist's top-level groups carry its provenance, so interactive renderers can find its marks. */
const tagged = (d: Drawn, i: number, kind: string): Drawn =>
  ({ ...d, nodes: d.nodes.map((n): Node => (n.kind === 'group' ? { ...n, tag: `artist/${i}/${kind}` } : n)) });
function drawArtists(ax: AxesSpec, f: Frame, theme: Theme, k: number, clip: Clip, tracer: Tracer): readonly Drawn[] {
  return ax.artists.map((a, i) => {
    const c: Clip = a.clip === false ? { kind: 'none' } : clip;
    return tagged(drawArtist(a, f, theme, k, c, tracer), i, a.kind);
  });
}
function drawArtist(a: Artist, f: Frame, theme: Theme, k: number, clip: Clip, tracer: Tracer): Drawn {
  {
    switch (a.kind) {
      case 'line': return tracer.span('artist.line', { points: a.x.length, stroke: a.stroke.kind, markers: a.markers.kind }, (sp) => drawLine(a, f, theme, k, clip, sp));
      case 'bar': return tracer.span('artist.bar', { rects: a.x.length }, (sp) => drawBar(a, f, k, clip, sp));
      case 'fill': return tracer.span('artist.fill', { points: a.x.length }, () => drawFill(a, f, k, clip));
      case 'text': return tracer.span('artist.text', { text: a.text, coords: a.coords }, () => drawText(a, f, k * 72, resolveFace(theme.font.families, a.weight)));
      case 'scatter': return tracer.span('artist.scatter', { points: a.x.length }, () => drawScatter(a, f, theme, k, clip));
      case 'annotation': return tracer.span('artist.annotation', { }, () => drawAnnotation(a, f, f.W, k * 72, theme, k, clip));
      case 'span': return tracer.span('artist.span', { orientation: a.orientation }, () => drawSpan(a, f, k, clip));
      case 'axline': return tracer.span('artist.axline', { through: a.through.kind }, (sp) => drawAxLine(a, f, theme, k, clip, sp));
      case 'segments': return tracer.span('artist.segments', { segments: a.x0.length }, () => drawSegments(a, f, theme, k, clip));
      case 'polygon': return tracer.span('artist.polygon', { vertices: a.x.length, closed: a.closed }, () => drawPolygon(a, f, k, clip));
      case 'sticky': return { nodes: [], lines: [], boxes: [], points: [], handle: none };
      case 'image': return tracer.span('artist.image', { rows: a.rows, cols: a.cols }, () => drawImage(a, f, clip));
      case 'errorbar': return { nodes: [], lines: [], boxes: [], points: [], handle: handleOf(a) };
      default: return assertNever(a);
    }
  }
}

/** Artist.zorder: patches and path/fill collections 1, lines and line collections 2 (or what the artist says), text 3. */
function zorder(a: Artist): number {
  switch (a.kind) {
    case 'bar': case 'fill': case 'span': return 1;
    case 'scatter': case 'image': return a.zorder;
    case 'axline': return 2;
    case 'line': case 'segments': case 'polygon': return a.zorder;
    case 'text': case 'annotation': case 'errorbar': return 3;
    case 'sticky': return 0;
    default: return assertNever(a);
  }
}

/** A legend entry and the index of the artist it stands for. */
type Sourced = { readonly entry: LegendEntry; readonly artist: number };
/** _get_legend_handles: Axes children in order, then containers (bars). */
function legendEntries(ax: AxesSpec, drawn: readonly Drawn[]): readonly Sourced[] {
  const children: Sourced[] = [], containers: Sourced[] = [];
  ax.artists.forEach((a, i) => {
    if (a.kind === 'text' || a.kind === 'annotation') return;
    if (a.label.kind === 'none') return;
    const h = drawn[i].handle;
    if (h.kind === 'none') return;
    const e: Sourced = { entry: { label: a.label.text, handle: h.value }, artist: i };
    switch (a.kind) {
      // Line2D, patches and collections are Axes children; hist's labelled bar is a child Rectangle
      case 'line': case 'fill': case 'scatter': case 'axline': case 'segments': case 'polygon': children.push(e); break;
      case 'bar': (a.legend === 'child' ? children : containers).push(e); break;
      case 'span': case 'errorbar': case 'image': containers.push(e); break;
      case 'sticky': break;
      default: assertNever(a);
    }
  });
  return [...children, ...containers];
}

function spinesForAxes(ax: AxesSpec, theme: Theme, f: Frame, k: number): readonly Node[] {
  const baseW = theme.axes.linewidthPt * k, b = f.box;
  const sides: Array<{ side: 'left' | 'right' | 'top' | 'bottom'; x0: number; y0: number; x1: number; y1: number }> = [];
  const ov = ax.spines;
  const has = theme.axes.spines;
  const sideOn = (side: 'left' | 'right' | 'top' | 'bottom'): boolean => (has[side] && ov[side].visible);
  const outwardPx = (side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const p = ov[side].position;
    return p.kind === 'some' && p.value.kind === 'outward' ? p.value.pts * k : 0;
  };
  const wOf = (side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const wPt = ov[side].widthPt.kind === 'some' ? ov[side].widthPt.value : theme.axes.linewidthPt;
    return wPt * k;
  };
  const colorOf = (side: 'left' | 'right' | 'top' | 'bottom'): Rgb => (ov[side].color.kind === 'some' ? ov[side].color.value : theme.axes.edge);
  // Compute snapped positions per side, with optional outward offsets
  if (sideOn('left')) {
    const w = wOf('left'); const off = outwardPx('left');
    const x = snap(b.x0 - off, w), y0 = snap(b.yBotG, w), y1 = snap(b.yTopG, w);
    sides.push({ side: 'left', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('right')) {
    const w = wOf('right'); const off = outwardPx('right');
    const x = snap(b.x1 + off, w), y0 = snap(b.yBotG, w), y1 = snap(b.yTopG, w);
    sides.push({ side: 'right', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('bottom')) {
    const w = wOf('bottom'); const off = outwardPx('bottom');
    const y = snap(b.yBotG + off, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
    sides.push({ side: 'bottom', x0, y0: y, x1, y1: y });
  }
  if (sideOn('top')) {
    const w = wOf('top'); const off = outwardPx('top');
    const y = snap(b.yTopG - off, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
    sides.push({ side: 'top', x0, y0: y, x1, y1: y });
  }
  const nodes: Node[] = [];
  for (const s of sides) {
    const w = Math.max(baseW, wOf(s.side));   // at least theme width; overrides can widen
    if (w <= 0) continue;
    const stroke: Stroke = { color: colorOf(s.side), width: w, cap: 'square', join: 'miter', dash: { kind: 'solid' } };
    nodes.push(pathNode([[ 'M', s.x0, s.y0 ], [ 'L', s.x1, s.y1 ]], { kind: 'stroke', stroke }));
  }
  return nodes;
}

type AxisOut = { readonly near: readonly TextBox[]; readonly far: readonly TextBox[]; readonly nearUp: readonly UpEdges[] };

/** What each decoration occupies, for Axes.get_tightbbox. An empty Text's extent is a point,
 *  which Axis.get_tightbbox drops (Bbox._is_finite), so empty labels take no room. */
type DecoBoxes = {
  readonly x: readonly PxBox[]; readonly y: readonly PxBox[]; readonly title: Option<PxBox>;
  /** display y-up bottoms of the x offset text and xlabel (as `x`), and the title's top, in matplotlib's arithmetic */
  readonly xUp: readonly UpEdges[]; readonly titleUp: Option<UpEdges>;
};
type Decorated = { readonly nodes: readonly Node[]; readonly boxes: DecoBoxes };
/** for_layout_only: an x label keeps 1 px of its width, a y label 1 px of its height (centred) */
const collapseX = (b: PxBox): PxBox => (b.x1 > b.x0 ? { ...b, x0: (b.x0 + b.x1) / 2 - 0.5, x1: (b.x0 + b.x1) / 2 + 0.5 } : b);
const collapseY = (b: PxBox): PxBox => (b.y1 > b.y0 ? { ...b, y0: (b.y0 + b.y1) / 2 - 0.5, y1: (b.y0 + b.y1) / 2 + 0.5 } : b);
const optBox = (o: Option<PxBox>, adjust: (box: PxBox) => PxBox = (box) => box): readonly PxBox[] => (o.kind === 'some' ? [adjust(o.value)] : []);
export const unionBox = (bs: readonly PxBox[]): PxBox => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

const edges = (e: { readonly y0: number; readonly y1: number }): UpEdges => ({ b: e.y0, t: e.y1 });
/** A tight bbox from its parts; a part's display y-up edge, when known in matplotlib's arithmetic, wins over H − y. */
type TightPart = { readonly box: PxBox; readonly up: UpEdges };
const flip = (H: number) => (box: PxBox): TightPart => ({ box, up: { b: H - box.y1, t: H - box.y0 } });
function tightOf(parts: readonly TightPart[]): TightBox {
  const u = unionBox(parts.map((p) => p.box));
  return { ...u, b: Math.min(...parts.map((p) => p.up.b)), t: Math.max(...parts.map((p) => p.up.t)) };
}

/** Offset texts, axis labels, title (Axis._update_label_position / _update_offset_text_position). */
function decorations(ax: AxesSpec, roles: Roles, theme: Theme, f: Frame, k: number, dpi: number, xt: TickSet, yt: TickSet, xb: AxisOut, yb: AxisOut): Decorated {
  const b = f.box, A = theme.axes, out: Node[] = [];
  const half = A.linewidthPt * k / 2;
  const put = (s: string, x: number, y: number, p: Placement, sizePt: number, color: Rgb, weight: number = theme.font.weight): Option<PxBox> => {
    if (s === '') return none;
    const tb = placeText(s, sizePt, dpi, resolveFace(theme.font.families, weight), x, y, p);
    out.push(...labelNodes(tb, k, color));
    return some({ x0: tb.x0, y0: tb.y0, x1: tb.x1, y1: tb.y1 });
  };
  const pad = theme.offsetTextPadPt * k, lp = A.labelPadPt * k;
  const xBoxes: PxBox[] = [], yBoxes: PxBox[] = [], xUp: UpEdges[] = [];
  // the same text's bottom edge in display y-up: XAxis._update_{offset_text,label}_position anchor it at
  // union(tick labels, spine).y0 − pad·dpi/72, then Text.get_window_extent (va='top')
  const bottomUp = (s: string, x: number, padPt: number, ha: HAlign, sizePt: number, weight: number): UpEdges =>
    edges(windowExtent(measure(s, sizePt, dpi, resolveFace(theme.font.families, weight), ha), x, Math.min(f.H - (b.yBot + half), ...xb.nearUp.map((e) => e.b)) - padPt * dpi / 72, ha, 'top'));
  if (roles.x.kind === 'shown') {
    let bottom = b.yBot + half;
    for (const lb of xb.near) bottom = Math.max(bottom, lb.y1);
    if (!ax.hiddenLabels.x) {
      const o = optBox(put(xt.offset, b.x1, bottom + pad, { kind: 'horizontal', ha: 'right', va: 'top' }, theme.xtick.labelSizePt, theme.xtick.color));
      xBoxes.push(...o);
      if (o.length > 0) xUp.push(bottomUp(xt.offset, b.x1, theme.offsetTextPadPt, 'right', theme.xtick.labelSizePt, theme.font.weight));
    }
    const l = optBox(put(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, bottom + lp, { kind: 'horizontal', ha: 'center', va: 'top' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseX);
    xBoxes.push(...l);
    if (l.length > 0) xUp.push(bottomUp(ax.xlabel, b.x0 + (b.x1 - b.x0) / 2, A.labelPadPt, 'center', A.labelSizePt, theme.font.labelWeight));
  }
  if (roles.yOnRight) {
    let right = b.x1 + half;
    for (const lb of yb.far) right = Math.max(right, lb.x1);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x1, b.yTop - pad, { kind: 'horizontal', ha: 'right', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, right + lp, b.yTop + (b.yBot - b.yTop) / 2, { kind: 'ylabelRight' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  } else {
    let left = b.x0 - half;
    for (const lb of yb.near) left = Math.min(left, lb.x0);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x0, b.yTop - pad, { kind: 'horizontal', ha: 'left', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, left - lp, b.yTop + (b.yBot - b.yTop) / 2, { kind: 'ylabel' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  }
  // Agg BboxTransform: x0 + frac*w. (x0+x1)/2 is 1 ulp off when x0+x1 is not dyadic (shifts FreeType 26.6 half-pen).
  const tx0 = ax.titleLoc === 'left' ? b.x0 : ax.titleLoc === 'right' ? b.x1 : b.x0 + (b.x1 - b.x0) / 2;
  // Agg flips after ScaledTranslation pad in y-up: H - (bbox.t + pad). yTop - pad is 1 ulp off when t*H is not dyadic.
  const tb = put(ax.title, tx0, f.H - (b.t + A.titlePadPt * k), { kind: 'horizontal', ha: ax.titleLoc, va: 'baseline' }, A.titleSizePt, A.titleColor, ax.titleWeight);
  // the title's top in display y-up: transAxes + ScaledTranslation(0, pad/72) maps (x, 1) to h·1 + (b + pad/72·dpi)
  // (moved above top tick labels, it has no exact form here: fall back to the flipped box)
  const titleUp: Option<UpEdges> = tb.kind !== 'some' ? none
    : some(xb.far.length > 0 ? { b: f.H - tb.value.y1, t: f.H - tb.value.y0 }
      : edges(windowExtent(measure(ax.title, A.titleSizePt, dpi, resolveFace(theme.font.families, ax.titleWeight), ax.titleLoc), tx0, b.h * 1.0 + (b.b + (A.titlePadPt / 72) * dpi), ax.titleLoc, 'baseline')));
  // Axes.get_tightbbox keeps 1 px of a title's width; zero-size boxes (empty titles) drop out
  return { nodes: out, boxes: { x: xBoxes, y: yBoxes, title: tb.kind === 'some' ? some(collapseX(tb.value)) : none, xUp, titleUp } };
}

/** Spine.get_window_extent: the spine's path, padded by the ticks it carries (not their labels). */
function spineBoxes(ax: AxesSpec, roles: Roles, theme: Theme, f: Frame, k: number, xt: TickSet, yt: TickSet): readonly PxBox[] {
  const b = f.box, has = theme.axes.spines, ov = ax.spines;
  const off = (side: 'left' | 'right' | 'top' | 'bottom'): number => { const p = ov[side].position; return p.kind === 'some' ? p.value.pts * k : 0; };
  const pads = (tt: TickTheme, minor: boolean): { readonly out: number; readonly inn: number } => {
    const size = (minor ? tt.minorSizePt : tt.sizePt) * k;
    switch (tt.direction) {
      case 'out': return { out: size, inn: 0 };
      case 'in': return { out: 0, inn: size };
      case 'inout': return { out: size / 2, inn: size / 2 };
      default: return assertNever(tt.direction);
    }
  };
  const boxes: PxBox[] = [];
  const spine = (side: 'left' | 'right' | 'top' | 'bottom', vis: AxisVisibility, ticks: TickSet, tt: TickTheme): void => {
    if (!(has[side] && ov[side].visible)) return;
    const line: PxBox = side === 'left' ? { x0: b.x0 - off(side), x1: b.x0 - off(side), y0: b.yTop, y1: b.yBot }
      : side === 'right' ? { x0: b.x1 + off(side), x1: b.x1 + off(side), y0: b.yTop, y1: b.yBot }
      : side === 'bottom' ? { x0: b.x0, x1: b.x1, y0: b.yBot + off(side), y1: b.yBot + off(side) }
      : { x0: b.x0, x1: b.x1, y0: b.yTop - off(side), y1: b.yTop - off(side) };
    boxes.push(line);
    if (vis.kind !== 'shown') return;
    const near = side === 'left' || side === 'bottom';
    if (!(near ? vis.sides.near : vis.sides.far)) return;
    for (const minor of [false, true]) {
      if (!ticks.visible.some((t) => t.minor === minor)) continue;
      const p = pads(tt, minor);
      switch (side) {
        case 'left': boxes.push({ ...line, x0: line.x0 - p.out, x1: line.x1 + p.inn }); break;
        case 'right': boxes.push({ ...line, x0: line.x0 - p.inn, x1: line.x1 + p.out }); break;
        case 'bottom': boxes.push({ ...line, y0: line.y0 - p.inn, y1: line.y1 + p.out }); break;
        case 'top': boxes.push({ ...line, y0: line.y0 - p.out, y1: line.y1 + p.inn }); break;
        default: assertNever(side);
      }
    }
  };
  // the y axis sits on the right for a twin: its spines' axis is still the y axis
  spine('left', roles.yOnRight ? { kind: 'hidden' } : roles.y, yt, ax.tick.y);
  spine('right', roles.y, yt, ax.tick.y);
  spine('bottom', roles.x, xt, ax.tick.x);
  spine('top', roles.x, xt, ax.tick.x);
  return boxes;
}

const NOTHING: AxisDrawn = { grid: [], marks: [], nearBoxes: [], farBoxes: [], nearUp: [], farUp: [] };
function shown(v: AxisVisibility, draw: (sides: Sides) => AxisDrawn): AxisDrawn {
  switch (v.kind) {
    case 'hidden': return NOTHING;
    case 'shown': return draw(v.sides);
    default: return assertNever(v);
  }
}

/** The shared x axis of a twin group, planned once and applied to every member. */
type Shared = { readonly lim: readonly [number, number]; readonly ticks: TickSet; readonly minpos: number };
type AxesIn = { readonly ax: AxesSpec; readonly x: Shared; readonly y: Shared; readonly hasTwin: boolean };

/**
 * One axis of a share group (sharex/sharey, twinx): autoscale_view over the union of the siblings' data
 * limits, and the shared locator, whose tick space is its own (the leader's) axis length.
 */

/** Shrink `position` to physical aspect `boxAspect` (= height/width in display units), anchored at [ax,ay]. */
function shrinkToBoxAspect(position: Position, boxAspect: number, figW: number, figH: number, anchor: readonly [number, number]): Position {
  const figAspect = figH / figW;
  const [l, b, r, top] = position;
  const w = r - l, h = top - b;
  const Htry = w * boxAspect / figAspect;
  let W: number, HH: number;
  if (Htry <= h) { W = w; HH = Htry; } else { W = h * figAspect / boxAspect; HH = h; }
  const L = l + anchor[0] * (w - W), B = b + anchor[1] * (h - HH);
  return [L, B, L + W, B + HH];
}

/** matplotlib.colorbar._ColorbarAxesLocator: shrink axes for triangular/rectangular extends. */
function applyColorbarExtend(position: Position, role: AxesSpec['role'], ext: AxesSpec['colorbarExtend']): Position {
  if (ext.kind === 'none' || role.kind !== 'colorbar') return position;
  const [l, b, r, t] = position;
  const w = r - l, h = t - b;
  const len = 1 + ext.value.lower + ext.value.upper;
  const shrink = 1 / len, offset = ext.value.lower / len;
  if (role.orientation === 'vertical') {
    const hh = h * shrink;
    return [l, b + offset * h, r, b + offset * h + hh];
  }
  const ww = w * shrink;
  return [l + offset * w, b, l + offset * w + ww, t];
}

/** Bbox.shrunk_to_aspect + anchored: data aspect (adjustable='box') and/or set_box_aspect. */
function applyAspect(position: Position, aspect: AxesSpec['aspect'], boxAspect: AxesSpec['boxAspect'],
                     anchor: readonly [number, number],
                     xlim: readonly [number, number], ylim: readonly [number, number],
                     xscale: Scale, yscale: Scale, figW: number, figH: number): Position {
  // matplotlib: box_aspect is applied first (when set), then data aspect if not 'auto'.
  let pos = position;
  if (boxAspect.kind === 'some') pos = shrinkToBoxAspect(pos, boxAspect.value, figW, figH, anchor);
  if (aspect.kind === 'auto') return pos;
  const ratio = aspect.kind === 'equal' ? 1 : aspect.value;
  const tx0 = forward(xscale, xlim[0]), tx1 = forward(xscale, xlim[1]);
  const ty0 = forward(yscale, ylim[0]), ty1 = forward(yscale, ylim[1]);
  const xsize = Math.max(Math.abs(tx1 - tx0), 1e-30);
  const ysize = Math.max(Math.abs(ty1 - ty0), 1e-30);
  const dataBoxAspect = ratio * (ysize / xsize);
  return shrinkToBoxAspect(pos, dataBoxAspect, figW, figH, anchor);
}

function planAxis(which: 'x' | 'y', leader: AxesSpec, extent: Extent, fig: FigureSpec, tracer: Tracer): Shared {
  const theme = fig.theme, dpi = fig.dpi;
  const box = axesBox(leader.position, fig.widthIn * dpi, fig.heightIn * dpi);
  const spec = which === 'x' ? leader.x : leader.y;
  const sc = scaleOf(spec);
  const lim = tracer.span(`limits.${which}`, { mode: spec.limits.kind, scale: sc.kind }, () => viewLimits(spec, sc, extent, which === 'x' ? theme.axes.xmargin : theme.axes.ymargin));
  const ticks = tracer.span(`ticks.${which}`, { axis: spec.kind, scale: sc.kind, ticks: spec.ticks.kind, labels: spec.labels.kind },
    (sp) => {
      const t = computeTicks(spec, lim, tickSpace(which, which === 'x' ? box.w : box.h, dpi, which === 'x' ? theme.xtick.labelSizePt : theme.ytick.labelSizePt), theme, extent.minpos);
      sp.setAttribute('major', t.locs.length).setAttribute('minor', t.minor.length).setAttribute('offset', t.offset); return t;
    });
  return { lim, ticks, minpos: extent.minpos };
}

/** 'scene' lays out everything; 'tight' (tight_layout's measuring pass) needs only each Axes' tight bbox, which
 *  no artist enters except through a loc='best' legend's placement, so it draws artists only for that. */
type LayoutMode = 'scene' | 'tight';

/**
 * What an annotated (interactive) SVG needs from layout, per Axes: how many top-level scene nodes it drew (an
 * Axes' nodes are contiguous in Scene.nodes), its exact data → px frame, and each legend entry's box (px, y down)
 * with the index of the artist it stands for.
 */
export type AxesAnnot = { readonly nodes: number; readonly frame: Frame; readonly legend: readonly { readonly artist: number; readonly box: PxBox }[] };
type AxesPart = { readonly nodes: readonly Node[]; readonly meta: AxesMeta; readonly annot: AxesAnnot };

function layoutAxes(inp: AxesIn, fig: FigureSpec, mode: LayoutMode, dev: Device, tracer: Tracer): AxesPart {
  const { ax } = inp;
  const theme = fig.theme, dpi = fig.dpi, k = pxPerPt(dpi);
  const W = fig.widthIn * dpi, H = fig.heightIn * dpi;
  const Hg = geomHeight(H, dev);
  const box = axesBox(ax.position, W, H, Hg);
  const roles = roleImplies(ax.role, inp.hasTwin, theme, ax.hiddenLabels);
  const xs = scaleOf(ax.x), ys = scaleOf(ax.y);

  const xlim = inp.x.lim, ylim = inp.y.lim;
  const xt = inp.x.ticks, yt = inp.y.ticks;
  const f = frame(box, W, H, dev, xlim, ylim, xs, ys);
  const clip: Clip = { kind: 'rect', x: box.x0, y: box.yTopG, w: box.w, h: box.h };

  const face = roles.patch ? inkOf(theme.axes.face, none) : none;
  // The axes patch is a rectilinear, edgeless path: Agg snaps its corners to whole pixels (snap value 0).
  const bx0 = snap(box.x0, 0), bx1 = snap(box.x1, 0), by0 = snap(box.yTopG, 0), by1 = snap(box.yBotG, 0);
  const background: readonly Node[] = face.kind === 'some' ? [rectNode(bx0, by0, bx1 - bx0, by1 - by0, face.value)] : [];
  const undrawn = (): readonly Drawn[] => ax.artists.map((a): Drawn => ({ nodes: [], lines: [], boxes: [], points: [], handle: handleOf(a) }));
  const needArtists = mode === 'scene' || (ax.legend.kind === 'on' && ax.legend.loc.kind === 'best' && legendEntries(ax, undrawn()).length > 0);
  const drawn = needArtists ? tracer.span('artists', { count: ax.artists.length }, () => drawArtists(ax, f, theme, k, clip, tracer)) : undrawn();
  const userTexts = drawn.flatMap((d, i) => (zorder(ax.artists[i]) === 3 ? d.nodes : []));
  const artistLayers = drawn.flatMap((d, i): (readonly [number, readonly Node[]])[] => { const z = zorder(ax.artists[i]); return z === 3 ? [] : [[z, d.nodes]]; });
  // Spine outward offsets move the axis baseline (ticks and labels follow)
  const offPx = (side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const p = ax.spines[side].position;
    return p.kind === 'some' && p.value.kind === 'outward' ? p.value.pts * k : 0;
  };
  const baseX = { xLeft: box.x0 - offPx('left'), xRight: box.x1 + offPx('right') };
  // tick marks flip with the geometry height, tick labels with the float height
  const baseY = { yBottom: box.yBot + offPx('bottom'), yTop: box.yTop - offPx('top') };
  const baseYG = { yBottomG: box.yBotG + offPx('bottom'), yTopG: box.yTopG - offPx('top') };
  const bases = { ...baseX, ...baseY, ...baseYG };
  const xa = shown(roles.x, (sides) => tracer.span('axis.x', { ticks: xt.visible.length }, () =>
    drawAxis('x', xt, ax.tick.x, sides, ax.grid.x, ax.tickLabels.x, f, theme, dpi, tracer, bases)));
  const ya = shown(roles.y, (sides) => tracer.span('axis.y', { ticks: yt.visible.length, side: roles.yOnRight ? 'right' : 'left' }, () =>
    drawAxis('y', yt, ax.tick.y, sides, ax.grid.y, ax.tickLabels.y, f, theme, dpi, tracer, bases)));
  const decTheme: Theme = { ...theme, xtick: ax.tick.x, ytick: ax.tick.y };
  const deco = tracer.span('decorations', { role: ax.role.kind }, () =>
    decorations(ax, roles, decTheme, f, k, dpi, xt, yt, { near: xa.nearBoxes, far: xa.farBoxes, nearUp: xa.nearUp }, { near: ya.nearBoxes, far: ya.farBoxes, nearUp: ya.nearUp }));

  const sourced = legendEntries(ax, drawn), entries = sourced.map((e) => e.entry);
  const axesUp: Box = { x0: box.x0, x1: box.x1, y0: box.b, y1: box.t };
  const spec = ax.legend;
  const legend = spec.kind === 'on' && entries.length > 0
    ? some({ code: spec.loc, out: tracer.span('legend', { entries: entries.length }, () => layoutLegend({
        entries, theme, dpi, W, H, Hg, axesBox: axesUp, lines: drawn.flatMap((d) => d.lines), points: drawn.flatMap((d) => d.points), boxes: drawn.flatMap((d) => d.boxes),
        loc: spec.loc, ncols: spec.ncols, frame: spec.frame, fontSizePt: spec.fontSizePt, markers: spec.markers }, tracer)) })
    : none;

  // Gridlines clip to the axes like every artist; each Axis draws as a unit (x, then y).
  const clipped = (ns: readonly Node[]): readonly Node[] => (ns.length > 0 ? [{ kind: 'group', clip, nodes: ns, tag: '' }] : []);
  // z-order: patches 1, axis (grid/ticks) per axisbelow, lines 2, spines 2.5, text 3, legend 5. The sort is
  // stable and ties keep matplotlib's get_children order (children, spines, then the axes), which
  // matters for axisbelow=False: the axis (2.5) then draws over the spines (2.5).
  const layers: ReadonlyArray<readonly [number, readonly Node[]]> = [
    ...artistLayers, [2.5, spinesForAxes(ax, theme, f, k)],
    [axisZ(theme.axes.axisBelow), [...clipped(xa.grid), ...xa.marks, ...clipped(ya.grid), ...ya.marks]],
    [3, [...userTexts, ...deco.nodes]], [5, legend.kind === 'some' ? legend.value.out.nodes : []],
  ];
  const nodes = [...background, ...layers.toSorted((a, b) => a[0] - b[0]).flatMap(([, n]) => n)];
  const legendBoxes = legend.kind === 'some'
    ? legend.value.out.entries.map((e, j) => ({ artist: sourced[j].artist, box: { x0: e.x0, x1: e.x1, y0: Hg - e.y1, y1: Hg - e.y0 } })) : [];
  return {
    nodes,
    annot: { nodes: nodes.length, frame: f, legend: legendBoxes },
    meta: {
      x: axisMeta(xlim, xt, ax.hiddenLabels.x), y: axisMeta(ylim, yt, ax.hiddenLabels.y),
      frame: { box: { x0: box.x0, x1: box.x1, yTop: box.yTop, yBot: box.yBot }, xlim, ylim, xscale: xs, yscale: ys, H },
      tight: tightOf([
        { box: { x0: box.x0, y0: box.yTop, x1: box.x1, y1: box.yBot }, up: { b: box.b, t: box.t } },
        // the axes patch (a default bbox extra artist) maps the unit square through transAxes: its top is h·1 + b
        ...(roles.patch ? [{ box: { x0: box.x0, y0: box.yTop, x1: box.x1, y1: box.yBot }, up: { b: box.h * 0 + box.b, t: box.h * 1 + box.b } }] : []),
        ...(roles.x.kind === 'shown' ? [
          ...xa.nearBoxes.map((bx, i) => ({ box: bx, up: xa.nearUp[i] })), ...xa.farBoxes.map((bx, i) => ({ box: bx, up: xa.farUp[i] })),
          ...deco.boxes.x.map((bx, i) => ({ box: bx, up: deco.boxes.xUp[i] }))] : []),
        ...(roles.y.kind === 'shown' ? [
          ...ya.nearBoxes.map((bx, i) => ({ box: bx, up: ya.nearUp[i] })), ...ya.farBoxes.map((bx, i) => ({ box: bx, up: ya.farUp[i] })),
          ...deco.boxes.y.map(flip(H))] : []),
        ...(deco.boxes.title.kind === 'some' && deco.boxes.titleUp.kind === 'some' ? [{ box: deco.boxes.title.value, up: deco.boxes.titleUp.value }] : []),
        ...spineBoxes(ax, roles, theme, f, k, xt, yt).map(flip(H)),
        ...(legend.kind === 'some' ? [{ box: { x0: legend.value.out.box.x0, x1: legend.value.out.box.x1, y0: H - legend.value.out.box.y1, y1: H - legend.value.out.box.y0 },
                                        up: { b: legend.value.out.box.y0, t: legend.value.out.box.y1 } }] : []),
      ]),
      legend: legend.kind === 'some'
        ? some({ loc: legend.value.code.kind === 'best' ? 0 : legend.value.code.code, x0: legend.value.out.box.x0, x1: legend.value.out.box.x1,
                 top: H - legend.value.out.box.y1, bottom: H - legend.value.out.box.y0 })
        : none,
    },
  };
}

/** Axes i's twin group: its host and every twinx of that host. */
function twinGroup(axes: readonly AxesSpec[], i: number): readonly number[] {
  const root = (j: number): number => { const r = axes[j].role; return r.kind === 'twinx' ? r.host : j; };
  const host = root(i);
  return axes.map((_, j) => j).filter((j) => root(j) === host);
}

/** Window extents (px, y down) of the suptitle and the supx/supylabels, where present. */
export function supBoxes(fig: FigureSpec): { readonly title: Option<PxBox>; readonly x: Option<PxBox>; readonly y: Option<PxBox> } {
  const W = fig.widthIn * fig.dpi, H = fig.heightIn * fig.dpi;
  type Sup = FigureSpec['suptitle'];
  const place = (o: Sup, vertical: boolean): Option<PxBox> => {
    if (o.kind !== 'some') return none;
    const s = o.value;
    const b = placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), s.x * W, H - s.y * H,
      vertical ? { kind: 'vertical', ha: s.ha, va: s.va } : { kind: 'horizontal', ha: s.ha, va: s.va });
    return some({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 });
  };
  return { title: place(fig.suptitle, false), x: place(fig.supx, false), y: place(fig.supy, true) };
}

function layoutParts(fig: FigureSpec, mode: LayoutMode, dev: Device, tracer: Tracer): readonly AxesPart[] {
  const ext = fig.axes.map((ax) => tracer.span('datalimits', { artists: ax.artists.length }, (sp) => {
    const e = dataExtents(ax.artists); sp.setAttribute('values', e.x.count + e.y.count); return e;
  }));
  const Wpx = fig.widthIn * fig.dpi, Hpx = fig.heightIn * fig.dpi;
  // Limits first (no box size needed), then apply_aspect to each Axes' position, then ticks on the adjusted box.
  type Lim = { readonly lim: readonly [number, number]; readonly minpos: number };
  const limsX: Lim[] = [];
  const limsY: Lim[] = [];
  const limCache = new Map<string, Lim>();
  const limitsOf = (which: 'x' | 'y', i: number): Lim => {
    const lead = which === 'x' ? fig.axes[i].xShare : fig.axes[i].yShare;
    const key = `${which}${lead}`;
    const found = lookup(limCache, key);
    if (found.kind === 'some') return found.value;
    const group = fig.axes.map((_, j) => j).filter((j) => (which === 'x' ? fig.axes[j].xShare : fig.axes[j].yShare) === lead);
    const leader = fig.axes[lead];
    const spec = which === 'x' ? leader.x : leader.y;
    const sc = scaleOf(spec);
    const extent = unionExtent(group.map((j) => ext[j][which]));
    const lim = viewLimits(spec, sc, extent, which === 'x' ? fig.theme.axes.xmargin : fig.theme.axes.ymargin);
    const L: Lim = { lim, minpos: extent.minpos };
    limCache.set(key, L);
    return L;
  };
  for (let i = 0; i < fig.axes.length; i++) { limsX.push(limitsOf('x', i)); limsY.push(limitsOf('y', i)); }
  const adjusted: AxesSpec[] = fig.axes.map((ax, i) => {
    const afterExt = applyColorbarExtend(ax.position, ax.role, ax.colorbarExtend);
    const pos = applyAspect(afterExt, ax.aspect, ax.boxAspect, ax.anchor, limsX[i].lim, limsY[i].lim, scaleOf(ax.x), scaleOf(ax.y), Wpx, Hpx);
    return pos === ax.position ? ax : { ...ax, position: pos };
  });
  const fig2: FigureSpec = { ...fig, axes: adjusted };
  const planned = new Map<string, Shared>();
  const shared = (which: 'x' | 'y', i: number): Shared => {
    const lead = which === 'x' ? adjusted[i].xShare : adjusted[i].yShare;
    const key = `${which}${lead}`;
    const found = lookup(planned, key);
    if (found.kind === 'some') return found.value;
    const group = adjusted.map((_, j) => j).filter((j) => (which === 'x' ? adjusted[j].xShare : adjusted[j].yShare) === lead);
    const p = tracer.span(`plan.${which}`, { group: group.length }, () => planAxis(which, adjusted[lead], unionExtent(group.map((j) => ext[j][which])), fig2, tracer));
    planned.set(key, p);
    return p;
  };
  return adjusted.map((ax, i) => tracer.span('axes.layout', { artists: ax.artists.length, role: ax.role.kind, index: i, mode }, () =>
    layoutAxes({ ax, x: shared('x', i), y: shared('y', i), hasTwin: ax.role.kind === 'primary' && twinGroup(adjusted, i).length > 1 }, fig2, mode, dev, tracer)));
}

/** Each Axes' tight bbox (px, y down), as layoutFigure's meta[i].tight, without drawing what does not enter it. */
export function tightBoxes(fig: FigureSpec, tracer: Tracer): readonly TightBox[] {
  return layoutParts(fig, 'tight', 'agg', tracer).map((p) => p.meta.tight);
}

/** The figure's scene for one device: 'agg' (PNG) or 'svg' (see Device). Text and ticks are the same on both. */
export function layoutFigure(fig: FigureSpec, tracer: Tracer, dev: Device = 'agg'): { readonly scene: Scene; readonly meta: readonly AxesMeta[]; readonly annot: readonly AxesAnnot[] } {
  const parts = layoutParts(fig, 'scene', dev, tracer);
  const W = fig.widthIn * fig.dpi, H = fig.heightIn * fig.dpi, k = pxPerPt(fig.dpi);
  const figTexts: Node[] = [];
  // generic fig.text
  for (const t of fig.figText) {
    const x = t.x * W, y = H - t.y * H;
    figTexts.push(...labelNodes(placeText(t.text, t.sizePt, fig.dpi, resolveFace(fig.theme.font.families, t.weight), x, y, { kind: 'horizontal', ha: t.ha, va: t.va }), k, t.color));
  }
  // suptitle and supx/supylabel
  if (fig.suptitle.kind === 'some') {
    const s = fig.suptitle.value, x = s.x * W, y = H - s.y * H;
    figTexts.push(...labelNodes(placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'horizontal', ha: s.ha, va: s.va }), k, s.color));
  }
  if (fig.supx.kind === 'some') {
    const s = fig.supx.value, x = s.x * W, y = H - s.y * H;
    figTexts.push(...labelNodes(placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'horizontal', ha: s.ha, va: s.va }), k, s.color));
  }
  if (fig.supy.kind === 'some') {
    const s = fig.supy.value, x = s.x * W, y = H - s.y * H;
    const b = placeText(s.text, s.sizePt, fig.dpi, resolveFace(fig.theme.font.families, s.weight), x, y, { kind: 'vertical', ha: s.ha, va: s.va });
    figTexts.push(...labelNodes(b, k, s.color));
  }
  return {
    scene: { width: W, height: H, dpi: fig.dpi, background: fig.theme.figure.background, nodes: [...parts.flatMap((p) => p.nodes), ...figTexts] },
    meta: parts.map((p) => p.meta),
    annot: parts.map((p) => p.annot),
  };
}
