// One axis: grid lines, major and minor tick marks, tick labels. Ticks are drawn from
// a spine along its outward normal; labels sit outside the tick by its pad.
import type { Frame } from './frame.ts';
import { tx, ty, tyText } from './frame.ts';
import { forward } from './scale.ts';
import { lineStroke } from './marks.ts';
import { resolveFace } from './fonts.ts';
import { pathNode, snapIf, snapOffset } from './scene.ts';
import type { TextBox } from './text.ts';
import { measureLabel, placeLayout, pxPerPt, strokePx, windowExtent } from './text.ts';
import type { TickSet } from './ticks.ts';
import type { TickLabelStyles, AxisGrid, GridLines, Node, Rgb, Seg, Stroke, Theme, TickDirection, TickTheme, TickGrid } from './types.ts';
import { assertNever, none } from './types.ts';
import { lookup } from './std.ts';
import type { Tracer } from '../trace.ts';

/** Which spines carry ticks and which side gets labels (x: near=bottom, y: near=left). */
export type Sides = { readonly near: boolean; readonly far: boolean; readonly labels: 'near' | 'far' | 'none' };
export type UpEdges = { readonly b: number; readonly t: number };
const flipped = (H: number, b: TextBox): UpEdges => ({ b: H - b.y1, t: H - b.y0 });
const upOf = (e: { readonly y0: number; readonly y1: number }): UpEdges => ({ b: e.y0, t: e.y1 });
export type AxisDrawn = {
  readonly grid: readonly Node[]; readonly marks: readonly Node[];
  readonly nearBoxes: readonly TextBox[]; readonly farBoxes: readonly TextBox[];
  /** each near / far label's bottom and top edges in display y-up, in matplotlib's arithmetic */
  readonly nearUp: readonly UpEdges[]; readonly farUp: readonly UpEdges[];
};

function tickExtent(dir: TickDirection, size: number): readonly [number, number] {
  switch (dir) {
    case 'out': return [0, size];
    case 'in': return [0, -size];
    case 'inout': return [-size / 2, size / 2];
    default: return assertNever(dir);
  }
}
/** Tick.get_tick_padding: how far the tick sticks out past the spine. */
function tickPadding(dir: TickDirection, size: number): number {
  switch (dir) {
    case 'out': return size;
    case 'in': return 0;
    case 'inout': return size / 2;
    default: return assertNever(dir);
  }
}

/** Text nodes for a placed label: one per run (mathtext has several). */
export function labelNodes(b: TextBox, k: number, color: Rgb): readonly Node[] {
  return b.runs.filter((r) => r.text !== '').map((r): Node => {
    if (b.rotation === 'horizontal') {
      // y = baseline; dy = y-down run offset. Agg FT y is (H - y) - dy (= (H - y) + dy_up) — must not bake dy into y.
      return { kind: 'text', text: r.text, x: b.penX + r.dx, y: b.penY, dy: r.dy, sizePx: r.sizePt * k, sizePt: r.sizePt, glyphs: r.glyphs, face: r.face, color, rotation: 'horizontal' };
    }
    if (b.rotation === 'vertical') {
      return { kind: 'text', text: r.text, x: b.penX + r.dy, y: b.penY - r.dx, dy: 0, sizePx: r.sizePt * k, sizePt: r.sizePt, glyphs: r.glyphs, face: r.face, color, rotation: 'vertical' };
    }
    // angled: baseline origin at (penX, penY); glyph advances are applied inside the renderer via cos/sin
    return { kind: 'text', text: r.text, x: b.penX, y: b.penY, dy: r.dy, sizePx: r.sizePt * k, sizePt: r.sizePt, glyphs: r.glyphs, face: r.face, color, rotation: b.rotation };
  });
}

/** Gridlines of a tick family are drawn when shown with a visible linestyle; each family snaps at its own width. */
const gridDrawn = (g: TickGrid): boolean => g.on && g.lines.style.kind === 'some' && g.lines.widthPt > 0;

export function drawAxis(
  axis: 'x' | 'y',
  ticks: TickSet,
  tt: TickTheme,
  sides: Sides,
  grid: AxisGrid,
  labelStyles: TickLabelStyles,
  f: Frame,
  theme: Theme,
  dpi: number,
  tracer: Tracer,
  base: { readonly xLeft: number; readonly xRight: number; readonly yBottom: number; readonly yTop: number; readonly yBottomG: number; readonly yTopG: number },
): AxisDrawn {
  const k = pxPerPt(dpi);
  const snap = (v: number, w: number): number => snapIf(f.snap, v, w);
  // all baselines taken from `bases`
  const bases = base;
  const majorSegs: Seg[] = [], minorSegs: Seg[] = [], majorGrid: Seg[] = [], minorGrid: Seg[] = [], labels: Node[] = [];
  const nearBoxes: TextBox[] = [], farBoxes: TextBox[] = [];
  // labels' edges in display y-up, in matplotlib's arithmetic (flipped from y-down under a spine offset)
  const nearUp: UpEdges[] = [], farUp: UpEdges[] = [];
  const face = resolveFace(theme.font.families, theme.font.weight);
  const styles = new Map(labelStyles);
  for (const t of ticks.visible) {
    tracer.span('tick', { axis, loc: t.loc, minor: t.minor, label: t.label.kind === 'plain' ? t.label.text : `${t.label.base}^${t.label.exponent}` }, (sp) => {
      const size = (t.minor ? tt.minorSizePt : tt.sizePt) * k;
      const width = (t.minor ? tt.minorWidthPt : tt.widthPt) * k;
      const pad = (t.minor ? tt.minorPadPt : tt.padPt) * k;
      const [e0, e1] = tickExtent(tt.direction, size);
      const out = tickPadding(tt.direction, size) + pad;
      // Tick._pad (points) = base pad + get_tick_padding; the label sits ScaledTranslation(0, ∓_pad/72) off the spine
      const padPts = (t.minor ? tt.minorPadPt : tt.padPt) + tickPadding(tt.direction, t.minor ? tt.minorSizePt : tt.sizePt);
      const segs = t.minor ? minorSegs : majorSegs;
      // Ticks are markers: Agg snaps the marker path (offsets from the tick origin) and the origin separately.
      // matplotlib's SVG writes the marker at its exact origin with the unsnapped path (f.snap false).
      const te = (b0: number, e: number): number => (f.snap ? Math.floor(b0 + 0.5) + Math.floor(e + 0.5) + snapOffset(width) : b0 + e);
      // a styled major label (Text.set_fontsize/set_fontweight/set_color on Tick.label1) keeps its own font
      const st = t.minor ? none : lookup(styles, t.index);
      const sizePt = st.kind === 'some' && st.value.sizePt.kind === 'some' ? st.value.sizePt.value : tt.labelSizePt;
      const lface = st.kind === 'some' && st.value.weight.kind === 'some' ? resolveFace(theme.font.families, st.value.weight.value) : face;
      const lcolor = st.kind === 'some' && st.value.color.kind === 'some' ? st.value.color.value : tt.labelColor;
      // Text._get_multialignment: lines of a multi-line label align like the label (x: center, y: right/left)
      const malign: 'left' | 'center' | 'right' = (st.kind === 'some' && st.value.ha.kind === 'some')
        ? st.value.ha.value
        : (axis === 'x' ? 'center' : sides.labels === 'far' ? 'left' : 'right');
      const lay = measureLabel(t.label, sizePt, dpi, lface, malign);
      const g = t.minor ? grid.minor : grid.major;
      const gridOn = gridDrawn(g), gridSegs = t.minor ? minorGrid : majorGrid, glw = strokePx(g.lines.widthPt, k);
      if (axis === 'x') {
        const d = tx(f, t.loc), x = snap(d, width);
        // grid and tick marks are paths (flipped with Hg); labels are text (flipped with H)
        if (gridOn) gridSegs.push(['M', snap(d, glw), snap(bases.yBottomG, glw)], ['L', snap(d, glw), snap(bases.yTopG, glw)]);
        if (sides.near) segs.push(['M', x, te(bases.yBottomG, e0)], ['L', x, te(bases.yBottomG, e1)]);          // bottom: outward is +y
        if (sides.far) segs.push(['M', x, te(bases.yTopG, -e0)], ['L', x, te(bases.yTopG, -e1)]);           // top: outward is -y
        if (sides.labels === 'near') {
          const hidden = st.kind === 'some' && st.value.visible.kind === 'some' && st.value.visible.value === false;
          if (!hidden) {
            const ha = st.kind === 'some' && st.value.ha.kind === 'some' ? st.value.ha.value : 'center';
            const rot = st.kind === 'some' && st.value.rotation.kind === 'some' ? st.value.rotation.value : 0;
            const place = rot === 0
              ? { kind: 'horizontal' as const, ha, va: 'top' as const }
              : { kind: 'angled' as const, deg: rot, ha, va: 'top' as const };
            const b = placeLayout(lay, d, bases.yBottom + out, place); nearBoxes.push(b); labels.push(...labelNodes(b, k, lcolor));
            nearUp.push(bases.yBottom === f.box.yBot ? upOf(windowExtent(lay, d, f.box.b + (-1 * padPts / 72) * dpi, ha, 'top')) : flipped(f.H, b));
          }
        }
        if (sides.labels === 'far') {
          const hidden = st.kind === 'some' && st.value.visible.kind === 'some' && st.value.visible.value === false;
          if (!hidden) {
            const ha = st.kind === 'some' && st.value.ha.kind === 'some' ? st.value.ha.value : 'center';
            const rot = st.kind === 'some' && st.value.rotation.kind === 'some' ? st.value.rotation.value : 0;
            const place = rot === 0
              ? { kind: 'horizontal' as const, ha, va: 'bottom' as const }
              : { kind: 'angled' as const, deg: rot, ha, va: 'bottom' as const };
            const b = placeLayout(lay, d, bases.yTop - out, place); farBoxes.push(b); labels.push(...labelNodes(b, k, lcolor));
            farUp.push(bases.yTop === f.box.yTop ? upOf(windowExtent(lay, d, f.box.t + (padPts / 72) * dpi, ha, 'bottom')) : flipped(f.H, b));
          }
        }
      } else {
        const d = tyText(f, t.loc), y = snap(ty(f, t.loc), width), dg = ty(f, t.loc);
        if (gridOn) gridSegs.push(['M', snap(bases.xLeft, glw), snap(dg, glw)], ['L', snap(bases.xRight, glw), snap(dg, glw)]);
        if (sides.near) segs.push(['M', te(bases.xLeft, -e0), y], ['L', te(bases.xLeft, -e1), y]);          // left: outward is -x
        if (sides.far) segs.push(['M', te(bases.xRight, e0), y], ['L', te(bases.xRight, e1), y]);           // right: outward is +x
        // a y label's anchor is transData's y (the ScaledTranslation is horizontal): (v·a + 0) + c
        const yUp = forward(f.yscale, t.loc) * f.ay + f.cy;
        if (sides.labels === 'near') { const b = placeLayout(lay, bases.xLeft - out, d, { kind: 'horizontal', ha: 'right', va: 'center_baseline' }); nearBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); nearUp.push(upOf(windowExtent(lay, b.x1, yUp, 'right', 'center_baseline'))); }
        if (sides.labels === 'far') { const b = placeLayout(lay, bases.xRight + out, d, { kind: 'horizontal', ha: 'left', va: 'center_baseline' }); farBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); farUp.push(upOf(windowExtent(lay, b.x0, yUp, 'left', 'center_baseline'))); }
      }
      sp.setAttribute('w', +lay.width.toFixed(2));
    });
  }
  // Gridlines are Line2Ds: caps and joins follow lines.{solid,dash}_{cap,join}style.
  const gridPath = (segs: readonly Seg[], gl: GridLines): readonly Node[] => {
    if (segs.length === 0 || gl.style.kind !== 'some') return [];
    const stroke: Stroke = lineStroke(theme, { hex: gl.color.hex, alpha: gl.alpha }, gl.widthPt, gl.style.value, k);
    return stroke.color.alpha > 0 ? [pathNode(segs, { kind: 'stroke', stroke })] : [];
  };
  const tickPath = (segs: readonly Seg[], widthPt: number): readonly Node[] =>
    segs.length > 0 && widthPt > 0 ? [pathNode(segs, { kind: 'stroke', stroke: { color: tt.color, width: strokePx(widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } } })] : [];
  return {
    grid: [...gridPath(majorGrid, grid.major.lines), ...gridPath(minorGrid, grid.minor.lines)],
    marks: [...labels, ...tickPath(majorSegs, tt.widthPt), ...tickPath(minorSegs, tt.minorWidthPt)],
    nearBoxes, farBoxes, nearUp, farUp,
  };
}
