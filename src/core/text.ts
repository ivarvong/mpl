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
import type { Glyph, HAlign, Placement, Rotation, TickLabel } from './types.ts';
import { assertNever } from './types.ts';
export const pxPerPt = (dpi: number): number => dpi / 72;
/**
 * A gc linewidth in px, as RendererAgg::points_to_pixels computes it: points * dpi / 72.0.
 * points * (dpi / 72) can be 1 ulp off (1.5 pt at 100 dpi gives 2.083333333333333, not
 * 2.0833333333333335). That moves every stroke offset, and Agg's 24.8 rounding then shifts AA
 * coverage. k = dpi / 72 gives (k * 72) === dpi for every integer dpi up to 1000, so dpi is recovered exactly.
 */
export const strokePx = (points: number, k: number): number => (points * (k * 72)) / 72;


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

/** Multi-line text as Text._get_layout lays it out (linespacing 'normal', the 3.11 default): each line
 *  keeps its ink ascent and descent floored at the face's typo metrics, plus half the typo line gap
 *  above and below; lines stack with no further leading. Lines align within the block by the
 *  multialignment, which defaults to the horizontal alignment. The block's anchor baseline is the
 *  last line's (va='baseline' puts the last baseline on y). */
function measureMultiline(text: string, sizePt: number, dpi: number, face: Face, malign: HAlign): LabelLayout {
  const lines = text.split('\n');
  const scale = 1 / face.upm * sizePt * dpi / 72;
  const gap = face.data.typo[2] * scale;
  const m = lines.map((t) => measurePlain(t, sizePt, dpi, face));          // ascent/descent already floored
  const a = m.map((mm) => mm.ascent + gap / 2), d = m.map((mm) => mm.descent + gap / 2);
  const width = Math.max(...m.map((mm) => mm.width));
  const baselines: number[] = [];
  let y = 0;
  for (let i = 0; i < m.length; i++) { y += a[i]; baselines.push(y); y += d[i]; }
  const H = y, last = baselines[baselines.length - 1];
  const shift = (w: number): number => (malign === 'left' ? 0 : malign === 'right' ? width - w : width / 2 - w / 2);
  const runs: Run[] = m.flatMap((mm, i) => mm.runs.map((r) => ({ ...r, dx: r.dx + shift(mm.width), dy: r.dy + baselines[i] - last })));
  return { width, ascent: last, descent: H - last, runs };
}

/** Plain or multi-line text; `malign` aligns the lines of a multi-line block. */
export function measure(text: string, sizePt: number, dpi: number, face: Face, malign: HAlign = 'left'): LabelLayout {
  return text.includes('\n') ? measureMultiline(text, sizePt, dpi, face, malign) : measurePlain(text, sizePt, dpi, face);
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

/** A tick label; `malign` is its horizontal alignment, which also aligns the lines of a multi-line label. */
export function measureLabel(l: TickLabel, sizePt: number, dpi: number, face: Face, malign: HAlign): LabelLayout {
  switch (l.kind) {
    case 'plain': return measure(l.text, sizePt, dpi, face, malign);
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
    case 'vertical': {
      // rotation=90, rotation_mode='default' (Text._get_layout): rotate first, then ha/va align the rotated box.
      // The rotated box is H wide and m.width tall; the text runs upward with its baseline at x0 + ascent.
      const x0 = p.ha === 'left' ? x : p.ha === 'right' ? x - H : x - H / 2;
      const top = verticalTop(p.va === 'baseline' || p.va === 'center_baseline' ? 'center' : p.va, y, m.width, m.width / 2);
      return { x0, y0: top, x1: x0 + H, y1: top + m.width, penX: x0 + m.ascent, penY: top + m.width, rotation: 'vertical', runs: m.runs };
    }
    default: return assertNever(p);
  }
}

/** Text._get_multialignment: the horizontal alignment (rotated axis labels are centred). */
const malignOf = (p: Placement): HAlign => {
  switch (p.kind) {
    case 'horizontal': case 'vertical': return p.ha;
    case 'ylabel': case 'ylabelRight': return 'center';
    default: return assertNever(p);
  }
};
export const placeText = (text: string, sizePt: number, dpi: number, face: Face, x: number, y: number, p: Placement): TextBox =>
  placeLayout(measure(text, sizePt, dpi, face, malignOf(p)), x, y, p);

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
