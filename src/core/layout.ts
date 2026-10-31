// Layout: FigureSpec -> Scene. Pure; composes the stages:
//   extents (shared across twins) -> view limits -> ticks -> artists -> axes -> spines -> text -> legend -> z-order
import type { Extent } from './autoscale.ts';
import { dataExtents, unionExtent, viewLimits } from './autoscale.ts';
import type { AxisDrawn, Sides } from './draw-axis.ts';
import { drawAxis, labelNodes } from './draw-axis.ts';
import type { Drawn } from './draw-artists.ts';
import { drawBar, drawFill, drawLine, drawText } from './draw-artists.ts';
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
import type { Artist, AxesMeta, AxesRole, AxesSpec, AxisBelow, AxisMeta, Clip, FigureSpec, GridSpec, LegendEntry, Node, Placement, Rgb, Scene, Seg, Theme, TickTheme } from './types.ts';
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
const gridOn = (g: GridSpec, axis: 'x' | 'y'): boolean => {
  switch (g.kind) {
    case 'off': return false;
    case 'on': return g.which === 'both' || g.which === axis;
    default: return assertNever(g);
  }
};
const axisMeta = (lim: readonly [number, number], t: TickSet): AxisMeta =>
  ({ lim, ticks: t.locs, labels: t.labels.map(tickLabelText), offset: t.offset, minor: t.minor, minorLabels: t.minorLabels.map(tickLabelText) });

// ---------------------------------------------------------------- what a role implies
type AxisVisibility = { readonly kind: 'hidden' } | { readonly kind: 'shown'; readonly sides: Sides };
type Roles = { readonly x: AxisVisibility; readonly y: AxisVisibility; readonly patch: boolean; readonly yOnRight: boolean };
const themeSides = (t: TickTheme): Sides => ({ near: t.near, far: t.far, labels: t.labelNear ? 'near' : 'none' });

/** twinx(): the twin hides its x axis and patch and ticks its y on the right; the host's y is ticked left only. */
function roleImplies(role: AxesRole, hasTwin: boolean, theme: Theme): Roles {
  switch (role.kind) {
    case 'primary':
      return { x: { kind: 'shown', sides: themeSides(theme.xtick) },
               y: { kind: 'shown', sides: hasTwin ? { near: true, far: false, labels: 'near' } : themeSides(theme.ytick) },
               patch: true, yOnRight: false };
    case 'twinx':
      return { x: { kind: 'hidden' }, y: { kind: 'shown', sides: { near: false, far: true, labels: 'far' } }, patch: false, yOnRight: true };
    default: return assertNever(role);
  }
}

/** Each artist's top-level groups carry its provenance, so interactive renderers can find its marks. */
const tagged = (d: Drawn, i: number, kind: string): Drawn =>
  ({ ...d, nodes: d.nodes.map((n): Node => (n.kind === 'group' ? { ...n, tag: `artist/${i}/${kind}` } : n)) });
function drawArtists(ax: AxesSpec, f: Frame, theme: Theme, k: number, clip: Clip, tracer: Tracer): readonly Drawn[] {
  return ax.artists.map((a, i) => tagged(drawArtist(a, f, theme, k, clip, tracer), i, a.kind));
}
function drawArtist(a: Artist, f: Frame, theme: Theme, k: number, clip: Clip, tracer: Tracer): Drawn {
  {
    switch (a.kind) {
      case 'line': return tracer.span('artist.line', { points: a.x.length, stroke: a.stroke.kind, markers: a.markers.kind }, (sp) => drawLine(a, f, theme, k, clip, sp));
      case 'bar': return tracer.span('artist.bar', { rects: a.x.length }, (sp) => drawBar(a, f, k, clip, sp));
      case 'fill': return tracer.span('artist.fill', { points: a.x.length }, () => drawFill(a, f, k, clip));
      case 'text': return tracer.span('artist.text', { text: a.text, coords: a.coords }, () => drawText(a, f, k * 72, resolveFace(theme.font.families, a.weight)));
      default: return assertNever(a);
    }
  }
}

/** _get_legend_handles: Axes children in order, then containers (bars). */
function legendEntries(ax: AxesSpec, drawn: readonly Drawn[]): readonly LegendEntry[] {
  const children: LegendEntry[] = [], containers: LegendEntry[] = [];
  ax.artists.forEach((a, i) => {
    if (a.kind === 'text' || a.label.kind === 'none') return;
    const h = drawn[i].handle;
    if (h.kind === 'none') return;
    const e: LegendEntry = { label: a.label.text, handle: h.value };
    switch (a.kind) {
      case 'line': case 'fill': children.push(e); break;     // collections are Axes children too
      case 'bar': containers.push(e); break;
      default: assertNever(a);
    }
  });
  return [...children, ...containers];
}

function spines(theme: Theme, f: Frame, k: number): readonly Node[] {
  const w = theme.axes.linewidthPt * k, b = f.box, s = theme.axes.spines;
  const x0 = snap(b.x0, w), x1 = snap(b.x1, w), yB = snap(b.yBot, w), yT = snap(b.yTop, w);
  // One Patch per spine, in Spines' order (left, right, bottom, top); Spine sets capstyle 'projecting'.
  const lines: (readonly Seg[])[] = [
    ...(s.left ? [[['M', x0, yB], ['L', x0, yT]] as const] : []),
    ...(s.right ? [[['M', x1, yB], ['L', x1, yT]] as const] : []),
    ...(s.bottom ? [[['M', x0, yB], ['L', x1, yB]] as const] : []),
    ...(s.top ? [[['M', x0, yT], ['L', x1, yT]] as const] : []),
  ];
  if (w <= 0) return [];
  return lines.map((segs) => pathNode(segs, { kind: 'stroke', stroke: { color: theme.axes.edge, width: w, cap: 'square', join: 'miter', dash: { kind: 'solid' } } }));
}

type AxisOut = { readonly near: readonly TextBox[]; readonly far: readonly TextBox[] };

/** Offset texts, axis labels, title (Axis._update_label_position / _update_offset_text_position). */
function decorations(ax: AxesSpec, roles: Roles, theme: Theme, f: Frame, k: number, dpi: number, xt: TickSet, yt: TickSet, xb: AxisOut, yb: AxisOut): readonly Node[] {
  const b = f.box, A = theme.axes, out: Node[] = [];
  const half = A.linewidthPt * k / 2;
  const put = (s: string, x: number, y: number, p: Placement, sizePt: number, color: Rgb, weight: number = theme.font.weight): void => {
    if (s !== '') out.push(...labelNodes(placeText(s, sizePt, dpi, resolveFace(theme.font.families, weight), x, y, p), k, color));
  };
  const pad = theme.offsetTextPadPt * k, lp = A.labelPadPt * k;
  if (roles.x.kind === 'shown') {
    let bottom = b.yBot + half;
    for (const lb of xb.near) bottom = Math.max(bottom, lb.y1);
    put(xt.offset, b.x1, bottom + pad, { kind: 'horizontal', ha: 'right', va: 'top' }, theme.xtick.labelSizePt, theme.xtick.color);
    put(ax.xlabel, (b.x0 + b.x1) / 2, bottom + lp, { kind: 'horizontal', ha: 'center', va: 'top' }, A.labelSizePt, A.labelColor, theme.font.labelWeight);
  }
  if (roles.yOnRight) {
    let right = b.x1 + half;
    for (const lb of yb.far) right = Math.max(right, lb.x1);
    put(yt.offset, b.x1, b.yTop - pad, { kind: 'horizontal', ha: 'right', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color);
    put(ax.ylabel, right + lp, (b.yTop + b.yBot) / 2, { kind: 'ylabelRight' }, A.labelSizePt, A.labelColor, theme.font.labelWeight);
  } else {
    let left = b.x0 - half;
    for (const lb of yb.near) left = Math.min(left, lb.x0);
    put(yt.offset, b.x0, b.yTop - pad, { kind: 'horizontal', ha: 'left', va: 'baseline' }, theme.ytick.labelSizePt, theme.ytick.color);
    put(ax.ylabel, left - lp, (b.yTop + b.yBot) / 2, { kind: 'ylabel' }, A.labelSizePt, A.labelColor, theme.font.labelWeight);
  }
  const tx0 = ax.titleLoc === 'left' ? b.x0 : ax.titleLoc === 'right' ? b.x1 : (b.x0 + b.x1) / 2;
  put(ax.title, tx0, b.yTop - A.titlePadPt * k, { kind: 'horizontal', ha: ax.titleLoc, va: 'baseline' }, A.titleSizePt, A.titleColor, ax.titleWeight);
  return out;
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
type SharedX = { readonly lim: readonly [number, number]; readonly ticks: TickSet; readonly minpos: number };
type AxesIn = { readonly ax: AxesSpec; readonly x: SharedX; readonly yExtent: Extent; readonly hasTwin: boolean };

function planX(ax: AxesSpec, extent: Extent, fig: FigureSpec, tracer: Tracer): SharedX {
  const theme = fig.theme, dpi = fig.dpi;
  const box = axesBox(ax.position, fig.widthIn * dpi, fig.heightIn * dpi);
  const xs = scaleOf(ax.x);
  const lim = tracer.span('limits.x', { mode: ax.x.limits.kind, scale: xs.kind }, () => viewLimits(ax.x, xs, extent, theme.axes.xmargin));
  const ticks = tracer.span('ticks.x', { axis: ax.x.kind, scale: xs.kind, ticks: ax.x.ticks.kind, labels: ax.x.labels.kind },
    (sp) => { const t = computeTicks(ax.x, lim, tickSpace('x', box.w, dpi, theme.xtick.labelSizePt), theme, extent.minpos); sp.setAttribute('major', t.locs.length).setAttribute('minor', t.minor.length).setAttribute('offset', t.offset); return t; });
  return { lim, ticks, minpos: extent.minpos };
}

function layoutAxes(inp: AxesIn, fig: FigureSpec, tracer: Tracer): { readonly nodes: readonly Node[]; readonly meta: AxesMeta } {
  const { ax } = inp;
  const theme = fig.theme, dpi = fig.dpi, k = pxPerPt(dpi);
  const W = fig.widthIn * dpi, H = fig.heightIn * dpi;
  const box = axesBox(ax.position, W, H);
  const roles = roleImplies(ax.role, inp.hasTwin, theme);
  const xs = scaleOf(ax.x), ys = scaleOf(ax.y);

  const xlim = inp.x.lim;
  const ylim = tracer.span('limits.y', { mode: ax.y.limits.kind, scale: ys.kind }, () => viewLimits(ax.y, ys, inp.yExtent, theme.axes.ymargin));
  const xt = inp.x.ticks;
  const yt = tracer.span('ticks.y', { axis: ax.y.kind, scale: ys.kind, ticks: ax.y.ticks.kind, labels: ax.y.labels.kind },
    (sp) => { const t = computeTicks(ax.y, ylim, tickSpace('y', box.h, dpi, theme.ytick.labelSizePt), theme, inp.yExtent.minpos); sp.setAttribute('major', t.locs.length).setAttribute('minor', t.minor.length).setAttribute('offset', t.offset); return t; });
  const f = frame(box, H, xlim, ylim, xs, ys);
  const clip: Clip = { kind: 'rect', x: box.x0, y: box.yTop, w: box.w, h: box.h };

  const face = roles.patch ? inkOf(theme.axes.face, none) : none;
  // The axes patch is a rectilinear, edgeless path: Agg snaps its corners to whole pixels (snap value 0).
  const bx0 = snap(box.x0, 0), bx1 = snap(box.x1, 0), by0 = snap(box.yTop, 0), by1 = snap(box.yBot, 0);
  const background: readonly Node[] = face.kind === 'some' ? [rectNode(bx0, by0, bx1 - bx0, by1 - by0, face.value)] : [];
  const drawn = tracer.span('artists', { count: ax.artists.length }, () => drawArtists(ax, f, theme, k, clip, tracer));
  // z-order 1: patches and collections, in the order added; 2: lines; 3: texts (before the titles)
  const zOf = (i: number): number => { const kd = ax.artists[i].kind; return kd === 'bar' || kd === 'fill' ? 1 : kd === 'line' ? 2 : 3; };
  const patches = drawn.flatMap((d, i) => (zOf(i) === 1 ? d.nodes : []));
  const lines = drawn.flatMap((d, i) => (zOf(i) === 2 ? d.nodes : []));
  const userTexts = drawn.flatMap((d, i) => (zOf(i) === 3 ? d.nodes : []));
  const xa = shown(roles.x, (sides) => tracer.span('axis.x', { ticks: xt.visible.length }, () => drawAxis('x', xt, theme.xtick, sides, gridOn(ax.grid, 'x'), f, theme, dpi, tracer)));
  const ya = shown(roles.y, (sides) => tracer.span('axis.y', { ticks: yt.visible.length, side: roles.yOnRight ? 'right' : 'left' },
    () => drawAxis('y', yt, theme.ytick, sides, gridOn(ax.grid, 'y'), f, theme, dpi, tracer)));
  const texts = tracer.span('decorations', { role: ax.role.kind }, () =>
    decorations(ax, roles, theme, f, k, dpi, xt, yt, { near: xa.nearBoxes, far: xa.farBoxes }, { near: ya.nearBoxes, far: ya.farBoxes }));

  const entries = legendEntries(ax, drawn);
  const axesUp: Box = { x0: box.x0, x1: box.x1, y0: H - box.yBot, y1: H - box.yTop };
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
    [1, patches], [2, lines], [2.5, spines(theme, f, k)],
    [axisZ(theme.axes.axisBelow), [...clipped(xa.grid), ...xa.marks, ...clipped(ya.grid), ...ya.marks]],
    [3, [...userTexts, ...texts]], [5, legend.kind === 'some' ? legend.value.out.nodes : []],
  ];
  const nodes = [...background, ...layers.toSorted((a, b) => a[0] - b[0]).flatMap(([, n]) => n)];
  return {
    nodes,
    meta: {
      x: axisMeta(xlim, xt), y: axisMeta(ylim, yt),
      frame: { box: { x0: box.x0, x1: box.x1, yTop: box.yTop, yBot: box.yBot }, xlim, ylim, xscale: xs, yscale: ys, H },
      legend: legend.kind === 'some'
        ? some({ loc: legend.value.code.kind === 'best' ? 0 : legend.value.code.code, x0: legend.value.out.box.x0, x1: legend.value.out.box.x1,
                 top: H - legend.value.out.box.y1, bottom: H - legend.value.out.box.y0 })
        : none,
    },
  };
}

/** The axes whose x is shared with axes i: its host group (host + all twins of that host). */
function xGroup(axes: readonly AxesSpec[], i: number): readonly number[] {
  const root = (j: number): number => { const r = axes[j].role; return r.kind === 'twinx' ? r.host : j; };
  const host = root(i);
  return axes.map((_, j) => j).filter((j) => root(j) === host);
}

export function layoutFigure(fig: FigureSpec, tracer: Tracer): { readonly scene: Scene; readonly meta: readonly AxesMeta[] } {
  const ext = fig.axes.map((ax) => tracer.span('datalimits', { artists: ax.artists.length }, (sp) => {
    const e = dataExtents(ax.artists); sp.setAttribute('values', e.x.count + e.y.count); return e;
  }));
  // plan: one shared x (limits + ticks) per twin group; apply: every member reuses it
  const planned = new Map<number, SharedX>();
  const sharedX = (i: number): SharedX => {
    const group = xGroup(fig.axes, i), root = group[0];
    const found = lookup(planned, root);
    if (found.kind === 'some') return found.value;
    const p = tracer.span('plan.x', { group: group.length }, () => planX(fig.axes[root], unionExtent(group.map((j) => ext[j].x)), fig, tracer));
    planned.set(root, p);
    return p;
  };
  const parts = fig.axes.map((ax, i) => tracer.span('axes.layout', { artists: ax.artists.length, role: ax.role.kind }, () =>
    layoutAxes({ ax, x: sharedX(i), yExtent: ext[i].y, hasTwin: ax.role.kind === 'primary' && xGroup(fig.axes, i).length > 1 }, fig, tracer)));
  return {
    scene: { width: fig.widthIn * fig.dpi, height: fig.heightIn * fig.dpi, dpi: fig.dpi, background: fig.theme.figure.background, nodes: parts.flatMap((p) => p.nodes) },
    meta: parts.map((p) => p.meta),
  };
}
