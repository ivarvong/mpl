// Legend layout: a port of matplotlib.legend.Legend and the offsetbox packers it
// uses (HPacker / VPacker / TextArea / DrawingArea), including loc='best'.
// Works in Agg display coords (y up); converts to top-left only when emitting nodes.
import type { Box } from './legend-index.ts';
import { buildObstacleIndex } from './legend-index.ts';
import { lineStroke, markersNode } from './marks.ts';
import type { XY } from './path.ts';
import { inkOf, pathNode, rectNode, snap } from './scene.ts';
import { lpAscent, measure, pxPerPt, strokePx } from './text.ts';
import { resolveFace } from './fonts.ts';
import type { AnchorCode, Handle, LegendEntry, LegendLoc, Node, Option, Seg, Stroke, Theme } from './types.ts';
import { assertNever, none, some } from './types.ts';
import type { Tracer } from '../trace.ts';

type Point = readonly [number, number];
type Packed = { readonly bbox: Box; readonly offsets: readonly Point[] };
type Align = 'baseline' | 'left' | 'right' | 'top' | 'bottom' | 'center';

const bb = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const width = (b: Box): number => b.x1 - b.x0;
const height = (b: Box): number => b.y1 - b.y0;

// anchor coefficients for codes 1..10: NE NW SW SE E W E S N C
function anchorCoefs(code: AnchorCode): Point {
  switch (code) {
    case 1: return [1, 1];
    case 2: return [0, 1];
    case 3: return [0, 0];
    case 4: return [1, 0];
    case 5: case 7: return [1, 0.5];
    case 6: return [0, 0.5];
    case 8: return [0.5, 0];
    case 9: return [0.5, 1];
    case 10: return [0.5, 0.5];
    default: return assertNever(code);
  }
}
const ANCHORS: readonly AnchorCode[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// offsetbox._get_packed_offsets, mode 'fixed'
function packedOffsets(sizes: readonly number[], sep: number): { readonly total: number; readonly offsets: readonly number[] } {
  const offsets: number[] = [];
  let acc = 0;
  for (const s of sizes) { offsets.push(acc); acc += s + sep; }
  return { total: acc - sep, offsets };
}
// offsetbox._get_aligned_offsets
function alignedOffsets(spans: readonly Point[], align: Align): { readonly span: Point; readonly offsets: readonly number[] } {
  switch (align) {
    case 'baseline': return { span: [Math.min(...spans.map((s) => s[0])), Math.max(...spans.map((s) => s[1]))], offsets: spans.map(() => 0) };
    case 'left': case 'bottom': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => -s[0]) }; }
    case 'right': case 'top': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => h - s[1]) }; }
    case 'center': { const h = Math.max(...spans.map((s) => s[1] - s[0])); return { span: [0, h], offsets: spans.map((s) => (h - (s[1] - s[0])) * 0.5 - s[0]) }; }
    default: return assertNever(align);
  }
}
// HPacker._get_bbox_and_child_offsets (pad 0)
function hpack(boxes: readonly Box[], sep: number, align: Align): Packed {
  const { span: [y0, y1], offsets: yoff } = alignedOffsets(boxes.map((b) => [b.y0, b.y1]), align);
  const { total, offsets } = packedOffsets(boxes.map(width), sep);
  const x0 = boxes[0].x0;
  return { bbox: bb(x0, y0, x0 + total, y1), offsets: offsets.map((o, i) => [o - (boxes[i].x0 - x0), yoff[i]]) };
}
// VPacker._get_bbox_and_child_offsets
function vpack(boxes: readonly Box[], sep: number, align: Align, pad: number): Packed {
  const { span: [x0, x1], offsets: xoff } = alignedOffsets(boxes.map((b) => [b.x0, b.x1]), align);
  const { total, offsets } = packedOffsets(boxes.map(height), sep);
  const yoff = offsets.map((o, i) => total - (o + boxes[i].y1));
  const yd = yoff[0];
  return { bbox: bb(x0 - pad, -yd - pad, x1 + pad, -yd + total + pad), offsets: xoff.map((x, i) => [x, yoff[i] - yd]) };
}
// Bbox.anchored(c, parent.padded(-pad)).p0
function anchoredP0(code: AnchorCode, w: number, h: number, parent: Box, pad: number): Point {
  const [cx, cy] = anchorCoefs(code);
  return [parent.x0 + pad + cx * (width(parent) - 2 * pad - w), parent.y0 + pad + cy * (height(parent) - 2 * pad - h)];
}

export type LegendInput = {
  readonly entries: readonly LegendEntry[]; readonly theme: Theme; readonly dpi: number; readonly H: number;
  readonly axesBox: Box; readonly lines: readonly XY[]; readonly boxes: readonly Box[];
  readonly loc: LegendLoc; readonly ncols: number; readonly frame: boolean; readonly fontSizePt: number;
};
export type LegendOutput = { readonly box: Box; readonly code: AnchorCode; readonly nodes: readonly Node[] };

/** Legend._find_best_position over the obstacle index; ties keep the lower code. */
function bestCode(inp: LegendInput, W: number, Hh: number, pad: number, tracer: Tracer): AnchorCode {
  return tracer.span('legend.best', { lines: inp.lines.length, bboxes: inp.boxes.length }, (sp) => {
    const index = buildObstacleIndex(inp.lines, inp.boxes, inp.axesBox.x1 + 1, inp.axesBox.y1 + 1, 16);
    sp.setAttribute('cells', index.cells).setAttribute('segCells', index.segCells);
    let best: Option<{ readonly code: AnchorCode; readonly badness: number }> = none;
    for (const code of ANCHORS) {
      const [l, b] = anchoredP0(code, W, Hh, inp.axesBox, pad);
      const limit = best.kind === 'some' ? best.value.badness : Infinity;
      const badness = tracer.span('legend.candidate', { code }, (c) => { const v = index.badness(bb(l, b, l + W, b + Hh), limit); c.setAttribute('badness', v); return v; });
      if (best.kind === 'none' || badness < best.value.badness) best = some({ code, badness });
      if (badness === 0) break;
    }
    const chosen = best.kind === 'some' ? best.value.code : 1;
    sp.setAttribute('chosen', chosen);
    return chosen;
  });
}

export function layoutLegend(inp: LegendInput, tracer: Tracer): LegendOutput {
  const { theme, dpi, H } = inp;
  const L = theme.legend;
  const k = pxPerPt(dpi);
  const fsPt = inp.fontSizePt, fs = fsPt * k;
  const face = resolveFace(theme.font.families, theme.font.weight);
  // _init_legend_box geometry (points)
  const descentPt = 0.35 * fsPt * (L.handleHeight - 0.7);
  const hHeightPt = fsPt * L.handleHeight - descentPt;
  const hWidthPt = L.handleLength * fsPt;

  const lp = lpAscent(fsPt, dpi, face);
  const items = inp.entries.map((entry) => {
    const m = measure(entry.label, fsPt, dpi, face);
    const textBox = bb(0, -m.descent, m.width, Math.max(lp, m.ascent)); // TextArea.get_bbox, single line
    const handleBox = bb(0, -descentPt * k, hWidthPt * k, (hHeightPt - descentPt) * k);
    return { entry, ...hpack([handleBox, textBox], L.handleTextPad * fsPt * k, 'baseline') };
  });
  // np.array_split into ncols columns
  const n = items.length, base = Math.floor(n / inp.ncols), extra = n % inp.ncols;
  const columns: (typeof items)[] = [];
  for (let c = 0, idx = 0; c < inp.ncols; c++) {
    const size = base + (c < extra ? 1 : 0);
    if (size > 0) columns.push(items.slice(idx, idx + size));
    idx += size;
  }
  const colPacks = columns.map((col) => vpack(col.map((i) => i.bbox), L.labelSpacing * fsPt * k, 'baseline', 0));
  const handlePack = hpack(colPacks.map((c) => c.bbox), L.columnSpacing * fsPt * k, 'baseline');
  const legendPack = vpack([handlePack.bbox], L.labelSpacing * fsPt * k, 'center', L.borderPad * fsPt * k);
  const lb = legendPack.bbox, W = width(lb), Hh = height(lb);

  // _findoffset
  const pad = L.borderAxesPad * fs;
  const code: AnchorCode = inp.loc.kind === 'best' ? bestCode(inp, W, Hh, pad, tracer) : inp.loc.code;
  const [l, b] = anchoredP0(code, W, Hh, inp.axesBox, pad);
  const ox = l - lb.x0, oy = b - lb.y0;
  const box = bb(l, b, l + W, b + Hh);

  const tl = (y: number): number => H - y;
  const nodes: Node[] = [];
  if (inp.frame) nodes.push(...frameNode(box, fs, theme, k, tl));
  const [hbx, hby] = legendPack.offsets[0];
  colPacks.forEach((cp, ci) => {
    const [cx, cy] = handlePack.offsets[ci];
    columns[ci].forEach((item, ii) => {
      const [ix, iy] = cp.offsets[ii];
      const bx = ox + hbx + cx + ix, by = oy + hby + cy + iy;
      const [hx, hy] = item.offsets[0], [txo, tyo] = item.offsets[1];
      nodes.push(...handleNodes(item.entry.handle, bx + hx, by + hy, hWidthPt * k, hHeightPt * k, descentPt * k, theme, k, tl));
      nodes.push({ kind: 'text', text: item.entry.label, x: bx + txo, y: tl(by + tyo), sizePx: fs, sizePt: fsPt, glyphs: measure(item.entry.label, fsPt, dpi, face).runs[0].glyphs, face: face.id, color: L.labelColor, rotation: 'horizontal' });
    });
  });
  return { box, code, nodes };
}

// FancyBboxPatch, boxstyle "round,pad=0,rounding_size=0.2" (or "square,pad=0"), snap=True
function frameNode(box: Box, fs: number, theme: Theme, k: number, tl: (y: number) => number): readonly Node[] {
  const L = theme.legend;
  const lw = theme.patch.linewidthPt * k;
  const P = (x: number, y: number): Point => [snap(x, lw), snap(tl(y), lw)];
  const stroke: Stroke = { color: { hex: L.edge.hex, alpha: L.frameAlpha }, width: lw, cap: 'butt', join: 'miter', dash: { kind: 'solid' } };
  const ink = inkOf({ kind: 'solid', color: { hex: L.face.hex, alpha: L.frameAlpha } }, some(stroke));
  if (ink.kind === 'none') return [];
  const { x0, y0, x1, y1 } = box;
  if (!L.fancy) {
    const q = [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)];
    return [pathNode([['M', ...q[0]], ['L', ...q[1]], ['L', ...q[2]], ['L', ...q[3]], ['Z']], ink.value)];
  }
  const dr = 0.2 * fs;
  const p = [P(x0 + dr, y0), P(x1 - dr, y0), P(x1, y0), P(x1, y0 + dr), P(x1, y1 - dr), P(x1, y1), P(x1 - dr, y1),
             P(x0 + dr, y1), P(x0, y1), P(x0, y1 - dr), P(x0, y0 + dr), P(x0, y0), P(x0 + dr, y0)];
  const segs: Seg[] = [['M', ...p[0]], ['L', ...p[1]], ['Q', ...p[2], ...p[3]], ['L', ...p[4]], ['Q', ...p[5], ...p[6]],
                       ['L', ...p[7]], ['Q', ...p[8], ...p[9]], ['L', ...p[10]], ['Q', ...p[11], ...p[12]], ['Z']];
  return [pathNode(segs, ink.value)];
}

// HandlerLine2D / HandlerPatch inside a DrawingArea whose origin is (ox, oy), y up
function handleNodes(h: Handle, ox: number, oy: number, wPx: number, hPx: number, ydPx: number, theme: Theme, k: number,
                     tl: (y: number) => number): readonly Node[] {
  switch (h.kind) {
    case 'patch': {
      const stroke: Option<Stroke> = h.edge.kind === 'on' && h.edge.widthPt > 0
        ? some({ color: h.edge.color, width: strokePx(h.edge.widthPt, k), cap: 'butt', join: 'miter', dash: { kind: 'solid' } })
        : none;
      const lw = stroke.kind === 'some' ? stroke.value.width : 0;
      const ink = inkOf(h.face, stroke);
      if (ink.kind === 'none') return [];
      const x0 = snap(ox, lw), x1 = snap(ox + wPx, lw);
      const yTop = snap(tl(oy - ydPx + hPx), lw), yBot = snap(tl(oy - ydPx), lw);
      return [rectNode(x0, yTop, x1 - x0, yBot - yTop, ink.value)];
    }
    case 'line': {
      // xdata [0, w], ydata (h - yd) / 2; numpoints = 1: a 3-point line, marker at the middle
      const y = tl(oy + (hPx - ydPx) / 2);
      const out: Node[] = [];
      if (h.stroke.kind === 'on') {
        const s = lineStroke(theme, h.stroke.color, h.stroke.widthPt, h.stroke.style, k);
        const xs = Float64Array.of(ox, ox + wPx / 2, ox + wPx).map((v) => snap(v, s.width));
        const ys = Float64Array.of(y, y, y).map((v) => snap(v, s.width));
        if (s.color.alpha > 0) out.push({ kind: 'polyline', xs, ys, stroke: s });
      }
      if (h.markers.kind === 'on') {
        const m = markersNode(h.markers, Float64Array.of(ox + wPx / 2), Float64Array.of(y), k);
        if (m.kind === 'some') out.push(m.value);
      }
      return out;
    }
    default: return assertNever(h);
  }
}
