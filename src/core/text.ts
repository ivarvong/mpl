// Text metrics modelled on matplotlib's Agg renderer + Text._get_layout, and a
// mathtext model for the one construct tick labels use: [c\times]b^{e}.
//
// Plain text: FT2Font._layout (HarfBuzz shaping, 26.6 advances + kerning) gives the width;
// FT2Font.set_text's ink box gives h and d; _get_layout then floors the ascent and descent at
// the face's OS/2 typo metrics (matplotlib 3.11): a = max(h − d, min_ascent), d = max(d, min_descent).
//
// Mathtext (matplotlib._mathtext, DejaVuSansFontConstants), derived from source and
// checked against VectorParse dumps: glyphs advance by linearHoriAdvance (unrounded);
// a superscript is set at 0.7× after Kern(δ·x_height)·0.7, raised by sup1·x_height,
// followed by script_space·x_height; binary operators get 0.2·quad each side, where
// quad is the advance of 'm'. The box is ceil(width) × (ceil(height) + ceil(depth)).
import type { Face } from './fonts.ts';
import { ftScale, glyphOf, inkExtent, mathMetrics, minMetrics, penPositions, shapeGlyphs } from './fonts.ts';
import type { Glyph, Placement, Rotation, TickLabel } from './types.ts';
import { assertNever } from './types.ts';
export const pxPerPt = (dpi: number): number => dpi / 72;


/** A run of glyphs drawn at one size; (dx, dy) from the pen origin, dy < 0 is up. */
export type Run = { readonly text: string; readonly dx: number; readonly dy: number; readonly sizePt: number; readonly face: string; readonly glyphs: readonly Glyph[] };
/** What Text._get_layout needs: box width and the lp-clamped ascent/descent, plus how to draw it. */
export type LabelLayout = { readonly width: number; readonly ascent: number; readonly descent: number; readonly runs: readonly Run[] };

/** Plain single-line text (Agg path): FT2Font pen positions, 26.6 exact. */
function measurePlain(text: string, sizePt: number, dpi: number, face: Face): LabelLayout {
  const scale = ftScale(face, sizePt, dpi);
  const gids = shapeGlyphs(face, text), pens = penPositions(face, gids, scale);
  const glyphs = gids.map((gid, i): Glyph => ({ gid, dx: pens[i] / 64 }));
  const ink = inkExtent(face, gids, scale), min = minMetrics(face, sizePt, dpi);
  const h = text === '' ? 0 : ink.yMax - ink.yMin, d = text === '' ? 0 : -ink.yMin;
  return { width: text === '' ? 0 : pens[pens.length - 1] / 64, ascent: Math.max(h - d, min.ascent), descent: Math.max(d, min.descent),
           runs: [{ text, dx: 0, dy: 0, sizePt, face: face.id, glyphs }] };
}

/** Multi-line: lay out each line and stack vertically with a 1.2× line spacing, aligning by ha and respecting va. */
function measureMultiline(text: string, sizePt: number, dpi: number, face: Face, lineSpacing = 1.2): LabelLayout {
  const lines = text.split('\n');
  if (lines.length === 1) return measurePlain(text, sizePt, dpi, face);
  const m = lines.map((t) => measurePlain(t, sizePt, dpi, face));
  const width = Math.max(...m.map((mm) => mm.width));
  // Matplotlib Text._get_layout: baseline-to-baseline distance is linespacing * size (in points),
  // independent of each line's ink box. The block's ascent is the first line's ascent; its
  // descent is the last line's descent.
  const baselineStep = lineSpacing * sizePt;
  const baselines: number[] = [];
  let y = m.length > 0 ? m[0].ascent : 0;
  for (let i = 0; i < m.length; i++) { if (i > 0) y += baselineStep; baselines.push(y); }
  const H = (m.length > 0 ? m[0].ascent : 0) + (m.length > 1 ? baselineStep * (m.length - 1) : 0) + (m.length > 0 ? m[m.length - 1].descent : 0);
  const runs: Run[] = [];
  for (let i = 0; i < lines.length; i++) {
    const mm = m[i];
    // Align each line's penX at 0; alignment is handled in placeLayout
    for (const r of mm.runs) runs.push({ ...r, dy: r.dy + (baselines[i] - mm.ascent) });
  }
  // The ascent/descent for the block: top is first line baseline, bottom is total - that baseline
  const ascent = baselines.length > 0 ? baselines[0] : 0;
  const descent = Math.max(0, H - ascent);
  return { width, ascent, descent, runs };
}

/** Plain or multi-line text, with matplotlib-like 1.2× line spacing. */
export function measure(text: string, sizePt: number, dpi: number, face: Face): LabelLayout {
  return text.includes('\n') ? measureMultiline(text, sizePt, dpi, face, 1.2) : measurePlain(text, sizePt, dpi, face);
}

/**
 * The renderer's h − d for "lp" (raw ink ascent, without _get_layout's floors). TextArea.get_bbox
 * floors a legend label's height above the baseline at it: h_d = max(h_lp − d_lp, h − yd).
 */
export function lpAscent(sizePt: number, dpi: number, face: Face): number {
  return inkExtent(face, shapeGlyphs(face, 'lp'), ftScale(face, sizePt, dpi)).yMax;
}

// ---- mathtext
const SHRINK = 0.7;
const X_HEIGHT = 1120 / 2048;                       // DejaVuSansFontConstants.x_height
const SUP1 = 845.824 / 1120, DELTA = 0.025, SCRIPT_SPACE = 0.05;
const MINUS = '−', TIMES = '×';

type Acc = { x: number; top: number; bottom: number; readonly runs: Run[] };
/**
 * Append glyphs at FreeType's linearHoriAdvance; track the box height (iceberg + raise) and
 * depth relative to the baseline, as mathtext's Hlist packing does.
 */
// \mathdefault{} selects mathtext's 'default' font: findfont(the Text's FontProperties), i.e. the
// label's own face (DejaVuFonts looks in DejaVu Sans Display first, which has none of these
// characters). The layout constants (x_height, sup1, ...) stay the dejavusans fontset's.
function place(acc: Acc, face: Face, text: string, sizePt: number, dpi: number, raise: number, shrink: number): void {
  // Scripts are built at the parent size and then Char.shrink()-ed: metrics scale by the factor.
  const x0 = acc.x, glyphs: Glyph[] = [];
  for (const ch of text) {
    const m = mathMetrics(face, ch, sizePt, dpi);
    glyphs.push({ gid: glyphOf(face, ch), dx: acc.x - x0 });
    acc.x += m.advance * shrink;
    acc.top = Math.max(acc.top, m.iceberg * shrink + raise);
    acc.bottom = Math.max(acc.bottom, m.depth * shrink - raise);
  }
  acc.runs.push({ text, dx: x0, dy: -raise, sizePt: sizePt * shrink, face: face.id, glyphs });
}

function mathPower(coeff: string, base: string, exponent: number, sizePt: number, dpi: number, face: Face): LabelLayout {
  const em = sizePt * pxPerPt(dpi);
  const xh = X_HEIGHT * em;
  const acc: Acc = { x: 0, top: 0, bottom: 0, runs: [] };
  if (coeff !== '') {
    place(acc, face, coeff, sizePt, dpi, 0, 1);
    const space = 0.2 * mathMetrics(face, 'm', sizePt, dpi).advance;
    acc.x += space;
    place(acc, face, TIMES, sizePt, dpi, 0, 1);
    acc.x += space;
  }
  place(acc, face, base, sizePt, dpi, 0, 1);
  acc.x += DELTA * xh * SHRINK;
  place(acc, face, String(exponent).replace('-', MINUS), sizePt, dpi, SUP1 * xh, SHRINK);
  acc.x += SCRIPT_SPACE * xh;
  const h = Math.ceil(acc.top) + Math.ceil(acc.bottom), d = Math.ceil(acc.bottom);
  // VectorParse puts glyphs at ceil(height) - oy: the baseline sits ceil(H) - H above the box's.
  const lift = Math.ceil(acc.top) - acc.top;
  const runs = acc.runs.map((r) => ({ ...r, dy: r.dy - lift }));
  // Text._get_layout clamps ascent and descent separately: a = max(h - d, min_ascent), d = max(d, min_descent)
  const min = minMetrics(face, sizePt, dpi);
  const ascent = Math.max(h - d, min.ascent), descent = Math.max(d, min.descent);
  return { width: Math.ceil(acc.x), ascent, descent, runs };
}

export function measureLabel(l: TickLabel, sizePt: number, dpi: number, face: Face): LabelLayout {
  switch (l.kind) {
    case 'plain': return measure(l.text, sizePt, dpi, face);
    case 'power': return mathPower(l.coeff.kind === 'some' ? l.coeff.value : '', l.base, l.exponent, sizePt, dpi, face);
    default: return assertNever(l);
  }
}

/** Layout box (top-left coords), pen/baseline origin, and the runs to draw. */
export type TextBox = {
  readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number;
  readonly penX: number; readonly penY: number; readonly rotation: Rotation; readonly runs: readonly Run[];
};

export function placeLayout(m: LabelLayout, x: number, y: number, p: Placement): TextBox {
  const H = m.ascent + m.descent;
  switch (p.kind) {
    case 'horizontal': {
      const x0 = p.ha === 'left' ? x : p.ha === 'right' ? x - m.width : x - m.width / 2;
      const top = verticalTop(p.va, y, H, m.ascent);
      return { x0, y0: top, x1: x0 + m.width, y1: top + H, penX: x0, penY: top + m.ascent, rotation: 'horizontal', runs: m.runs };
    }
    case 'ylabel': {
      // rotation=90, ha=center, va=bottom (measured on 3.11.2): the rotated box spans
      // x ∈ [x-H, x], centred vertically on the anchor; baseline is the line x - descent.
      const top = y - m.width / 2;
      return { x0: x - H, y0: top, x1: x, y1: top + m.width, penX: x - m.descent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    case 'ylabelRight': {
      // rotation=90, ha=center, va=top (label_position='right'): box spans x ∈ [x, x+H]; baseline at x + ascent.
      const top = y - m.width / 2;
      return { x0: x, y0: top, x1: x + H, y1: top + m.width, penX: x + m.ascent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    default: return assertNever(p);
  }
}

export const placeText = (text: string, sizePt: number, dpi: number, face: Face, x: number, y: number, p: Placement): TextBox =>
  placeLayout(measure(text, sizePt, dpi, face), x, y, p);

function verticalTop(va: 'top' | 'bottom' | 'center' | 'baseline' | 'center_baseline', y: number, H: number, ascent: number): number {
  switch (va) {
    case 'top': return y;
    case 'bottom': return y - H;
    case 'center': return y - H / 2;
    case 'baseline': return y - ascent;
    case 'center_baseline': return y - ascent / 2;
    default: return assertNever(va);
  }
}
