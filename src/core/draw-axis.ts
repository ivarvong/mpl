// One axis: grid lines, major and minor tick marks, tick labels. Ticks are drawn from
// a spine along its outward normal; labels sit outside the tick by its pad.
import type { Frame } from './frame.ts';
import { tx, ty } from './frame.ts';
import { lineStroke } from './marks.ts';
import { resolveFace } from './fonts.ts';
import { pathNode, snap, snapOffset } from './scene.ts';
import type { TextBox } from './text.ts';
import { measureLabel, placeLayout, pxPerPt } from './text.ts';
import type { TickSet } from './ticks.ts';
import type { Node, Rgb, Seg, Stroke, Theme, TickDirection, TickTheme } from './types.ts';
import { assertNever } from './types.ts';
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

export function drawAxis(axis: 'x' | 'y', ticks: TickSet, tt: TickTheme, sides: Sides, gridOn: boolean, f: Frame, theme: Theme,
                         dpi: number, tracer: Tracer): AxisDrawn {
  const k = pxPerPt(dpi);
  const box = f.box;
  const glw = theme.grid.widthPt * k;
  const majorSegs: Seg[] = [], minorSegs: Seg[] = [], gridSegs: Seg[] = [], labels: Node[] = [];
  const nearBoxes: TextBox[] = [], farBoxes: TextBox[] = [];
  const face = resolveFace(theme.font.families, theme.font.weight);
  for (const t of ticks.visible) {
    tracer.span('tick', { axis, loc: t.loc, minor: t.minor, label: t.label.kind === 'plain' ? t.label.text : `${t.label.base}^${t.label.exponent}` }, (sp) => {
      const size = (t.minor ? tt.minorSizePt : tt.sizePt) * k;
      const width = (t.minor ? tt.minorWidthPt : tt.widthPt) * k;
      const pad = (t.minor ? tt.minorPadPt : tt.padPt) * k;
      const [e0, e1] = tickExtent(tt.direction, size);
      const out = tickPadding(tt.direction, size) + pad;
      const segs = t.minor ? minorSegs : majorSegs;
      // Ticks are markers: Agg snaps the marker path (offsets from the tick origin) and the origin separately.
      const te = (base: number, e: number): number => Math.floor(base + 0.5) + Math.floor(e + 0.5) + snapOffset(width);
      const lay = measureLabel(t.label, tt.labelSizePt, dpi, face);
      if (axis === 'x') {
        const d = tx(f, t.loc), x = snap(d, width);
        if (gridOn && !t.minor) gridSegs.push(['M', snap(d, glw), snap(box.yBot, glw)], ['L', snap(d, glw), snap(box.yTop, glw)]);
        if (sides.near) segs.push(['M', x, te(box.yBot, e0)], ['L', x, te(box.yBot, e1)]);          // bottom: outward is +y
        if (sides.far) segs.push(['M', x, te(box.yTop, -e0)], ['L', x, te(box.yTop, -e1)]);           // top: outward is -y
        if (sides.labels === 'near') { const b = placeLayout(lay, d, box.yBot + out, { kind: 'horizontal', ha: 'center', va: 'top' }); nearBoxes.push(b); labels.push(...labelNodes(b, k, tt.labelColor)); }
        if (sides.labels === 'far') { const b = placeLayout(lay, d, box.yTop - out, { kind: 'horizontal', ha: 'center', va: 'bottom' }); farBoxes.push(b); labels.push(...labelNodes(b, k, tt.labelColor)); }
      } else {
        const d = ty(f, t.loc), y = snap(d, width);
        if (gridOn && !t.minor) gridSegs.push(['M', snap(box.x0, glw), snap(d, glw)], ['L', snap(box.x1, glw), snap(d, glw)]);
        if (sides.near) segs.push(['M', te(box.x0, -e0), y], ['L', te(box.x0, -e1), y]);          // left: outward is -x
        if (sides.far) segs.push(['M', te(box.x1, e0), y], ['L', te(box.x1, e1), y]);           // right: outward is +x
        if (sides.labels === 'near') { const b = placeLayout(lay, box.x0 - out, d, { kind: 'horizontal', ha: 'right', va: 'center_baseline' }); nearBoxes.push(b); labels.push(...labelNodes(b, k, tt.labelColor)); }
        if (sides.labels === 'far') { const b = placeLayout(lay, box.x1 + out, d, { kind: 'horizontal', ha: 'left', va: 'center_baseline' }); farBoxes.push(b); labels.push(...labelNodes(b, k, tt.labelColor)); }
      }
      sp.setAttribute('w', +lay.width.toFixed(2));
    });
  }
  // Gridlines are Line2Ds: caps and joins follow lines.{solid,dash}_{cap,join}style.
  const gridStroke: Stroke = lineStroke(theme, { hex: theme.grid.color.hex, alpha: theme.grid.color.alpha * theme.grid.alpha }, theme.grid.widthPt, theme.grid.style, k);
  const tickPath = (segs: readonly Seg[], widthPt: number): readonly Node[] =>
    segs.length > 0 && widthPt > 0 ? [pathNode(segs, { kind: 'stroke', stroke: { color: tt.color, width: widthPt * k, cap: 'butt', join: 'miter', dash: { kind: 'solid' } } })] : [];
  return {
    grid: gridSegs.length > 0 && gridStroke.color.alpha > 0 ? [pathNode(gridSegs, { kind: 'stroke', stroke: gridStroke })] : [],
    marks: [...labels, ...tickPath(majorSegs, tt.widthPt), ...tickPath(minorSegs, tt.minorWidthPt)],
    nearBoxes, farBoxes,
  };
}
