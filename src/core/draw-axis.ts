// One axis: grid lines, major and minor tick marks, tick labels. Ticks are drawn from
// a spine along its outward normal; labels sit outside the tick by its pad.
import type { Frame } from './frame.ts';
import { tx, ty } from './frame.ts';
import { lineStroke } from './marks.ts';
import { resolveFace } from './fonts.ts';
import { pathNode, snap, snapOffset } from './scene.ts';
import type { TextBox } from './text.ts';
import { measureLabel, placeLayout, pxPerPt, strokePx } from './text.ts';
import type { TickSet } from './ticks.ts';
import type { TickLabelStyles, AxisGrid, GridLines, Node, Rgb, Seg, Stroke, Theme, TickDirection, TickTheme, TickGrid } from './types.ts';
import { assertNever, none } from './types.ts';
import { lookup } from './std.ts';
import type { Tracer } from '../trace.ts';

/** Which spines carry ticks and which side gets labels (x: near=bottom, y: near=left). */
export type Sides = { readonly near: boolean; readonly far: boolean; readonly labels: 'near' | 'far' | 'none' };
export type AxisDrawn = {
  readonly grid: readonly Node[]; readonly marks: readonly Node[];
  readonly nearBoxes: readonly TextBox[]; readonly farBoxes: readonly TextBox[];
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
  return b.runs.filter((r) => r.text !== '').map((r): Node => (b.rotation === 'horizontal'
    ? { kind: 'text', text: r.text, x: b.penX + r.dx, y: b.penY + r.dy, sizePx: r.sizePt * k, sizePt: r.sizePt, glyphs: r.glyphs, face: r.face, color, rotation: 'horizontal' }
    : { kind: 'text', text: r.text, x: b.penX + r.dy, y: b.penY - r.dx, sizePx: r.sizePt * k, sizePt: r.sizePt, glyphs: r.glyphs, face: r.face, color, rotation: 'vertical' }));
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
  base: { readonly xLeft: number; readonly xRight: number; readonly yBottom: number; readonly yTop: number },
): AxisDrawn {
  const k = pxPerPt(dpi);
  // all baselines taken from `bases`
  const bases = base;
  const majorSegs: Seg[] = [], minorSegs: Seg[] = [], majorGrid: Seg[] = [], minorGrid: Seg[] = [], labels: Node[] = [];
  const nearBoxes: TextBox[] = [], farBoxes: TextBox[] = [];
  const face = resolveFace(theme.font.families, theme.font.weight);
  const styles = new Map(labelStyles);
  for (const t of ticks.visible) {
    tracer.span('tick', { axis, loc: t.loc, minor: t.minor, label: t.label.kind === 'plain' ? t.label.text : `${t.label.base}^${t.label.exponent}` }, (sp) => {
      const size = (t.minor ? tt.minorSizePt : tt.sizePt) * k;
      const width = (t.minor ? tt.minorWidthPt : tt.widthPt) * k;
      const pad = (t.minor ? tt.minorPadPt : tt.padPt) * k;
      const [e0, e1] = tickExtent(tt.direction, size);
      const out = tickPadding(tt.direction, size) + pad;
      const segs = t.minor ? minorSegs : majorSegs;
      // Ticks are markers: Agg snaps the marker path (offsets from the tick origin) and the origin separately.
      const te = (b0: number, e: number): number => Math.floor(b0 + 0.5) + Math.floor(e + 0.5) + snapOffset(width);
      // a styled major label (Text.set_fontsize/set_fontweight/set_color on Tick.label1) keeps its own font
      const st = t.minor ? none : lookup(styles, t.index);
      const sizePt = st.kind === 'some' && st.value.sizePt.kind === 'some' ? st.value.sizePt.value : tt.labelSizePt;
      const lface = st.kind === 'some' && st.value.weight.kind === 'some' ? resolveFace(theme.font.families, st.value.weight.value) : face;
      const lcolor = st.kind === 'some' && st.value.color.kind === 'some' ? st.value.color.value : tt.labelColor;
      // Text._get_multialignment: lines of a multi-line label align like the label (x: center, y: right/left)
      const lay = measureLabel(t.label, sizePt, dpi, lface, axis === 'x' ? 'center' : sides.labels === 'far' ? 'left' : 'right');
      const g = t.minor ? grid.minor : grid.major;
      const gridOn = gridDrawn(g), gridSegs = t.minor ? minorGrid : majorGrid, glw = strokePx(g.lines.widthPt, k);
      if (axis === 'x') {
        const d = tx(f, t.loc), x = snap(d, width);
        if (gridOn) gridSegs.push(['M', snap(d, glw), snap(bases.yBottom, glw)], ['L', snap(d, glw), snap(bases.yTop, glw)]);
        if (sides.near) segs.push(['M', x, te(bases.yBottom, e0)], ['L', x, te(bases.yBottom, e1)]);          // bottom: outward is +y
        if (sides.far) segs.push(['M', x, te(bases.yTop, -e0)], ['L', x, te(bases.yTop, -e1)]);           // top: outward is -y
        if (sides.labels === 'near') { const b = placeLayout(lay, d, bases.yBottom + out, { kind: 'horizontal', ha: 'center', va: 'top' }); nearBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); }
        if (sides.labels === 'far') { const b = placeLayout(lay, d, bases.yTop - out, { kind: 'horizontal', ha: 'center', va: 'bottom' }); farBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); }
      } else {
        const d = ty(f, t.loc), y = snap(d, width);
        if (gridOn) gridSegs.push(['M', snap(bases.xLeft, glw), snap(d, glw)], ['L', snap(bases.xRight, glw), snap(d, glw)]);
        if (sides.near) segs.push(['M', te(bases.xLeft, -e0), y], ['L', te(bases.xLeft, -e1), y]);          // left: outward is -x
        if (sides.far) segs.push(['M', te(bases.xRight, e0), y], ['L', te(bases.xRight, e1), y]);           // right: outward is +x
        if (sides.labels === 'near') { const b = placeLayout(lay, bases.xLeft - out, d, { kind: 'horizontal', ha: 'right', va: 'center_baseline' }); nearBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); }
        if (sides.labels === 'far') { const b = placeLayout(lay, bases.xRight + out, d, { kind: 'horizontal', ha: 'left', va: 'center_baseline' }); farBoxes.push(b); labels.push(...labelNodes(b, k, lcolor)); }
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
    nearBoxes, farBoxes,
  };
}
