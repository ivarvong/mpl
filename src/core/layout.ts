// Layout: FigureSpec -> Scene. Pure; composes the stages:
//   extents (shared across twins) -> view limits -> ticks -> artists -> axes -> spines -> text -> legend -> z-order
import type { Extent } from './autoscale.ts';
import { dataExtents, unionExtent, viewLimits } from './autoscale.ts';
import type { AxisDrawn, Sides } from './draw-axis.ts';
import { drawAxis, labelNodes } from './draw-axis.ts';
import type { Drawn } from './draw-artists.ts';
import { drawBar, drawFill, drawLine, drawText, drawScatter, drawSpan, drawAnnotation } from './draw-artists.ts';
import type { Frame } from './frame.ts';
import { axesBox, frame } from './frame.ts';
import { layoutLegend } from './legend.ts';
import type { Box } from './legend-index.ts';
import { tickLabelText } from './log.ts';
import { inkOf, pathNode, rectNode, snap } from './scene.ts';
import { lookup } from './std.ts';
import type { TextBox } from './text.ts';
import { placeText, pxPerPt } from './text.ts';
import { resolveFace } from './fonts.ts';
import type { TickSet } from './ticks.ts';
import { computeTicks, scaleOf, tickSpace } from './ticks.ts';
import type { Option, Artist, AxesMeta, AxesRole, AxesSpec, AxisBelow, AxisMeta, Clip, FigureSpec, LegendEntry, Node, Placement, PxBox, Rgb, Scene, Stroke, Theme, TickTheme } from './types.ts';
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
      default: return assertNever(a);
    }
  }
}

/** _get_legend_handles: Axes children in order, then containers (bars). */
function legendEntries(ax: AxesSpec, drawn: readonly Drawn[]): readonly LegendEntry[] {
  const children: LegendEntry[] = [], containers: LegendEntry[] = [];
  ax.artists.forEach((a, i) => {
    if (a.kind === 'text' || a.kind === 'annotation') return;
    if (a.label.kind === 'none') return;
    const h = drawn[i].handle;
    if (h.kind === 'none') return;
    const e: LegendEntry = { label: a.label.text, handle: h.value };
    switch (a.kind) {
      case 'line': case 'fill': case 'scatter': children.push(e); break;     // collections are Axes children too
      case 'bar': case 'span': containers.push(e); break;
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
    const x = snap(b.x0 - off, w), y0 = snap(b.yBot, w), y1 = snap(b.yTop, w);
    sides.push({ side: 'left', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('right')) {
    const w = wOf('right'); const off = outwardPx('right');
    const x = snap(b.x1 + off, w), y0 = snap(b.yBot, w), y1 = snap(b.yTop, w);
    sides.push({ side: 'right', x0: x, y0, x1: x, y1 });
  }
  if (sideOn('bottom')) {
    const w = wOf('bottom'); const off = outwardPx('bottom');
    const y = snap(b.yBot + off, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
    sides.push({ side: 'bottom', x0, y0: y, x1, y1: y });
  }
  if (sideOn('top')) {
    const w = wOf('top'); const off = outwardPx('top');
    const y = snap(b.yTop - off, w), x0 = snap(b.x0, w), x1 = snap(b.x1, w);
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

type AxisOut = { readonly near: readonly TextBox[]; readonly far: readonly TextBox[] };

/** What each decoration occupies, for Axes.get_tightbbox. An empty Text's extent is a point,
 *  which Axis.get_tightbbox drops (Bbox._is_finite), so empty labels take no room. */
type DecoBoxes = { readonly x: readonly PxBox[]; readonly y: readonly PxBox[]; readonly title: Option<PxBox> };
type Decorated = { readonly nodes: readonly Node[]; readonly boxes: DecoBoxes };
/** for_layout_only: an x label keeps 1 px of its width, a y label 1 px of its height (centred) */
const collapseX = (b: PxBox): PxBox => (b.x1 > b.x0 ? { ...b, x0: (b.x0 + b.x1) / 2 - 0.5, x1: (b.x0 + b.x1) / 2 + 0.5 } : b);
const collapseY = (b: PxBox): PxBox => (b.y1 > b.y0 ? { ...b, y0: (b.y0 + b.y1) / 2 - 0.5, y1: (b.y0 + b.y1) / 2 + 0.5 } : b);
const optBox = (o: Option<PxBox>, adjust: (box: PxBox) => PxBox = (box) => box): readonly PxBox[] => (o.kind === 'some' ? [adjust(o.value)] : []);
export const unionBox = (bs: readonly PxBox[]): PxBox => ({
  x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
  x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
});

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
  const xBoxes: PxBox[] = [], yBoxes: PxBox[] = [];
  if (roles.x.kind === 'shown') {
    let bottom = b.yBot + half;
    for (const lb of xb.near) bottom = Math.max(bottom, lb.y1);
    if (!ax.hiddenLabels.x) xBoxes.push(...optBox(put(xt.offset, b.x1, bottom + pad, { kind: 'horizontal', ha: 'right', va: 'top' }, theme.xtick.labelSizePt, theme.xtick.color)));
    xBoxes.push(...optBox(put(ax.xlabel, (b.x0 + b.x1) / 2, bottom + lp, { kind: 'horizontal', ha: 'center', va: 'top' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseX));
  }
  if (roles.yOnRight) {
    let right = b.x1 + half;
    for (const lb of yb.far) right = Math.max(right, lb.x1);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x1, b.yTop - pad, { kind: 'horizontal', ha: 'right', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, right + lp, (b.yTop + b.yBot) / 2, { kind: 'ylabelRight' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  } else {
    let left = b.x0 - half;
    for (const lb of yb.near) left = Math.min(left, lb.x0);
    if (!ax.hiddenLabels.y) yBoxes.push(...optBox(put(yt.offset, b.x0, b.yTop - pad, { kind: 'horizontal', ha: 'left', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color)));
    yBoxes.push(...optBox(put(ax.ylabel, left - lp, (b.yTop + b.yBot) / 2, { kind: 'ylabel' }, A.labelSizePt, A.labelColor, theme.font.labelWeight), collapseY));
  }
  const tx0 = ax.titleLoc === 'left' ? b.x0 : ax.titleLoc === 'right' ? b.x1 : (b.x0 + b.x1) / 2;
  const tb = put(ax.title, tx0, b.yTop - A.titlePadPt * k, { kind: 'horizontal', ha: ax.titleLoc, va: 'baseline' }, A.titleSizePt, A.titleColor, ax.titleWeight);
  // Axes.get_tightbbox keeps 1 px of a title's width; zero-size boxes (empty titles) drop out
  return { nodes: out, boxes: { x: xBoxes, y: yBoxes, title: tb.kind === 'some' ? some(collapseX(tb.value)) : none } };
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

const NOTHING: AxisDrawn = { grid: [], marks: [], nearBoxes: [], farBoxes: [] };
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

function layoutAxes(inp: AxesIn, fig: FigureSpec, tracer: Tracer): { readonly nodes: readonly Node[]; readonly meta: AxesMeta } {
  const { ax } = inp;
  const theme = fig.theme, dpi = fig.dpi, k = pxPerPt(dpi);
  const W = fig.widthIn * dpi, H = fig.heightIn * dpi;
  const box = axesBox(ax.position, W, H);
  const roles = roleImplies(ax.role, inp.hasTwin, theme, ax.hiddenLabels);
  const xs = scaleOf(ax.x), ys = scaleOf(ax.y);

  const xlim = inp.x.lim, ylim = inp.y.lim;
  const xt = inp.x.ticks, yt = inp.y.ticks;
  const f = frame(box, W, H, xlim, ylim, xs, ys);
  const clip: Clip = { kind: 'rect', x: box.x0, y: box.yTop, w: box.w, h: box.h };

  const face = roles.patch ? inkOf(theme.axes.face, none) : none;
  // The axes patch is a rectilinear, edgeless path: Agg snaps its corners to whole pixels (snap value 0).
  const bx0 = snap(box.x0, 0), bx1 = snap(box.x1, 0), by0 = snap(box.yTop, 0), by1 = snap(box.yBot, 0);
  const background: readonly Node[] = face.kind === 'some' ? [rectNode(bx0, by0, bx1 - bx0, by1 - by0, face.value)] : [];
  const drawn = tracer.span('artists', { count: ax.artists.length }, () => drawArtists(ax, f, theme, k, clip, tracer));
  // z-order 1: patches and collections, in the order added; 2: lines; 3: texts (before the titles)
  const zOf = (i: number): number => {
    const kd = ax.artists[i].kind;
    return kd === 'bar' || kd === 'fill' || kd === 'span' ? 1 : kd === 'line' || kd === 'scatter' ? 2 : 3;
  };
  const patches = drawn.flatMap((d, i) => (zOf(i) === 1 ? d.nodes : []));
  const lines = drawn.flatMap((d, i) => (zOf(i) === 2 ? d.nodes : []));
  const userTexts = drawn.flatMap((d, i) => (zOf(i) === 3 ? d.nodes : []));
  // Spine outward offsets move the axis baseline (ticks and labels follow)
  const offPx = (side: 'left' | 'right' | 'top' | 'bottom'): number => {
    const p = ax.spines[side].position;
    return p.kind === 'some' && p.value.kind === 'outward' ? p.value.pts * k : 0;
  };
  const baseX = { xLeft: box.x0 - offPx('left'), xRight: box.x1 + offPx('right') };
  const baseY = { yBottom: box.yBot + offPx('bottom'), yTop: box.yTop - offPx('top') };
  const bases = { ...baseX, ...baseY };
  const xa = shown(roles.x, (sides) => tracer.span('axis.x', { ticks: xt.visible.length }, () =>
    drawAxis('x', xt, ax.tick.x, sides, ax.grid.x, ax.tickLabels.x, f, theme, dpi, tracer, bases)));
  const ya = shown(roles.y, (sides) => tracer.span('axis.y', { ticks: yt.visible.length, side: roles.yOnRight ? 'right' : 'left' }, () =>
    drawAxis('y', yt, ax.tick.y, sides, ax.grid.y, ax.tickLabels.y, f, theme, dpi, tracer, bases)));
  const decTheme: Theme = { ...theme, xtick: ax.tick.x, ytick: ax.tick.y };
  const deco = tracer.span('decorations', { role: ax.role.kind }, () =>
    decorations(ax, roles, decTheme, f, k, dpi, xt, yt, { near: xa.nearBoxes, far: xa.farBoxes }, { near: ya.nearBoxes, far: ya.farBoxes }));

  const entries = legendEntries(ax, drawn);
  const axesUp: Box = { x0: box.x0, x1: box.x1, y0: box.b, y1: box.t };
  const spec = ax.legend;
  const legend = spec.kind === 'on' && entries.length > 0
    ? some({ code: spec.loc, out: tracer.span('legend', { entries: entries.length }, () => layoutLegend({
        entries, theme, dpi, H, axesBox: axesUp, lines: drawn.flatMap((d) => d.lines), boxes: drawn.flatMap((d) => d.boxes),
        loc: spec.loc, ncols: spec.ncols, frame: spec.frame, fontSizePt: spec.fontSizePt }, tracer)) })
    : none;

  // Gridlines clip to the axes like every artist; each Axis draws as a unit (x, then y).
  const clipped = (ns: readonly Node[]): readonly Node[] => (ns.length > 0 ? [{ kind: 'group', clip, nodes: ns, tag: '' }] : []);
  // z-order: patches 1, axis (grid/ticks) per axisbelow, lines 2, spines 2.5, text 3, legend 5. The sort is
  // stable and ties keep matplotlib's get_children order (children, spines, then the axes), which
  // matters for axisbelow=False: the axis (2.5) then draws over the spines (2.5).
  const layers: ReadonlyArray<readonly [number, readonly Node[]]> = [
    [1, patches], [2, lines], [2.5, spinesForAxes(ax, theme, f, k)],
    [axisZ(theme.axes.axisBelow), [...clipped(xa.grid), ...xa.marks, ...clipped(ya.grid), ...ya.marks]],
    [3, [...userTexts, ...deco.nodes]], [5, legend.kind === 'some' ? legend.value.out.nodes : []],
  ];
  const nodes = [...background, ...layers.toSorted((a, b) => a[0] - b[0]).flatMap(([, n]) => n)];
  return {
    nodes,
    meta: {
      x: axisMeta(xlim, xt, ax.hiddenLabels.x), y: axisMeta(ylim, yt, ax.hiddenLabels.y),
      frame: { box: { x0: box.x0, x1: box.x1, yTop: box.yTop, yBot: box.yBot }, xlim, ylim, xscale: xs, yscale: ys, H },
      tight: unionBox([
        { x0: box.x0, y0: box.yTop, x1: box.x1, y1: box.yBot },
        ...(roles.x.kind === 'shown' ? [...xa.nearBoxes, ...xa.farBoxes, ...deco.boxes.x] : []),
        ...(roles.y.kind === 'shown' ? [...ya.nearBoxes, ...ya.farBoxes, ...deco.boxes.y] : []),
        ...(deco.boxes.title.kind === 'some' ? [deco.boxes.title.value] : []),
        ...spineBoxes(ax, roles, theme, f, k, xt, yt),
        ...(legend.kind === 'some' ? [{ x0: legend.value.out.box.x0, x1: legend.value.out.box.x1, y0: H - legend.value.out.box.y1, y1: H - legend.value.out.box.y0 }] : []),
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

export function layoutFigure(fig: FigureSpec, tracer: Tracer): { readonly scene: Scene; readonly meta: readonly AxesMeta[] } {
  const ext = fig.axes.map((ax) => tracer.span('datalimits', { artists: ax.artists.length }, (sp) => {
    const e = dataExtents(ax.artists); sp.setAttribute('values', e.x.count + e.y.count); return e;
  }));
  // plan: one set of limits and ticks per share group (sharex/sharey, twinx); apply: every member reuses it
  const planned = new Map<string, Shared>();
  const shared = (which: 'x' | 'y', i: number): Shared => {
    const lead = which === 'x' ? fig.axes[i].xShare : fig.axes[i].yShare;
    const key = `${which}${lead}`;
    const found = lookup(planned, key);
    if (found.kind === 'some') return found.value;
    const group = fig.axes.map((_, j) => j).filter((j) => (which === 'x' ? fig.axes[j].xShare : fig.axes[j].yShare) === lead);
    const p = tracer.span(`plan.${which}`, { group: group.length }, () => planAxis(which, fig.axes[lead], unionExtent(group.map((j) => ext[j][which])), fig, tracer));
    planned.set(key, p);
    return p;
  };
  const parts = fig.axes.map((ax, i) => tracer.span('axes.layout', { artists: ax.artists.length, role: ax.role.kind, index: i }, () =>
    layoutAxes({ ax, x: shared('x', i), y: shared('y', i), hasTwin: ax.role.kind === 'primary' && twinGroup(fig.axes, i).length > 1 }, fig, tracer)));
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
  };
}
