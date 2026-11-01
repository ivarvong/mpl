// RcLayer -> Theme. The single place rc keys are read and their string
// encodings ('inherit', 'auto', 'None', 'projecting', 'medium', 'C0', ...)
// are interpreted. Past this function the core sees only typed values.
import { parsePaint, parseRgb, rcColorString } from './colors.ts';
import { parseWeight } from './fonts.ts';
import { parseLinestyle, parseMarker } from './fmt.ts';
import type { RcLayer, RcValue } from './rc.ts';
import { lookup } from './std.ts';
import type { AnchorCode, AxisBelow, Cap, GridWhich, HAlign, Join, LegendLoc, LineStyleName, Paint, Result, Rgb, Theme, TickDirection, TickTheme } from './types.ts';
import { err, none, ok, some } from './types.ts';

const FONT_SCALES: ReadonlyMap<string, number> = new Map([
  ['xx-small', 0.579], ['x-small', 0.694], ['small', 0.833], ['medium', 1.0],
  ['large', 1.2], ['x-large', 1.44], ['xx-large', 1.728], ['larger', 1.2], ['smaller', 0.833],
]);
const LEGEND_LOCS: ReadonlyMap<string, LegendLoc> = new Map<string, LegendLoc>([
  ['best', { kind: 'best' }],
  ...(['upper right', 'upper left', 'lower left', 'lower right', 'right', 'center left', 'center right', 'lower center', 'upper center', 'center']
    .map((n, i): [string, LegendLoc] => [n, { kind: 'anchored', code: anchorCode(i + 1) }])),
]);
const BLACK: Rgb = { hex: '#000000', alpha: 1 };

/** 1..10 -> AnchorCode; anything else is a programming error. */
export function anchorCode(n: number): AnchorCode {
  switch (n) {
    case 1: case 2: case 3: case 4: case 5: case 6: case 7: case 8: case 9: case 10: return n;
    default: throw new Error(`legend location code ${n} out of range`);
  }
}

export function parseLegendLoc(v: unknown): Result<LegendLoc> {
  if (typeof v === 'number') {
    if (v === 0) return ok({ kind: 'best' });
    if (Number.isInteger(v) && v >= 1 && v <= 10) return ok({ kind: 'anchored', code: anchorCode(v) });
    return err(`legend loc ${v} out of range 0..10`);
  }
  if (typeof v !== 'string') return err(`legend loc must be a string or int`);
  const l = lookup(LEGEND_LOCS, v);
  return l.kind === 'some' ? ok(l.value) : err(`unknown legend loc ${JSON.stringify(v)}`);
}

export function parseFontSize(v: unknown, basePt: number): Result<number> {
  if (typeof v === 'number' && v > 0) return ok(v);
  if (typeof v === 'string') {
    const s = lookup(FONT_SCALES, v);
    if (s.kind === 'some') return ok(basePt * s.value);
    const n = Number(v);
    if (v.trim() !== '' && Number.isFinite(n) && n > 0) return ok(n);
  }
  return err(`invalid font size ${JSON.stringify(v)}`);
}

/** Reads keys, collecting every error; placeholders never escape because the caller returns err. */
class Reader {
  readonly rc: RcLayer;
  readonly errors: string[] = [];
  constructor(rc: RcLayer) { this.rc = rc; }
  fail<T>(key: string, msg: string, placeholder: T): T { this.errors.push(`${key}: ${msg}`); return placeholder; }
  raw(key: string): RcValue {
    const v = lookup(this.rc, key);
    return v.kind === 'some' ? v.value : this.fail(key, 'missing', 0);
  }
  num(key: string): number {
    const v = this.raw(key);
    return typeof v === 'number' && Number.isFinite(v) ? v : this.fail(key, `expected a number, got ${JSON.stringify(v)}`, 0);
  }
  bool(key: string): boolean {
    const v = this.raw(key);
    return typeof v === 'boolean' ? v : this.fail(key, `expected a bool, got ${JSON.stringify(v)}`, false);
  }
  str(key: string): string {
    const v = this.raw(key);
    return typeof v === 'string' ? v : this.fail(key, `expected a string, got ${JSON.stringify(v)}`, '');
  }
  oneOf<T extends string>(key: string, allowed: readonly T[]): T {
    const v = this.raw(key);
    for (const a of allowed) if (a === v) return a;
    return this.fail(key, `expected one of ${allowed.join(', ')}, got ${JSON.stringify(v)}`, allowed[0]);
  }
  numList(key: string, len: number): readonly number[] {
    const v = this.raw(key);
    if (Array.isArray(v) && v.every((x) => typeof x === 'number') && (len === 0 || v.length === len)) return v.map(Number);
    return this.fail(key, `expected ${len || 'a list of'} numbers, got ${JSON.stringify(v)}`, len ? Array.from({ length: len }, () => 0) : [1]);
  }
  fromResult<T>(key: string, r: Result<T>, placeholder: T): T { return r.ok ? r.value : this.fail(key, r.error, placeholder); }
  paint(key: string, cycle: readonly Rgb[]): Paint {
    const v = this.raw(key);
    return this.fromResult(key, parsePaint(typeof v === 'string' ? rcColorString(v) : v, cycle), { kind: 'none' });
  }
  rgb(key: string, cycle: readonly Rgb[]): Rgb {
    const v = this.raw(key);
    return this.fromResult(key, parseRgb(typeof v === 'string' ? rcColorString(v) : v, cycle), BLACK);
  }
  size(key: string, basePt: number): number { return this.fromResult(key, parseFontSize(this.raw(key), basePt), 10); }
  cap(key: string): Cap {
    switch (this.oneOf(key, ['butt', 'round', 'projecting'])) { case 'butt': return 'butt'; case 'round': return 'round'; case 'projecting': return 'square'; }
  }
  join(key: string): Join { return this.oneOf(key, ['miter', 'round', 'bevel']); }
  solidStyle(key: string): LineStyleName {
    const r = parseLinestyle(this.raw(key));
    if (!r.ok) return this.fail(key, r.error, 'solid');
    return r.value.kind === 'some' ? r.value.value : this.fail(key, `'None' is not supported here`, 'solid');
  }
}

/** font.family may be a name or a list; the generic 'sans-serif' expands to font.sans-serif. */
const nameList = (v: RcValue): readonly string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
function fontFamilies(fam: RcValue, sans: RcValue): readonly string[] {
  const list = nameList;
  return list(fam).flatMap((f) => (f === 'sans-serif' ? [...list(sans), 'DejaVu Sans'] : [f]));
}

function tickTheme(r: Reader, axis: 'x' | 'y', fontPt: number, cycle: readonly Rgb[]): TickTheme {
  const color = r.rgb(`${axis}tick.color`, cycle);
  const lc = r.raw(`${axis}tick.labelcolor`);
  const [near, far, labelNear] = axis === 'x' ? ['bottom', 'top', 'labelbottom'] : ['left', 'right', 'labelleft'];
  return {
    sizePt: r.num(`${axis}tick.major.size`), widthPt: r.num(`${axis}tick.major.width`), padPt: r.num(`${axis}tick.major.pad`),
    minorSizePt: r.num(`${axis}tick.minor.size`), minorWidthPt: r.num(`${axis}tick.minor.width`), minorPadPt: r.num(`${axis}tick.minor.pad`),
    labelSizePt: r.size(`${axis}tick.labelsize`, fontPt),
    color, labelColor: lc === 'inherit' ? color : r.rgb(`${axis}tick.labelcolor`, cycle),
    direction: r.oneOf<TickDirection>(`${axis}tick.direction`, ['out', 'in', 'inout']),
    near: r.bool(`${axis}tick.${near}`), far: r.bool(`${axis}tick.${far}`), labelNear: r.bool(`${axis}tick.${labelNear}`),
  };
}

function axisBelow(r: Reader): AxisBelow {
  const v = r.raw('axes.axisbelow');
  if (v === 'line') return 'line';
  if (v === true || v === 'True' || v === 'true') return 'below';
  if (v === false || v === 'False' || v === 'false') return 'above';
  return r.fail('axes.axisbelow', `expected 'line' or a bool, got ${JSON.stringify(v)}`, 'line');
}

export function parseTheme(rc: RcLayer): Result<Theme> {
  const r = new Reader(rc);
  // the cycle first: 'CN' colors elsewhere resolve against it
  const rawCycle = r.raw('axes.prop_cycle');
  const cycle: readonly Rgb[] = Array.isArray(rawCycle)
    ? rawCycle.map((c, i) => r.fromResult(`axes.prop_cycle[${i}]`, parseRgb(typeof c === 'string' ? rcColorString(c) : c, []), BLACK))
    : r.fail('axes.prop_cycle', 'expected a list of colors', [BLACK]);
  const fontPt = r.num('font.size');
  const figsize = r.numList('figure.figsize', 2);
  const textColor = r.rgb('text.color', cycle);
  const axesFace = r.paint('axes.facecolor', cycle);
  const axesEdge = r.rgb('axes.edgecolor', cycle);
  const savefig = r.raw('savefig.facecolor');
  const titleColor = r.raw('axes.titlecolor') === 'auto' ? textColor : r.rgb('axes.titlecolor', cycle);
  // svg.fonttype: 'none' -> <text>, 'path' -> glyph outlines; default to 'text' for viewer-laid-out text
  const svgR = lookup(rc, 'svg.fonttype');
  const svgText = svgR.kind === 'some' && typeof svgR.value === 'string' && svgR.value.toLowerCase() === 'path' ? 'glyphs' as const : 'text';
  const legendFace = r.raw('legend.facecolor') === 'inherit'
    ? (axesFace.kind === 'solid' ? axesFace.color : { hex: '#ffffff', alpha: 0 })
    : r.rgb('legend.facecolor', cycle);
  const legendEdge = r.raw('legend.edgecolor') === 'inherit' ? axesEdge : r.rgb('legend.edgecolor', cycle);
  const legendLabel = r.raw('legend.labelcolor');
  const lineStyle = r.fromResult('lines.linestyle', parseLinestyle(r.raw('lines.linestyle')), { kind: 'some', value: 'solid' });
  const marker = r.fromResult('lines.marker', parseMarker(r.raw('lines.marker')), { kind: 'none' });
  const gridOn = r.bool('axes.grid');
  const gridWhich = r.oneOf<GridWhich>('axes.grid.axis', ['both', 'x', 'y']);
  const limits = r.numList('axes.formatter.limits', 2);

  const theme: Theme = {
    figure: {
      widthIn: figsize[0], heightIn: figsize[1], dpi: r.num('figure.dpi'),
      background: savefig === 'auto' ? r.paint('figure.facecolor', cycle) : r.paint('savefig.facecolor', cycle),
      subplot: [r.num('figure.subplot.left'), r.num('figure.subplot.bottom'), r.num('figure.subplot.right'), r.num('figure.subplot.top')],
      titleSizePt: r.size('figure.titlesize', fontPt), titleWeight: parseWeight(r.raw('figure.titleweight')),
      labelSizePt: r.size('figure.labelsize', fontPt), labelWeight: parseWeight(r.raw('figure.labelweight')),
    },
    font: { families: fontFamilies(r.raw('font.family'), r.raw('font.sans-serif')), sizePt: fontPt,
            weight: parseWeight(r.raw('font.weight')), titleWeight: parseWeight(r.raw('axes.titleweight')), labelWeight: parseWeight(r.raw('axes.labelweight')) },
    text: { color: textColor },
    svgText,
    axes: {
      face: axesFace, edge: axesEdge, linewidthPt: r.num('axes.linewidth'),
      spines: { left: r.bool('axes.spines.left'), bottom: r.bool('axes.spines.bottom'), top: r.bool('axes.spines.top'), right: r.bool('axes.spines.right') },
      grid: gridOn ? { kind: 'on', which: gridWhich } : { kind: 'off' }, axisBelow: axisBelow(r),
      labelSizePt: r.size('axes.labelsize', fontPt), labelColor: r.rgb('axes.labelcolor', cycle), labelPadPt: r.num('axes.labelpad'),
      titleSizePt: r.size('axes.titlesize', fontPt), titleColor, titlePadPt: r.num('axes.titlepad'), titleLoc: r.oneOf<HAlign>('axes.titlelocation', ['left', 'center', 'right']),
      xmargin: r.num('axes.xmargin'), ymargin: r.num('axes.ymargin'),
      formatter: { limits: [limits[0], limits[1]], offsetThreshold: r.num('axes.formatter.offset_threshold'), useOffset: r.bool('axes.formatter.useoffset') },
      unicodeMinus: r.bool('axes.unicode_minus'),
      cycle,
    },
    lines: {
      widthPt: r.num('lines.linewidth'), style: lineStyle, marker,
      markerSizePt: r.num('lines.markersize'), markerEdgeWidthPt: r.num('lines.markeredgewidth'),
      markerEdge: r.raw('lines.markeredgecolor') === 'auto' ? none : some(r.paint('lines.markeredgecolor', cycle)),
      markerFace: r.raw('lines.markerfacecolor') === 'auto' ? none : some(r.paint('lines.markerfacecolor', cycle)),
      solidCap: r.cap('lines.solid_capstyle'), solidJoin: r.join('lines.solid_joinstyle'),
      dashCap: r.cap('lines.dash_capstyle'), dashJoin: r.join('lines.dash_joinstyle'),
      patterns: { dashed: r.numList('lines.dashed_pattern', 0), dashdot: r.numList('lines.dashdot_pattern', 0), dotted: r.numList('lines.dotted_pattern', 0) },
      scaleDashes: r.bool('lines.scale_dashes'),
    },
    simplify: r.bool('path.simplify') ? { kind: 'on', thresholdPx: r.num('path.simplify_threshold') } : { kind: 'off' },
    patch: { linewidthPt: r.num('patch.linewidth'), edge: r.rgb('patch.edgecolor', cycle), forceEdge: r.bool('patch.force_edgecolor') },
    grid: { color: r.rgb('grid.color', cycle), style: r.solidStyle('grid.linestyle'), widthPt: r.num('grid.linewidth'), alpha: r.num('grid.alpha') },
    xtick: tickTheme(r, 'x', fontPt, cycle),
    ytick: tickTheme(r, 'y', fontPt, cycle),
    legend: {
      loc: r.fromResult('legend.loc', parseLegendLoc(r.raw('legend.loc')), { kind: 'best' }),
      frame: r.bool('legend.frameon'), frameAlpha: r.num('legend.framealpha'), face: legendFace, edge: legendEdge, fancy: r.bool('legend.fancybox'),
      fontSizePt: r.size('legend.fontsize', fontPt),
      labelColor: legendLabel === 'None' || legendLabel === 'none' ? textColor : r.rgb('legend.labelcolor', cycle),
      borderPad: r.num('legend.borderpad'), labelSpacing: r.num('legend.labelspacing'),
      handleLength: r.num('legend.handlelength'), handleHeight: r.num('legend.handleheight'),
      handleTextPad: r.num('legend.handletextpad'), borderAxesPad: r.num('legend.borderaxespad'), columnSpacing: r.num('legend.columnspacing'),
    },
    offsetTextPadPt: 3,   // Axis.OFFSETTEXTPAD (class constant)
  };
  return r.errors.length > 0 ? err(`invalid rcParams:\n  ${r.errors.join('\n  ')}`) : ok(theme);
}
