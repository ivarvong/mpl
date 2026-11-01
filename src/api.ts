// The imperative shell: a matplotlib-shaped API. Everything a caller passes is
// `unknown` until parsed here into the typed model (parse, don't validate);
// unknown keyword arguments are errors, as in matplotlib.
import { parsePaint, parseRgb } from './core/colors.ts';
import { date2num, fromEpochMs } from './core/dates.ts';
import type { FmtShape } from './core/fmt.ts';
import { parseFmt, parseLinestyle, parseMarker } from './core/fmt.ts';
import { layoutFigure, supBoxes, unionBox } from './core/layout.ts';
import type { GridSpec, SubplotParams, SubplotSpec } from './core/gridspec.ts';
import { cellPosition, validParams } from './core/gridspec.ts';
import { parseWeight } from './core/fonts.ts';
import type { RcLayer, RcValue } from './core/rc.ts';
import { DEFAULTS } from './core/rc.ts';
import { isNullish, isPlainObject, lookup, prop } from './core/std.ts';
import type { StyleSpec } from './core/style.ts';
import { composeStyles } from './core/style.ts';
import { parseFontSize, parseLegendLoc, parseTheme } from './core/theme.ts';
import type {
  Artist, AxesMeta, AxesRole, AxesSpec, AxisSpec, BarArtist, FillArtist, HAlign, TextArtist, TextCoords, VAlign, BarEdge, FigureSpec, AxesGrid, AxisGrid, GridLines, GridWhich, Label, LabelSpec, LegendSpec, Limits,
  LineArtist, LineMarkers, LineStroke, LineStyleName, MarkerName, Option, Orientation, Paint, Position, Result, Rgb, Scale, Scene, Theme, TickSpec, TickGrid, TickLabelStyle, TickLabelStyles, ScatterArtist, SpanArtist, TickTheme, AnnotationArtist, AnnotationCoords,
} from './core/types.ts';
import { assertNever, err, none, ok, some, unwrap } from './core/types.ts';
import { iolistToString } from './render/iolist.ts';
import { leafCount, svgChunks, svgIO, svgStream } from './render/svg.ts';
import type { Canvas } from './render/agg.ts';
import { renderRGBA, renderScratch } from './render/agg.ts';
import { encodePNG, encodePNGSync, pngStream } from './render/png.ts';
import { tracer } from './trace.ts';

export type Kwargs = Readonly<Record<string, unknown>>;

// ---------------------------------------------------------------- primitive parsers
const num = (what: string) => (v: unknown): Result<number> =>
  (typeof v === 'number' && !Number.isNaN(v) ? ok(v) : err(`${what} must be a number, got ${JSON.stringify(v)}`));
const positive = (what: string) => (v: unknown): Result<number> =>
  (typeof v === 'number' && v > 0 && Number.isFinite(v) ? ok(v) : err(`${what} must be a positive number, got ${JSON.stringify(v)}`));
const bool = (what: string) => (v: unknown): Result<boolean> => (typeof v === 'boolean' ? ok(v) : err(`${what} must be a bool, got ${JSON.stringify(v)}`));
const str = (v: unknown): string => String(v);
const label = (v: unknown): Result<Label> => {
  const s = str(v);
  return ok(s.startsWith('_') ? { kind: 'none' } : { kind: 'text', text: s });   // matplotlib hides '_'-prefixed labels
};

/** Reads keyword arguments by name and aliases, then rejects anything left over. null means "default", as None does. */
class KwReader {
  readonly kw: Kwargs;
  readonly fn: string;
  readonly used = new Set<string>();
  constructor(kw: Kwargs, fn: string) { this.kw = kw; this.fn = fn; }
  get(names: readonly string[]): Option<unknown> {
    let found: Option<unknown> = none;
    for (const n of names) {
      this.used.add(n);
      const v = prop(this.kw, n);
      if (v.kind === 'some' && !isNullish(v.value)) {
        if (found.kind === 'some') throw new TypeError(`${this.fn}() got both ${names.join(' and ')}`);
        found = v;
      }
    }
    return found;
  }
  read<T>(names: readonly string[], parse: (v: unknown) => Result<T>, dflt: () => T): T {
    const v = this.get(names);
    return v.kind === 'some' ? unwrap(parse(v.value)) : dflt();
  }
  done(): void {
    const extra = Object.keys(this.kw).filter((k) => !this.used.has(k));
    if (extra.length > 0) throw new TypeError(`${this.fn}() got an unexpected keyword argument '${extra[0]}'`);
  }
}

// ---------------------------------------------------------------- data
type Series =
  | { readonly kind: 'numeric'; readonly values: Float64Array }
  | { readonly kind: 'strings'; readonly values: readonly string[] }
  | { readonly kind: 'datetime'; readonly values: Float64Array };   // date numbers (days since 1970-01-01 UTC)

type NumericTypedArray = Float32Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array;
const isNumericTypedArray = (v: unknown): v is NumericTypedArray =>
  v instanceof Float32Array || v instanceof Int8Array || v instanceof Uint8Array || v instanceof Uint8ClampedArray
  || v instanceof Int16Array || v instanceof Uint16Array || v instanceof Int32Array || v instanceof Uint32Array;

function parseSeries(v: unknown, what: string): Result<Series> {
  if (v instanceof Float64Array) return ok({ kind: 'numeric', values: v });              // zero-copy
  if (isNumericTypedArray(v)) return ok({ kind: 'numeric', values: Float64Array.from(v) });
  if (typeof v === 'number') return ok({ kind: 'numeric', values: Float64Array.of(v) });
  if (!Array.isArray(v)) return err(`${what} must be an array, got ${typeof v}`);
  const a: readonly unknown[] = v;
  if (a.every((x) => typeof x === 'string')) return a.length > 0 ? ok({ kind: 'strings', values: a.map(str) }) : ok({ kind: 'numeric', values: new Float64Array(0) });
  if (a.length > 0 && a.every((x) => x instanceof Date)) {                                // DateConverter
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) { const d = a[i]; out[i] = d instanceof Date && !Number.isNaN(d.getTime()) ? date2num(fromEpochMs(d.getTime())) : NaN; }
    return ok({ kind: 'datetime', values: out });
  }
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (typeof x === 'number') out[i] = x;
    else if (isNullish(x)) out[i] = NaN;                                                   // None -> nan
    else return err(`${what}[${i}]: expected a number, got ${JSON.stringify(x)}`);
  }
  return ok({ kind: 'numeric', values: out });
}

/** Broadcast a scalar or array kwarg to n values. */
function broadcast(v: unknown, n: number, what: string): Result<Float64Array> {
  const s = parseSeries(v, what);
  if (!s.ok) return s;
  if (s.value.kind === 'strings') return err(`${what} must be numeric`);
  const vals = s.value.values;
  if (vals.length === n) return ok(vals);
  if (vals.length === 1) return ok(new Float64Array(n).fill(vals[0]));
  return err(`${what} has ${vals.length} values, expected 1 or ${n}`);
}

type Units = { readonly kind: 'numeric' } | { readonly kind: 'category'; readonly names: readonly string[] } | { readonly kind: 'datetime' };

class Axis {
  units: Units = { kind: 'numeric' };
  scale: Scale = { kind: 'linear' };
  limits: Limits = { kind: 'auto' };
  ticks: TickSpec = { kind: 'auto' };
  labels: LabelSpec = { kind: 'auto' };
  /** StrCategoryConverter: strings map to 0..n-1 in first-seen order; the axis becomes categorical. */
  convert(s: Series): Float64Array {
    switch (s.kind) {
      case 'numeric': return s.values;
      case 'datetime': this.units = { kind: 'datetime' }; return s.values;
      case 'strings': {
        const names = this.units.kind === 'category' ? [...this.units.names] : [];
        const index = new Map(names.map((nm, i) => [nm, i]));
        const out = new Float64Array(s.values.length);
        s.values.forEach((nm, i) => {
          if (!index.has(nm)) { index.set(nm, names.length); names.push(nm); }
          out[i] = names.indexOf(nm);
        });
        this.units = { kind: 'category', names };
        return out;
      }
      default: return assertNever(s);
    }
  }
  setScale(v: unknown): void {
    if (v === 'linear') this.scale = { kind: 'linear' };
    else if (v === 'log') this.scale = { kind: 'log', base: 10 };
    else throw new TypeError(`unsupported scale ${JSON.stringify(v)}; supported: 'linear', 'log'`);
  }
  setLimits(args: readonly unknown[], fn: string): void {
    const pair: readonly unknown[] = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    if (pair.length !== 2) throw new TypeError(`${fn}() takes (lo, hi) or ([lo, hi])`);
    this.limits = { kind: 'fixed', lo: unwrap(num(`${fn} lo`)(pair[0])), hi: unwrap(num(`${fn} hi`)(pair[1])) };
  }
  spec(): AxisSpec {
    switch (this.units.kind) {
      case 'numeric': return { kind: 'numeric', scale: this.scale, limits: this.limits, ticks: this.ticks, labels: this.labels };
      case 'category': return { kind: 'category', names: this.units.names, limits: this.limits, ticks: this.ticks, labels: this.labels };
      case 'datetime': return { kind: 'datetime', limits: this.limits, ticks: this.ticks, labels: this.labels };
      default: return assertNever(this.units);
    }
  }
}

function shapeDefaults(shape: FmtShape, theme: Theme): { readonly line: Option<LineStyleName>; readonly marker: Option<MarkerName> } {
  switch (shape.kind) {
    case 'default': return { line: theme.lines.style, marker: theme.lines.marker };
    case 'line': return { line: some(shape.line), marker: none };
    case 'marker': return { line: none, marker: some(shape.marker) };
    case 'both': return { line: some(shape.line), marker: some(shape.marker) };
    default: return assertNever(shape);
  }
}

// ---------------------------------------------------------------- Axes
export class Axes {
  readonly fig: Figure;
  readonly role: AxesRole;
  readonly theme: Theme;
  /** The SubplotSpec this Axes occupies; its position follows the figure's subplot parameters. */
  readonly cell: SubplotSpec;
  readonly artists: Artist[] = [];
  readonly xaxis: Axis;
  readonly yaxis: Axis;
  /** _label_outer_xaxis / _label_outer_yaxis: tick labels (major and minor) and offset text hidden */
  private hiddenLabels = { x: false, y: false };
  title = ''; titleLoc: HAlign = 'center'; titleWeight = 400; xlabel = ''; ylabel = '';
  private grid_: AxesGrid;
  legendSpec: LegendSpec = { kind: 'off' };
  private spineOv: {
    left: { visible: boolean; color: Option<Rgb>; widthPt: Option<number>; position: Option<{ kind: 'outward'; pts: number }> };
    right: { visible: boolean; color: Option<Rgb>; widthPt: Option<number>; position: Option<{ kind: 'outward'; pts: number }> };
    top: { visible: boolean; color: Option<Rgb>; widthPt: Option<number>; position: Option<{ kind: 'outward'; pts: number }> };
    bottom: { visible: boolean; color: Option<Rgb>; widthPt: Option<number>; position: Option<{ kind: 'outward'; pts: number }> };
  } = {
    left: { visible: true, color: none, widthPt: none, position: none },
    right: { visible: true, color: none, widthPt: none, position: none },
    top: { visible: true, color: none, widthPt: none, position: none },
    bottom: { visible: true, color: none, widthPt: none, position: none },
  };
  private tickXOv: Theme['xtick'];
  private tickYOv: Theme['ytick'];
  // matplotlib keeps separate cyclers for lines (_get_lines) and filled patches (_get_patches_for_fill)
  private lineCycle = 0;
  private patchCycle = 0;

  constructor(fig: Figure, role: AxesRole, cell: SubplotSpec, xaxis: Axis, yaxis: Axis) {
    this.fig = fig; this.role = role; this.theme = fig.theme; this.cell = cell; this.yaxis = yaxis;
    this.titleWeight = this.theme.font.titleWeight; this.titleLoc = this.theme.axes.titleLoc;
    this.xaxis = xaxis; this.grid_ = initialGrid(fig.theme);
    this.tickXOv = { ...this.theme.xtick }; this.tickYOv = { ...this.theme.ytick };
  }
  /** A second Axes sharing this one's x axis, with its y axis on the right. */
  twinx(): Axes {
    const host = this.fig.axes.indexOf(this);
    const twin = new Axes(this.fig, { kind: 'twinx', host }, this.cell, this.xaxis, new Axis());
    this.fig.axes.push(twin);
    return twin;
  }
  /** The Axes box [left, bottom, right, top] in figure fractions (SubplotSpec.get_position). */
  get position(): Position { return cellPosition(this.cell, this.fig.subplotpars); }
  /**
   * Axes._label_outer_xaxis / _label_outer_yaxis for a shared grid (subplots(sharex='col'|'all', …)): an
   * Axes off the bottom row loses its x tick labels and offset text, one off the left column its y ones.
   * Tick labels stay on the outer edge only; ticks are kept.
   */
  labelOuter(axis: 'x' | 'y'): void {
    const { rows, cols, grid } = this.cell;
    if (axis === 'x' && rows[1] !== grid.nrows) { this.xlabel = ''; this.hiddenLabels = { ...this.hiddenLabels, x: true }; }
    if (axis === 'y' && cols[0] !== 0) { this.ylabel = ''; this.hiddenLabels = { ...this.hiddenLabels, y: true }; }
  }
  /** set_xscale('linear' | 'log') */
  set_xscale(s: unknown): this { this.xaxis.setScale(s); return this; }
  /** set_yscale('linear' | 'log') */
  set_yscale(s: unknown): this { this.yaxis.setScale(s); return this; }
  private next(which: 'line' | 'patch'): Rgb {
    const c = this.theme.axes.cycle;
    return which === 'line' ? c[this.lineCycle++ % c.length] : c[this.patchCycle++ % c.length];
  }
  private paint = (v: unknown): Result<Paint> => parsePaint(v, this.theme.axes.cycle);

  /** plot(y) | plot(x, y) | plot(x, y, fmt), with an optional trailing kwargs object. */
  plot(...args: readonly unknown[]): LineArtist {
    const rest = [...args];
    const kwRaw = rest.length > 0 && isPlainObject(rest[rest.length - 1]) ? rest.pop() : {};
    const kw = new KwReader(isPlainObject(kwRaw) ? kwRaw : {}, 'plot');
    const fmtRaw = rest.length > 0 && typeof rest[rest.length - 1] === 'string' ? rest.pop() : '';
    const fmt = unwrap(parseFmt(str(fmtRaw)));
    if (rest.length !== 1 && rest.length !== 2) throw new TypeError(`plot() takes y, or x and y, then an optional fmt; got ${rest.length} data arguments`);
    const ys = unwrap(parseSeries(rest[rest.length - 1], 'y'));
    const xs: Series = rest.length === 2 ? unwrap(parseSeries(rest[0], 'x')) : { kind: 'numeric', values: Float64Array.from({ length: ys.values.length }, (_, i) => i) };
    if (xs.values.length !== ys.values.length) throw new RangeError(`x and y must have the same length, got ${xs.values.length} and ${ys.values.length}`);

    const T = this.theme.lines;
    const color0: Paint = kw.read(['color', 'c'], this.paint, () => (fmt.color.kind === 'some' ? unwrap(this.paint(fmt.color.value)) : { kind: 'solid', color: this.next('line') }));
    // Line2D.set_alpha replaces the alpha of the line colour and of the marker face and edge
    const alpha = kw.read(['alpha'], (v): Result<Option<number>> => (typeof v === 'number' && v >= 0 && v <= 1 ? ok(some(v)) : err('alpha must be in [0, 1]')), (): Option<number> => none);
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha.kind === 'some' ? { kind: 'solid', color: { hex: p.color.hex, alpha: alpha.value } } : p);
    const color = withAlpha(color0);
    const dflt = shapeDefaults(fmt.shape, this.theme);
    const style = kw.read(['linestyle', 'ls'], parseLinestyle, () => dflt.line);
    const marker = kw.read(['marker'], parseMarker, () => dflt.marker);
    const widthPt = kw.read(['linewidth', 'lw'], num('linewidth'), () => T.widthPt);
    const sizePt = kw.read(['markersize', 'ms'], num('markersize'), () => T.markerSizePt);
    const edgeWidthPt = kw.read(['markeredgewidth', 'mew'], num('markeredgewidth'), () => T.markerEdgeWidthPt);
    const face = withAlpha(kw.read(['markerfacecolor', 'mfc'], this.paint, () => (T.markerFace.kind === 'some' ? T.markerFace.value : color0)));
    const edge = withAlpha(kw.read(['markeredgecolor', 'mec'], this.paint, () => (T.markerEdge.kind === 'some' ? T.markerEdge.value : color0)));
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();

    const stroke: LineStroke = style.kind === 'some' && color.kind === 'solid' && widthPt > 0
      ? { kind: 'on', color: color.color, widthPt, style: style.value } : { kind: 'none' };
    const markers: LineMarkers = marker.kind === 'some' ? { kind: 'on', shape: marker.value, sizePt, edgeWidthPt, face, edge } : { kind: 'none' };
    const line: LineArtist = { kind: 'line', x: this.xaxis.convert(xs), y: this.yaxis.convert(ys), stroke, markers, label: lbl, clip };
    this.artists.push(line);
    return line;
  }

  /** bar(x, height, { width, bottom, align, color|facecolor|fc, edgecolor|ec, linewidth|lw, alpha, label, clip_on }) — vertical bars. */
  bar(x: unknown, height: unknown, kwargs: Kwargs = {}): BarArtist { return this.bars(x, height, kwargs, 'vertical'); }
  /** barh(y, width, { height, left, align, color|facecolor|fc, edgecolor|ec, linewidth|lw, alpha, label, clip_on }) — horizontal bars; `left` offsets each bar (Gantt and waterfall charts). */
  barh(y: unknown, width: unknown, kwargs: Kwargs = {}): BarArtist { return this.bars(y, width, kwargs, 'horizontal'); }

  private bars(posRaw: unknown, sizeRaw: unknown, kwargs: Kwargs, o: Orientation): BarArtist {
    const fn = o === 'vertical' ? 'bar' : 'barh';
    const kw = new KwReader(kwargs, fn);
    const posAxis = o === 'vertical' ? this.xaxis : this.yaxis;
    const pos = posAxis.convert(unwrap(parseSeries(posRaw, 'x')));
    const n = pos.length;
    const size = unwrap(broadcast(sizeRaw, n, o === 'vertical' ? 'height' : 'width'));
    const thick = kw.read([o === 'vertical' ? 'width' : 'height'], (v) => broadcast(v, n, 'thickness'), () => new Float64Array(n).fill(0.8));
    const base = kw.read([o === 'vertical' ? 'bottom' : 'left'], (v) => broadcast(v, n, 'base'), () => new Float64Array(n));
    const align = kw.read(['align'], (v): Result<'center' | 'edge'> => (v === 'center' || v === 'edge' ? ok(v) : err(`align must be 'center' or 'edge'`)), () => 'center');
    // color= is one colour or a list cycled over the bars (bar() chains itertools.cycle over it)
    const paints = (v: unknown): Result<readonly Paint[]> => {
      const one = this.paint(v);
      if (one.ok) return ok([one.value]);
      if (!Array.isArray(v) || v.length === 0) return one;
      const list: Paint[] = [];
      for (const c of v) { const p = this.paint(c); if (!p.ok) return p; list.push(p.value); }
      return ok(list);
    };
    const faceList = kw.read(['color', 'facecolor', 'fc'], paints, (): readonly Paint[] => [{ kind: 'solid', color: this.next('patch') }]);
    const edgePaint0 = kw.read(['edgecolor', 'ec'], this.paint, (): Paint => (this.theme.patch.forceEdge ? { kind: 'solid', color: this.theme.patch.edge } : { kind: 'none' }));
    const lw = kw.read(['linewidth', 'lw'], num('linewidth'), () => this.theme.patch.linewidthPt);
    const alpha = kw.read(['alpha'], (v): Result<Option<number>> => (typeof v === 'number' && v >= 0 && v <= 1 ? ok(some(v)) : err('alpha must be in [0, 1]')), (): Option<number> => none);
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    // Patch.set_alpha replaces the alpha of both face and edge colours
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha.kind === 'some' ? { kind: 'solid', color: { hex: p.color.hex, alpha: alpha.value } } : p);
    const faces = Array.from({ length: n }, (_, i) => withAlpha(faceList[i % faceList.length]));
    const face = faces.length > 0 ? faces[0] : withAlpha(faceList[0]);
    const edgePaint = withAlpha(edgePaint0);

    const lo = pos.map((p, i) => (align === 'center' ? p - thick[i] / 2 : p));
    const edge: BarEdge = edgePaint.kind === 'solid' && edgePaint.color.alpha > 0 && lw > 0 ? { kind: 'on', color: edgePaint.color, widthPt: lw } : { kind: 'none' };
    // (x, y) is the corner at the base: vertical bars grow along y from `base`
    const bar: BarArtist = o === 'vertical'
      ? { kind: 'bar', orientation: o, x: lo, y: base, w: thick, h: size, face, faces, edge, label: lbl, clip }
      : { kind: 'bar', orientation: o, x: base, y: lo, w: size, h: thick, face, faces, edge, label: lbl, clip };
    this.artists.push(bar);
    return bar;
  }

  /** fill_between(x, y1, y2 = 0, { color, alpha, label }) — a FillBetweenPolyCollection with no edges. */
  fill_between(xRaw: unknown, y1Raw: unknown, ...rest: readonly unknown[]): FillArtist {
    // y2 is optional, so a trailing plain object is the kwargs, as in plot()
    const tail = [...rest];
    const kwRaw = tail.length > 0 && isPlainObject(tail[tail.length - 1]) ? tail.pop() : {};
    const y2Raw = tail.length > 0 ? tail[0] : 0;
    const kw = new KwReader(isPlainObject(kwRaw) ? kwRaw : {}, 'fill_between');
    const x = this.xaxis.convert(unwrap(parseSeries(xRaw, 'x')));
    const n = x.length;
    const y1 = typeof y1Raw === 'number' ? new Float64Array(n).fill(y1Raw) : this.yaxis.convert(unwrap(parseSeries(y1Raw, 'y1')));
    const y2 = typeof y2Raw === 'number' ? new Float64Array(n).fill(y2Raw) : this.yaxis.convert(unwrap(parseSeries(y2Raw, 'y2')));
    if (y1.length !== n || y2.length !== n) throw new RangeError(`fill_between: x, y1 and y2 must have the same length, got ${n}, ${y1.length}, ${y2.length}`);
    const both = kw.read(['color'], (v) => this.paint(v).ok ? ok(some(unwrap(this.paint(v)))) : err('bad color'), (): Option<Paint> => none);
    const face0 = kw.read(['facecolor', 'fc'], this.paint, (): Paint => (both.kind === 'some' ? both.value : { kind: 'solid', color: this.next('patch') }));
    const alpha = kw.read(['alpha'], unitInterval('alpha'), () => -1);
    const lw = kw.read(['linewidth', 'lw'], num('linewidth'), () => this.theme.patch.linewidthPt);
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha >= 0 ? { kind: 'solid', color: { hex: p.color.hex, alpha } } : p);
    const face = withAlpha(face0);
    // Collection edgecolor: color= if given, else patch.edgecolor when patch.force_edgecolor, else none.
    // An edge with a colour exists even at linewidth 0: it decides Collection.draw's code path.
    const forced: Paint = this.theme.patch.forceEdge ? { kind: 'solid', color: this.theme.patch.edge } : { kind: 'none' };
    const edgeP = withAlpha(both.kind === 'some' ? both.value : forced);
    const edge: BarEdge = edgeP.kind === 'solid' && edgeP.color.alpha > 0 ? { kind: 'on', color: edgeP.color, widthPt: Math.max(0, lw) } : { kind: 'none' };
    const fill: FillArtist = { kind: 'fill', x, y1, y2, face, edge, label: lbl, clip };
    this.artists.push(fill);
    return fill;
  }

  /** The transform tokens text() understands, named as in matplotlib. */
  get transData(): TransformRef { return { kind: 'transform', coords: 'data' }; }
  /** Axes-fraction coordinates for text(): (0, 0) bottom left, (1, 1) top right. */
  get transAxes(): TransformRef { return { kind: 'transform', coords: 'axes' }; }

  /** text(x, y, s, { transform, color, fontsize, ha, va }) — data coordinates unless transform: ax.transAxes. */
  text(xRaw: unknown, yRaw: unknown, s: unknown, kwargs: Kwargs = {}): TextArtist {
    const kw = new KwReader(kwargs, 'text');
    const coords = kw.read(['transform'], (v): Result<TextCoords> => (isPlainObject(v) && prop(v, 'kind').kind === 'some' && (prop(v, 'coords').kind === 'some')
      ? parseCoords(prop(v, 'coords')) : err('transform must be ax.transData or ax.transAxes')), (): TextCoords => 'data');
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.font.sizePt);
    const ha = kw.read(['ha', 'horizontalalignment'], parseHAlign, (): HAlign => 'left');
    const va = kw.read(['va', 'verticalalignment'], parseVAlign, (): VAlign => 'baseline');
    const weight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.font.weight);
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    // data coordinates go through the axis converter, so a Date works on a datetime axis
    const at = (v: unknown, axis: Axis, name: string): number => (coords === 'axes'
      ? (typeof v === 'number' ? v : unwrap(err<number>(`text: ${name} must be a number in axes coordinates`)))
      : axis.convert(unwrap(parseSeries([v], name)))[0]);
    const t: TextArtist = { kind: 'text', x: at(xRaw, this.xaxis, 'x'), y: at(yRaw, this.yaxis, 'y'), coords, text: str(s), sizePt, weight, color, ha, va, clip };
    this.artists.push(t);
    return t;
  }

  /** annotate(text, xy, { xytext, xycoords, textcoords, arrowprops, ha, va, color, fontsize, fontweight, clip_on }) — coords are 'data' or '<figure|axes> <fraction|points|pixels|fontsize>', and textcoords may also be 'offset <points|pixels|fontsize>' from xy. */
  annotate(text: unknown, xy: unknown, kwargs: Kwargs = {}): AnnotationArtist {
    const kw = new KwReader(kwargs, 'annotate');
    const xytextV = kw.get(['xytext']);
    const xycoords = kw.read(['xycoords'], (v) => parseAnnotationCoords(v, 'xycoords'), (): AnnotationCoords => ({ kind: 'data' }));
    const textcoords = kw.read(['textcoords'], (v) => parseAnnotationCoords(v, 'textcoords'), () => xycoords);
    type Arrow = AnnotationArtist['arrow'];
    const arrow = kw.read(['arrowprops'], (v): Result<Arrow> => {
      if (!isPlainObject(v)) return err('arrowprops must be an object');
      const known = new Set(['color', 'facecolor', 'edgecolor', 'linewidth', 'lw', 'width', 'headwidth', 'headlength', 'shrink']);
      const extra = Object.keys(v).filter((key) => !known.has(key));
      if (extra.length > 0) return err(`unsupported arrowprops: ${extra.join(', ')}`);
      const numOr = (key: string, d: number): number => { const p = prop(v, key); return p.kind === 'some' ? unwrap(num(key)(p.value)) : d; };
      const rgbOr = (key: string, d: Rgb): Rgb => { const p = prop(v, key); return p.kind === 'some' ? unwrap(parseRgb(p.value, this.theme.axes.cycle)) : d; };
      // FancyArrowPatch defaults: patch.facecolor (C0) and patch.edgecolor; 'color' sets both
      const color = prop(v, 'color');
      const base = color.kind === 'some' ? some(unwrap(parseRgb(color.value, this.theme.axes.cycle))) : none;
      const face = rgbOr('facecolor', base.kind === 'some' ? base.value : this.theme.axes.cycle[0]);
      const edge = rgbOr('edgecolor', base.kind === 'some' ? base.value : unwrap(parseRgb('black', this.theme.axes.cycle)));
      const lwKey = prop(v, 'lw').kind === 'some' ? 'lw' : 'linewidth';
      // Annotation.update_positions: width 4, headwidth 12, headlength 12, shrink 0 (all pt but shrink)
      return ok(some({ face, edge, linewidthPt: numOr(lwKey, 1), widthPt: numOr('width', 4), headLengthPt: numOr('headlength', 12),
                       headWidthPt: numOr('headwidth', 12), shrink: numOr('shrink', 0) }));
    }, (): Arrow => none);
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.font.sizePt);
    const weight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.font.weight);
    const ha = kw.read(['ha', 'horizontalalignment'], parseHAlign, (): HAlign => 'left');
    const va = kw.read(['va', 'verticalalignment'], parseVAlign, (): VAlign => 'baseline');
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => false);   // matplotlib default: annotations are not clipped
    kw.done();
    const xyOk = ((): readonly [number, number] => {
      if (Array.isArray(xy) && xy.length === 2 && typeof xy[0] === 'number' && typeof xy[1] === 'number') return [xy[0], xy[1]];
      throw new TypeError('xy must be [x, y] numbers');
    })();
    const xytextOk = ((): readonly [number, number] => {
      if (xytextV.kind !== 'some') return xyOk;
      const v = xytextV.value;
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number') return [v[0], v[1]];
      throw new TypeError('xytext must be [x, y] numbers');
    })();
    const a: AnnotationArtist = {
      kind: 'annotation', x: xyOk[0], y: xyOk[1], xycoords,
      tx: xytextOk[0], ty: xytextOk[1], textcoords, text: str(text),
      sizePt, weight, color, ha, va,
      arrow,
      clip,
    };
    this.artists.push(a);
    return a;
  }

  /** scatter(x, y, { s, c, marker, alpha, edgecolors, linewidths, zorder, clip_on }) */
  scatter(xRaw: unknown, yRaw: unknown, kwargs: Kwargs = {}): ScatterArtist {
    const kw = new KwReader(kwargs, 'scatter');
    const xs = this.xaxis.convert(unwrap(parseSeries(xRaw, 'x')));
    const ys = this.yaxis.convert(unwrap(parseSeries(yRaw, 'y')));
    if (xs.length !== ys.length) throw new RangeError(`scatter: x and y must have the same length, got ${xs.length} and ${ys.length}`);
    const n = xs.length;
    const s = kw.read(['s'], (v) => broadcast(v, n, 's'), () => new Float64Array(n).fill(36)); // matplotlib default 36 pt^2
    const marker = kw.read(['marker'], parseMarker, () => unwrap(parseMarker('o')));
    const alpha = kw.read(['alpha'], (v): Result<Option<number>> => (typeof v === 'number' && v >= 0 && v <= 1 ? ok(some(v)) : err('alpha must be in [0, 1]')), (): Option<number> => none);
    const parsePaintOrList = (v: unknown): Result<readonly Paint[]> => {
      const one = this.paint(v);
      if (one.ok) return ok([one.value]);
      if (!Array.isArray(v) || v.length === 0) return one;
      const out: Paint[] = [];
      for (const c of v) { const p = this.paint(c); if (!p.ok) return p; out.push(p.value); }
      return ok(out);
    };
    const colorList0 = kw.read(['c', 'color'], (v) => parsePaintOrList(v), (): readonly Paint[] => [{ kind: 'solid', color: this.next('patch') }]);
    const edgecolorsList = kw.read(['edgecolors', 'edgecolor'], (v) => parsePaintOrList(v), (): readonly Paint[] => [{ kind: 'none' }]);
    const linewidths = kw.read(['linewidths', 'linewidth'], num('linewidths'), () => 0.5);
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha.kind === 'some' ? { kind: 'solid', color: { hex: p.color.hex, alpha: alpha.value } } : p);
    const faces = Array.from({ length: n }, (_, i) => withAlpha(colorList0[(i) % colorList0.length]));
    const edges = Array.from({ length: n }, (_, i) => withAlpha(edgecolorsList[(i) % edgecolorsList.length]));
    const sc: ScatterArtist = { kind: 'scatter', x: xs, y: ys, sizePt2: s, shape: marker.kind === 'some' ? marker.value : 'o', faces, edges, edgeWidthPt: linewidths, label: lbl, clip };
    this.artists.push(sc);
    return sc;
  }

  /** axvspan: vertical span in data x and axes-fraction y */
  axvspan(xmin: unknown, xmax: unknown, kwargs: Kwargs = {}): SpanArtist {
    const kw = new KwReader(kwargs, 'axvspan');
    const x0 = unwrap(parseSeries([xmin], 'xmin')); const x1 = unwrap(parseSeries([xmax], 'xmax'));
    const ymin = kw.read(['ymin'], num('ymin'), () => 0); const ymax = kw.read(['ymax'], num('ymax'), () => 1);
    // Patch semantics: 'color' sets both face and edge colour.
    const both = kw.read(['color'], (v) => this.paint(v).ok ? ok(some(unwrap(this.paint(v)))) : err('bad color'), (): Option<Paint> => none);
    const face0 = kw.read(['facecolor', 'fc'], this.paint, (): Paint => (both.kind === 'some' ? both.value : { kind: 'solid', color: this.next('patch') }));
    const ec = kw.read(['edgecolor', 'ec'], this.paint, (): Paint => (both.kind === 'some' ? both.value : { kind: 'none' }));
    const lw = kw.read(['linewidth', 'lw'], num('linewidth'), () => this.theme.patch.linewidthPt);
    const alpha = kw.read(['alpha'], unitInterval('alpha'), () => -1);
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha >= 0 ? { kind: 'solid', color: { hex: p.color.hex, alpha } } : p);
    const face = withAlpha(face0);
    let edgeColor = ec.kind === 'solid' ? ec.color : { hex: '#000000', alpha: 0 };
    if (ec.kind === 'solid') { const ea = withAlpha(ec); if (ea.kind === 'solid') edgeColor = ea.color; }
    const edge: BarEdge = ec.kind === 'solid' && lw > 0 ? { kind: 'on', color: edgeColor, widthPt: lw } : { kind: 'none' };
    const sp: SpanArtist = { kind: 'span', orientation: 'vertical', a0: this.xaxis.convert(x0)[0], a1: this.xaxis.convert(x1)[0], f0: ymin, f1: ymax, face, edge, label: lbl, clip };
    this.artists.push(sp); return sp;
  }
  /** axhspan: horizontal span in data y and axes-fraction x */
  axhspan(ymin: unknown, ymax: unknown, kwargs: Kwargs = {}): SpanArtist {
    const kw = new KwReader(kwargs, 'axhspan');
    const y0 = unwrap(parseSeries([ymin], 'ymin')); const y1 = unwrap(parseSeries([ymax], 'ymax'));
    const xmin = kw.read(['xmin'], num('xmin'), () => 0); const xmax = kw.read(['xmax'], num('xmax'), () => 1);
    const both = kw.read(['color'], (v) => this.paint(v).ok ? ok(some(unwrap(this.paint(v)))) : err('bad color'), (): Option<Paint> => none);
    const face0 = kw.read(['facecolor', 'fc'], this.paint, (): Paint => (both.kind === 'some' ? both.value : { kind: 'solid', color: this.next('patch') }));
    const ec = kw.read(['edgecolor', 'ec'], this.paint, (): Paint => (both.kind === 'some' ? both.value : { kind: 'none' }));
    const lw = kw.read(['linewidth', 'lw'], num('linewidth'), () => this.theme.patch.linewidthPt);
    const alpha = kw.read(['alpha'], unitInterval('alpha'), () => -1);
    const lbl = kw.read(['label'], label, (): Label => ({ kind: 'none' }));
    const clip = kw.read(['clip_on', 'clipon', 'clip'], bool('clip_on'), () => true);
    kw.done();
    const withAlpha = (p: Paint): Paint => (p.kind === 'solid' && alpha >= 0 ? { kind: 'solid', color: { hex: p.color.hex, alpha } } : p);
    const face = withAlpha(face0);
    let edgeColorH = ec.kind === 'solid' ? ec.color : { hex: '#000000', alpha: 0 };
    if (ec.kind === 'solid') { const ea = withAlpha(ec); if (ea.kind === 'solid') edgeColorH = ea.color; }
    const edge: BarEdge = ec.kind === 'solid' && lw > 0 ? { kind: 'on', color: edgeColorH, widthPt: lw } : { kind: 'none' };
    const sp: SpanArtist = { kind: 'span', orientation: 'horizontal', a0: this.yaxis.convert(y0)[0], a1: this.yaxis.convert(y1)[0], f0: xmin, f1: xmax, face, edge, label: lbl, clip };
    this.artists.push(sp); return sp;
  }

  /** set_title(s, { loc: 'left' | 'center' | 'right' }) */
  set_title(s: unknown, kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'set_title');
    this.titleLoc = kw.read(['loc'], parseHAlign, () => this.theme.axes.titleLoc);
    this.titleWeight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.font.titleWeight);
    kw.done();
    this.title = str(s);
    return this;
  }
  /** ax.spines['left'].set_visible(False) etc. */
  get spines(): Record<'left' | 'right' | 'top' | 'bottom', {
    set_visible: (v: boolean) => void; set_color: (v: unknown) => void; set_linewidth: (w: number) => void;
    set_position: (pos: unknown) => void;
  }> {
    const api = (side: 'left' | 'right' | 'top' | 'bottom') => ({
      set_visible: (v: boolean) => { this.spineOv[side].visible = !!v; },
      set_color: (v: unknown) => { this.spineOv[side].color = some(unwrap(parseRgb(v, this.theme.axes.cycle))); },
      set_linewidth: (w: number) => { this.spineOv[side].widthPt = some(unwrap(num('linewidth')(w))); },
      set_position: (p: unknown) => {
        if (Array.isArray(p) && p[0] === 'outward' && typeof p[1] === 'number') this.spineOv[side].position = some({ kind: 'outward', pts: Number(p[1]) });
      },
    });
    return { left: api('left'), right: api('right'), top: api('top'), bottom: api('bottom') };
  }
  /** Tick parameters: axis {'x','y','both'}, which {'major','minor','both'}, length, width, colors, labelsize, bottom/top/left/right, labelbottom/labelleft, pad, direction. */
  tick_params(kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'tick_params');
    const axis = kw.read(['axis'], (v): Result<'both' | 'x' | 'y'> => (v === 'both' || v === 'x' || v === 'y' ? ok(v) : err(`axis must be 'both', 'x' or 'y'`)), () => 'both');
    kw.read(['which'], (v): Result<'both' | 'major' | 'minor'> => (v === 'both' || v === 'major' || v === 'minor' ? ok(v) : err(`which must be 'both'|'major'|'minor'`)), () => 'both');
    const length = kw.get(['length']); const width = kw.get(['width']);
    const colors = kw.get(['colors', 'color']); const labelsize = kw.get(['labelsize']);
    const bottom = kw.get(['bottom']); const top = kw.get(['top']); const left = kw.get(['left']); const right = kw.get(['right']);
    const labelbottom = kw.get(['labelbottom']); const labelleft = kw.get(['labelleft']);
    const pad = kw.get(['pad']); const direction = kw.get(['direction']);
    kw.done();
    const apply = (xy: 'x' | 'y'): void => {
      let tgt: TickTheme = xy === 'x' ? this.tickXOv : this.tickYOv;
      if (length.kind === 'some') { const L = unwrap(num('length')(length.value)); tgt = { ...tgt, sizePt: L, minorSizePt: L }; }
      if (width.kind === 'some') { const W = unwrap(num('width')(width.value)); tgt = { ...tgt, widthPt: W, minorWidthPt: W }; }
      if (colors.kind === 'some') { const c = unwrap(parseRgb(colors.value, this.theme.axes.cycle)); tgt = { ...tgt, color: c, labelColor: c }; }
      if (labelsize.kind === 'some') { const s = unwrap(parseFontSize(labelsize.value, this.theme.font.sizePt)); tgt = { ...tgt, labelSizePt: s }; }
      if (pad.kind === 'some') { const p = unwrap(num('pad')(pad.value)); tgt = { ...tgt, padPt: p, minorPadPt: p }; }
      if (direction.kind === 'some' && (direction.value === 'in' || direction.value === 'out' || direction.value === 'inout')) tgt = { ...tgt, direction: direction.value };
      if (xy === 'x') {
        if (bottom.kind === 'some') tgt = { ...tgt, near: !!bottom.value };
        if (top.kind === 'some') tgt = { ...tgt, far: !!top.value };
        if (labelbottom.kind === 'some') tgt = { ...tgt, labelNear: !!labelbottom.value };
      } else {
        if (left.kind === 'some') tgt = { ...tgt, near: !!left.value };
        if (right.kind === 'some') tgt = { ...tgt, far: !!right.value };
        if (labelleft.kind === 'some') tgt = { ...tgt, labelNear: !!labelleft.value };
      }
      if (xy === 'x') this.tickXOv = tgt; else this.tickYOv = tgt;
    };
    if (axis === 'both' || axis === 'x') apply('x');
    if (axis === 'both' || axis === 'y') apply('y');
    return this;
  }
  /** set_xlabel(s) — x axis label; '\n' starts a new line. */
  set_xlabel(s: unknown): this { this.xlabel = str(s); return this; }
  /** set_ylabel(s) — y axis label, rotated 90°; '\n' starts a new line. */
  set_ylabel(s: unknown): this { this.ylabel = str(s); return this; }
  /** set_xlim(lo, hi) or set_xlim([lo, hi]); lo > hi inverts the axis. */
  set_xlim(...args: readonly unknown[]): this { this.xaxis.setLimits(args, 'set_xlim'); return this; }
  /** set_ylim(lo, hi) or set_ylim([lo, hi]); lo > hi inverts the axis (top-down Gantt rows). */
  set_ylim(...args: readonly unknown[]): this { this.yaxis.setLimits(args, 'set_ylim'); return this; }
  /** set_xticks(locs) — fixed major tick locations. */
  set_xticks(t: unknown): this { this.xaxis.ticks = fixedTicks(t); return this; }
  /** set_yticks(locs) — fixed major tick locations. */
  set_yticks(t: unknown): this { this.yaxis.ticks = fixedTicks(t); return this; }
  /** set_xticklabels(labels, { color|c, fontsize|size, fontweight|weight }): the kwargs style every label set here. */
  set_xticklabels(l: unknown, kwargs: Kwargs = {}): this { return this.setTickLabels('x', l, kwargs, 'set_xticklabels'); }
  /** set_yticklabels(labels, { color|c, fontsize|size, fontweight|weight }): the kwargs style every label set here. */
  set_yticklabels(l: unknown, kwargs: Kwargs = {}): this { return this.setTickLabels('y', l, kwargs, 'set_yticklabels'); }
  /** The major tick labels as Text handles: get_text(), set_fontweight(), set_color(), set_fontsize(). */
  get_xticklabels(): readonly TickLabelText[] { return this.tickLabelHandles('x'); }
  /** The major y tick labels as Text handles (see get_xticklabels). */
  get_yticklabels(): readonly TickLabelText[] { return this.tickLabelHandles('y'); }
  private labelStyles: { x: TickLabelStyles; y: TickLabelStyles } = { x: [], y: [] };
  private setTickLabels(a: 'x' | 'y', l: unknown, kwargs: Kwargs, fn: string): this {
    const labels = fixedLabels(l);
    const kw = new KwReader(kwargs, fn);
    const style = this.readTextStyle(kw);
    kw.done();
    (a === 'x' ? this.xaxis : this.yaxis).labels = labels;
    // Axis.set_ticklabels: kwargs go to each tick's label1 (Text.update), one per label given
    if (labels.kind === 'fixed') labels.labels.forEach((_, i) => { this.styleTickLabel(a, i, style); });
    return this;
  }
  private readTextStyle(kw: KwReader): TickLabelStyle {
    return {
      color: kw.read(['color', 'c'], (v) => { const r = parseRgb(v, this.theme.axes.cycle); return r.ok ? ok(some(r.value)) : r; }, (): Option<Rgb> => none),
      sizePt: kw.read(['fontsize', 'size'], (v) => { const r = parseFontSize(v, this.theme.font.sizePt); return r.ok ? ok(some(r.value)) : r; }, (): Option<number> => none),
      weight: kw.read(['fontweight', 'weight'], (v) => { const r = weightOf(v); return r.ok ? ok(some(r.value)) : r; }, (): Option<number> => none),
    };
  }
  /** Merge `style` into major tick label i (only the properties it sets). */
  private styleTickLabel(a: 'x' | 'y', i: number, style: TickLabelStyle): void {
    const cur = new Map(this.labelStyles[a]);
    const old = lookup(cur, i);
    const base: TickLabelStyle = old.kind === 'some' ? old.value : { color: none, sizePt: none, weight: none };
    cur.set(i, {
      color: style.color.kind === 'some' ? style.color : base.color,
      sizePt: style.sizePt.kind === 'some' ? style.sizePt : base.sizePt,
      weight: style.weight.kind === 'some' ? style.weight : base.weight,
    });
    this.labelStyles = { ...this.labelStyles, [a]: [...cur.entries()].toSorted((p, q) => p[0] - q[0]) };
  }
  private tickLabelHandles(a: 'x' | 'y'): readonly TickLabelText[] {
    // Axis.get_majorticklabels updates the ticks first: run the layout to learn the locator's ticks
    this.fig.toScene();
    const i = this.fig.axes.indexOf(this);
    const meta = this.fig.meta[i];
    const texts = a === 'x' ? meta.x.labels : meta.y.labels;
    const one = { color: none, sizePt: none, weight: none } as const;
    return texts.map((text, j): TickLabelText => ({
      get_text: () => text,
      set_fontweight: (w: unknown) => { this.styleTickLabel(a, j, { ...one, weight: some(unwrap(weightOf(w))) }); },
      set_color: (c: unknown) => { this.styleTickLabel(a, j, { ...one, color: some(unwrap(parseRgb(c, this.theme.axes.cycle))) }); },
      set_fontsize: (s: unknown) => { this.styleTickLabel(a, j, { ...one, sizePt: some(unwrap(parseFontSize(s, this.theme.font.sizePt))) }); },
      set: (kwargs: Kwargs) => { const kw = new KwReader(kwargs, 'Text.set'); const st = this.readTextStyle(kw); kw.done(); this.styleTickLabel(a, j, st); },
    }));
  }
  /** grid(visible?, { which, axis, color|c, linewidth|lw, linestyle|ls, alpha }) — Axes.grid.
   *  As in matplotlib: line kwargs imply visible=True, visible=null toggles, and the line properties
   *  stick to the chosen axes and tick families (major, minor) for later grid() calls. A kwargs object
   *  alone, grid({ ... }), is grid(null, { ... }). */
  grid(visible: unknown = true, kwargs: Kwargs = {}): this {
    // visible: a bool sets it; null/undefined (or a lone kwargs object) is matplotlib's None
    const bare = isPlainObject(visible);
    const kw = new KwReader(bare ? visible : kwargs, 'grid');
    const asked: Option<boolean> = bare || isNullish(visible) ? none : some(unwrap(bool('grid visible')(visible)));
    const axis = kw.read(['axis'], (v): Result<GridWhich> => (v === 'both' || v === 'x' || v === 'y' ? ok(v) : err(`grid axis must be 'both', 'x' or 'y'`)), (): GridWhich => 'both');
    const which = kw.read(['which'], (v): Result<'major' | 'minor' | 'both'> => (v === 'major' || v === 'minor' || v === 'both' ? ok(v) : err(`grid which must be 'major', 'minor' or 'both'`)), () => 'major' as const);
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle).ok ? ok(some(unwrap(parseRgb(v, this.theme.axes.cycle)))) : err(`grid color: ${JSON.stringify(v)} is not a color`), (): Option<Rgb> => none);
    const widthPt = kw.read(['linewidth', 'lw'], (v) => (typeof v === 'number' && v >= 0 ? ok(some(v)) : err('grid linewidth must be a number >= 0')), (): Option<number> => none);
    const style = kw.read(['linestyle', 'ls'], (v) => { const r = parseLinestyle(v); return r.ok ? ok(some(r.value)) : r; }, (): Option<Option<LineStyleName>> => none);
    const alpha = kw.read(['alpha'], (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? ok(some(v)) : err('grid alpha must be in [0, 1]')), (): Option<number> => none);
    kw.done();
    const styled = color.kind === 'some' || widthPt.kind === 'some' || style.kind === 'some' || alpha.kind === 'some';
    // Axis.grid: line properties turn the grid on (visible=False too, with matplotlib's warning)
    if (styled && asked.kind === 'some' && !asked.value) console.warn('UserWarning: First parameter to grid() is false, but line properties are supplied. The grid will be enabled.');
    const on: Option<boolean> = styled ? some(true) : asked;
    // Tick._apply_params: a colour with an alpha channel sets the line alpha unless alpha= is given
    const restyle = (l: GridLines): GridLines => ({
      color: color.kind === 'some' ? color.value : l.color,
      widthPt: widthPt.kind === 'some' ? widthPt.value : l.widthPt,
      style: style.kind === 'some' ? style.value : l.style,
      alpha: alpha.kind === 'some' ? alpha.value : color.kind === 'some' && color.value.alpha < 1 ? color.value.alpha : l.alpha,
    });
    const tick = (t: TickGrid): TickGrid => ({ on: on.kind === 'some' ? on.value : !t.on, lines: restyle(t.lines) });
    const axisGrid = (g: AxisGrid): AxisGrid => ({
      major: which === 'minor' ? g.major : tick(g.major),
      minor: which === 'major' ? g.minor : tick(g.minor),
    });
    const cur = this.grid_;
    this.grid_ = { x: axis === 'y' ? cur.x : axisGrid(cur.x), y: axis === 'x' ? cur.y : axisGrid(cur.y) };
    return this;
  }
  /** legend({ loc, ncols|ncol, frameon, fontsize }) — entries come from artists with a label. */
  legend(kwargs: Kwargs = {}): this {
    const L = this.theme.legend;
    const kw = new KwReader(kwargs, 'legend');
    this.legendSpec = {
      kind: 'on',
      loc: kw.read(['loc'], parseLegendLoc, () => L.loc),
      ncols: kw.read(['ncols', 'ncol'], (v) => (Number.isInteger(v) && Number(v) >= 1 ? ok(Number(v)) : err(`ncols must be an integer >= 1`)), () => 1),
      frame: kw.read(['frameon'], bool('frameon'), () => L.frame),
      fontSizePt: kw.read(['fontsize'], (v) => parseFontSize(v, this.theme.font.sizePt), () => L.fontSizePt),
    };
    kw.done();
    return this;
  }
  /** The Axes as plain data (what layout consumes); mostly for tooling and tests. */
  spec(): AxesSpec {
    return {
      role: this.role, position: this.position, artists: [...this.artists], title: this.title, titleLoc: this.titleLoc, titleWeight: this.titleWeight, xlabel: this.xlabel, ylabel: this.ylabel,
      x: this.xaxis.spec(), y: this.yaxis.spec(), grid: this.grid_, legend: this.legendSpec,
      spines: {
        left: { visible: this.spineOv.left.visible, color: this.spineOv.left.color, widthPt: this.spineOv.left.widthPt, position: this.spineOv.left.position },
        right: { visible: this.spineOv.right.visible, color: this.spineOv.right.color, widthPt: this.spineOv.right.widthPt, position: this.spineOv.right.position },
        top: { visible: this.spineOv.top.visible, color: this.spineOv.top.color, widthPt: this.spineOv.top.widthPt, position: this.spineOv.top.position },
        bottom: { visible: this.spineOv.bottom.visible, color: this.spineOv.bottom.color, widthPt: this.spineOv.bottom.widthPt, position: this.spineOv.bottom.position },
      },
      tick: { x: this.tickXOv, y: this.tickYOv },
      tickLabels: this.labelStyles,
      // shared axes (sharex/sharey, twinx) hold the same Axis: the first Axes holding it leads the group
      xShare: this.fig.axes.findIndex((o) => o.xaxis === this.xaxis),
      yShare: this.fig.axes.findIndex((o) => o.yaxis === this.yaxis),
      hiddenLabels: this.hiddenLabels,
    };
  }
}

/** The rc grid: axes.grid on the axes named by axes.grid.axis, major ticks (axes.grid.which), grid.* lines. */
function initialGrid(theme: Theme): AxesGrid {
  const g = theme.grid, rcGrid = theme.axes.grid;
  // Tick.__init__: alpha precedence is the colour's own alpha channel, then grid.alpha
  const lines: GridLines = { color: g.color, widthPt: g.widthPt, style: some(g.style), alpha: g.color.alpha < 1 ? g.color.alpha : g.alpha };
  const on = (a: 'x' | 'y'): boolean => rcGrid.kind === 'on' && (rcGrid.which === 'both' || rcGrid.which === a);
  const axisGrid = (a: 'x' | 'y'): AxisGrid => ({ major: { on: on(a), lines }, minor: { on: false, lines } });
  return { x: axisGrid('x'), y: axisGrid('y') };
}

function fixedTicks(t: unknown): TickSpec {
  const s = unwrap(parseSeries(t, 'ticks'));
  if (s.kind === 'strings') throw new TypeError('ticks must be numeric');
  return { kind: 'fixed', locs: [...s.values] };
}
function fixedLabels(l: unknown): LabelSpec {
  if (!Array.isArray(l)) throw new TypeError('tick labels must be an array');
  const a: readonly unknown[] = l;
  return { kind: 'fixed', labels: a.map(str) };
}

// ---------------------------------------------------------------- styles & Figure
function rcValue(k: string, v: unknown): Result<RcValue> {
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return ok(v);
  if (Array.isArray(v)) {
    const a: readonly unknown[] = v;
    if (a.every((x) => typeof x === 'number')) return ok(a.map(Number));
    if (a.every((x) => typeof x === 'string')) return ok(a.map(str));
  }
  return err(`rc ${k}: unsupported value ${JSON.stringify(v)}`);
}
function rcLayer(o: Readonly<Record<string, unknown>>): Result<RcLayer> {
  const m = new Map<string, RcValue>();
  for (const [k, v] of Object.entries(o)) { const r = rcValue(k, v); if (!r.ok) return r; m.set(k, r.value); }
  return ok(m);
}
function parseStyles(v: unknown): Result<readonly StyleSpec[]> {
  if (isNullish(v)) return ok([]);
  if (typeof v === 'string') return ok([/[:\n]/.test(v) ? { kind: 'text', text: v } : { kind: 'bundled', name: v }]);
  if (isPlainObject(v)) { const l = rcLayer(v); return l.ok ? ok([{ kind: 'layer', layer: l.value }]) : l; }
  if (Array.isArray(v)) {
    const out: StyleSpec[] = [];
    const a: readonly unknown[] = v;
    for (const s of a) { const r = parseStyles(s); if (!r.ok) return r; out.push(...r.value); }
    return ok(out);
  }
  return err(`style must be a name, .mplstyle text, an rc object, or a list of those`);
}

const NO_OVERRIDES: GridSpec['overrides'] = { left: none, bottom: none, right: none, top: none, wspace: none, hspace: none };
const sameCell = (a: SubplotSpec, b: SubplotSpec): boolean =>
  a.grid === b.grid && a.rows[0] === b.rows[0] && a.rows[1] === b.rows[1] && a.cols[0] === b.cols[0] && a.cols[1] === b.cols[1];

/** sharex / sharey after GridSpec.subplots maps a bool to 'all' or 'none'. */
type Share = 'none' | 'all' | 'row' | 'col';
const parseShare = (what: string) => (v: unknown): Result<Share> => {
  if (v === true) return ok('all');
  if (v === false) return ok('none');
  return v === 'none' || v === 'all' || v === 'row' || v === 'col' ? ok(v) : err(`${what} must be a bool or one of 'none', 'all', 'row', 'col', got ${JSON.stringify(v)}`);
};
const positiveInt = (what: string, v: unknown): number => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  throw new TypeError(`${what} must be a positive integer, got ${JSON.stringify(v)}`);
};
const ratios = (name: string, n: number) => (v: unknown): Result<readonly number[]> => {
  const a: readonly unknown[] = Array.isArray(v) ? v : [];
  return a.length === n && a.every((x) => typeof x === 'number' && x > 0)
    ? ok(a.map(Number)) : err(`${name} must be ${n} positive numbers, got ${JSON.stringify(v)}`);
};
const ones = (n: number): readonly number[] => Array.from({ length: n }, () => 1);
const zeros = (n: number): number[] => Array.from({ length: n }, () => 0);
const maxOf = (xs: readonly number[]): number => Math.max(...xs);
/** GridSpec(nrows, ncols, **gridspec_kw): left/bottom/right/top/wspace/hspace and width/height_ratios. */
function parseGridSpec(nrowsRaw: unknown, ncolsRaw: unknown, kwargs: Kwargs): GridSpec {
  const nrows = positiveInt('nrows', nrowsRaw), ncols = positiveInt('ncols', ncolsRaw);
  const kw = new KwReader(kwargs, 'GridSpec');
  const opt = (name: string): Option<number> => kw.read([name], (v) => (num(name)(v).ok ? ok(some(Number(v))) : err(`${name} must be a number`)), (): Option<number> => none);
  const overrides = { left: opt('left'), bottom: opt('bottom'), right: opt('right'), top: opt('top'), wspace: opt('wspace'), hspace: opt('hspace') };
  const widthRatios = kw.read(['width_ratios'], ratios('width_ratios', ncols), () => ones(ncols));
  const heightRatios = kw.read(['height_ratios'], ratios('height_ratios', nrows), () => ones(nrows));
  kw.done();
  return { nrows, ncols, widthRatios, heightRatios, overrides };
}

export class Figure {
  readonly theme: Theme;
  readonly widthIn: number;
  readonly heightIn: number;
  readonly dpi: number;
  readonly axes: Axes[] = [];
  meta: readonly AxesMeta[] = [];
  /** Figure.subplotpars: figure.subplot.* until subplots_adjust or tight_layout changes them */
  subplotpars: SubplotParams;
  private _figText: { readonly x: number; readonly y: number; readonly text: string; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }[] = [];
  private _suptitle: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }> = none;
  private _supx: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }> = none;
  private _supy: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }> = none;

  /** new Figure({ style, rc, figsize, dpi }) */
  constructor(kwargs: Kwargs = {}) {
    const kw = new KwReader(kwargs, 'Figure');
    const styles = kw.read(['style'], parseStyles, (): readonly StyleSpec[] => []);
    const rc = kw.read(['rc'], (v) => (isPlainObject(v) ? rcLayer(v) : err('rc must be an object')), (): RcLayer => new Map());
    for (const k of rc.keys()) if (!DEFAULTS.has(k)) throw new TypeError(`unknown rc key '${k}'`);
    this.theme = unwrap(parseTheme(unwrap(composeStyles([...styles, { kind: 'layer', layer: rc }]))));
    const size = kw.read(['figsize'], (v): Result<readonly [number, number]> => {
      const a: readonly unknown[] = Array.isArray(v) ? v : [];
      return a.length === 2 && a.every((x) => typeof x === 'number' && x > 0) ? ok([Number(a[0]), Number(a[1])]) : err('figsize must be [width, height] in inches');
    }, () => [this.theme.figure.widthIn, this.theme.figure.heightIn] as const);
    this.widthIn = size[0]; this.heightIn = size[1];
    this.dpi = kw.read(['dpi'], positive('dpi'), () => this.theme.figure.dpi);
    kw.done();
    const [left, bottom, right, top] = this.theme.figure.subplot;
    this.subplotpars = { left, bottom, right, top, ...this.theme.figure.spacing };
  }
  /** add_subplot() — one Axes filling a 1x1 GridSpec, placed by the subplot parameters. */
  add_subplot(): Axes {
    const grid: GridSpec = { nrows: 1, ncols: 1, widthRatios: [1], heightRatios: [1], overrides: NO_OVERRIDES };
    return this.addCell({ grid, rows: [0, 1], cols: [0, 1] }, none, none);
  }
  private addCell(cell: SubplotSpec, sharex: Option<Axes>, sharey: Option<Axes>): Axes {
    const ax = new Axes(this, { kind: 'primary' }, cell, sharex.kind === 'some' ? sharex.value.xaxis : new Axis(), sharey.kind === 'some' ? sharey.value.yaxis : new Axis());
    this.axes.push(ax);
    this.touch();
    return ax;
  }
  /**
   * Figure.subplots / GridSpec.subplots: an nrows x ncols grid of Axes, row-major. sharex/sharey join
   * Axes to [0][0] ('all' or true), their row's first ('row') or their column's first ('col'); a
   * shared grid ('col'/'all' for x, 'row'/'all' for y) keeps tick labels on the outer Axes only.
   * Returns every Axes as rows; subplots() applies squeeze.
   */
  subplots(nrows: number, ncols: number, kwargs: Kwargs = {}): readonly (readonly Axes[])[] {
    const kw = new KwReader(kwargs, 'Figure.subplots');
    const sharex = kw.read(['sharex'], parseShare('sharex'), (): Share => 'none');
    const sharey = kw.read(['sharey'], parseShare('sharey'), (): Share => 'none');
    const gkw = kw.read(['gridspec_kw'], (v): Result<Kwargs> => (isPlainObject(v) ? ok(v) : err('gridspec_kw must be an object')), (): Kwargs => ({}));
    kw.done();
    const grid = parseGridSpec(nrows, ncols, gkw);
    const rows: Axes[][] = [];
    for (let r = 0; r < grid.nrows; r++) {
      const row: Axes[] = [];
      for (let c = 0; c < grid.ncols; c++) {
        const leader = (s: Share): Option<Axes> => {
          switch (s) {
            case 'none': return none;
            case 'all': return r === 0 && c === 0 ? none : some(rows.length > 0 ? rows[0][0] : row[0]);
            case 'row': return c === 0 ? none : some(row[0]);
            case 'col': return r === 0 ? none : some(rows[0][c]);
            default: return assertNever(s);
          }
        };
        row.push(this.addCell({ grid, rows: [r, r + 1], cols: [c, c + 1] }, leader(sharex), leader(sharey)));
      }
      rows.push(row);
    }
    if (sharex === 'col' || sharex === 'all') for (const ax of rows.flat()) ax.labelOuter('x');
    if (sharey === 'row' || sharey === 'all') for (const ax of rows.flat()) ax.labelOuter('y');
    return rows;
  }
  private spec(): FigureSpec {
    return {
      widthIn: this.widthIn, heightIn: this.heightIn, dpi: this.dpi, theme: this.theme, axes: this.axes.map((a) => a.spec()),
      figText: this._figText, suptitle: this._suptitle, supx: this._supx, supy: this._supy,
    };
  }
  // Layout cache: compute once per figure state; invalidated by any spec change.
  // The cache key is the JSON of FigureSpec: pure and deterministic.
  private _layoutCache: Option<{ readonly key: string; readonly scene: Scene; readonly meta: readonly AxesMeta[] }> = none;
  private touch(): void { this._layoutCache = none; }
  /** Figure-level text in figure coordinates (0..1). */
  text(x: unknown, y: unknown, s: unknown, kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.text');
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.font.sizePt);
    const ha = kw.read(['ha', 'horizontalalignment'], parseHAlign, () => unwrap(parseHAlign('left')));
    const va = kw.read(['va', 'verticalalignment'], parseVAlign, () => unwrap(parseVAlign('baseline')));
    kw.done();
    const fx = unwrap(num('x')(x)), fy = unwrap(num('y')(y));
    this._figText = [...this._figText, { x: fx, y: fy, text: str(s), ha, va, sizePt, weight: this.theme.font.weight, color }];
    this.touch(); return this;
  }
  /** suptitle(s, { color|c, fontsize|size, fontweight|weight }) — centred figure title (figure.titlesize/titleweight). */
  suptitle(s: unknown, kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.suptitle');
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.figure.titleSizePt);
    const weight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.figure.titleWeight);
    kw.done();
    // Matplotlib default: layout-free placement near the top, aligned to the top.
    this._suptitle = some({ text: str(s), x: 0.5, y: 0.98, ha: 'center', va: 'top', sizePt, weight, color });
    this.touch(); return this;
  }
  /** supxlabel(s, { color|c, fontsize|size, fontweight|weight }) — figure-level x label at the bottom. */
  supxlabel(s: unknown, kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.supxlabel');
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.figure.labelSizePt);
    const weight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.figure.labelWeight);
    kw.done();
    // Matplotlib default: bottom of the figure area.
    this._supx = some({ text: str(s), x: 0.5, y: 0.01, ha: 'center', va: 'bottom', sizePt, weight, color });
    this.touch(); return this;
  }
  /** supylabel(s, { color|c, fontsize|size, fontweight|weight }) — figure-level y label at the left, rotated. */
  supylabel(s: unknown, kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.supylabel');
    const color = kw.read(['color', 'c'], (v) => parseRgb(v, this.theme.axes.cycle), () => this.theme.text.color);
    const sizePt = kw.read(['fontsize', 'size'], (v) => parseFontSize(v, this.theme.font.sizePt), () => this.theme.figure.labelSizePt);
    const weight = kw.read(['fontweight', 'weight'], weightOf, () => this.theme.figure.labelWeight);
    kw.done();
    // Matplotlib default: left of the figure area, rotated like a ylabel.
    this._supy = some({ text: str(s), x: 0.02, y: 0.5, ha: 'left', va: 'center', sizePt, weight, color });
    this.touch(); return this;
  }
  /**
   * subplots_adjust({ left, bottom, right, top, wspace, hspace }) — SubplotParams.update: unset values are
   * kept; every Axes moves to its SubplotSpec's new position (a gridspec_kw value still wins for its grid).
   */
  subplots_adjust(kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.subplots_adjust');
    const p = this.subplotpars;
    const next: SubplotParams = {
      left: kw.read(['left'], num('left'), () => p.left), bottom: kw.read(['bottom'], num('bottom'), () => p.bottom),
      right: kw.read(['right'], num('right'), () => p.right), top: kw.read(['top'], num('top'), () => p.top),
      wspace: kw.read(['wspace'], num('wspace'), () => p.wspace), hspace: kw.read(['hspace'], num('hspace'), () => p.hspace),
    };
    kw.done();
    const bad = validParams(next);
    if (bad.kind === 'some') throw new RangeError(`subplots_adjust: ${bad.value}`);
    this.subplotpars = next;
    this.touch(); return this;
  }
  /** tight_layout({ pad = 1.08, h_pad, w_pad, rect }) — _tight_layout.get_tight_layout_figure: lay out now,
   *  measure each subplot cell's tight bbox (an Axes and its twins), then subplots_adjust margins and
   *  wspace/hspace so the decorations fit with `pad` (h_pad/w_pad between cells) font sizes to spare.
   *  As in matplotlib it runs once, at call time: call it after the plot is complete. */
  tight_layout(kwargs: Kwargs = {}): this {
    const kw = new KwReader(kwargs, 'Figure.tight_layout');
    const pad = kw.read(['pad'], num('pad'), () => 1.08);
    // h_pad / w_pad: the gap between cells, in font sizes (default: pad)
    const hPad = kw.read(['h_pad'], (v) => (num('h_pad')(v).ok ? ok(some(Number(v))) : err('h_pad must be a number')), (): Option<number> => none);
    const wPad = kw.read(['w_pad'], (v) => (num('w_pad')(v).ok ? ok(some(Number(v))) : err('w_pad must be a number')), (): Option<number> => none);
    const rect = kw.read(['rect'], (v): Result<Option<readonly [number, number, number, number]>> => {
      const a: readonly unknown[] = Array.isArray(v) ? v : [];
      return a.length === 4 && a.every((x) => typeof x === 'number') ? ok(some([Number(a[0]), Number(a[1]), Number(a[2]), Number(a[3])])) : err('rect must be [left, bottom, right, top] in figure fractions');
    }, (): Option<readonly [number, number, number, number]> => none);
    kw.done();
    if (this.axes.length === 0) return this;
    const pads = { pad, h: hPad, w: wPad };
    const first = this.autoAdjust(pads, none);
    if (first.kind !== 'some') return this;
    // get_tight_layout_figure: a rect shifts by the first pass's margins, then lays out again
    const f = first.value;
    const out = rect.kind === 'some'
      ? this.autoAdjust(pads, some([rect.value[0] + f.left, rect.value[1] + f.bottom, rect.value[2] - (1 - f.right), rect.value[3] - (1 - f.top)]))
      : first;
    if (out.kind === 'some') {
      const o = out.value;
      this.subplots_adjust({ left: o.left, bottom: o.bottom, right: o.right, top: o.top,
                             ...(o.wspace.kind === 'some' ? { wspace: o.wspace.value } : {}), ...(o.hspace.kind === 'some' ? { hspace: o.hspace.value } : {}) });
    }
    return this;
  }
  /**
   * _tight_layout._auto_adjust_subplotpars over the figure's SubplotSpecs (twins join their host's cell):
   * each cell's tight bbox overhang is added into the gutter rows/columns it borders, the outer gutters
   * become margins (plus the suptitle and supx/supylabel), the inner ones wspace/hspace.
   */
  private autoAdjust(pads: { readonly pad: number; readonly h: Option<number>; readonly w: Option<number> }, rect: Option<readonly [number, number, number, number]>):
      Option<{ readonly left: number; readonly bottom: number; readonly right: number; readonly top: number; readonly wspace: Option<number>; readonly hspace: Option<number> }> {
    this.toScene();
    const W = this.widthIn * this.dpi, H = this.heightIn * this.dpi;
    // ss_to_subplots: one entry per distinct SubplotSpec, in first-seen order
    const cells: { readonly cell: SubplotSpec; readonly members: number[] }[] = [];
    this.axes.forEach((ax, i) => {
      const found = cells.find((c) => sameCell(c.cell, ax.cell));
      if (found) found.members.push(i); else cells.push({ cell: ax.cell, members: [i] });
    });
    const maxRows = Math.max(...cells.map((c) => c.cell.grid.nrows)), maxCols = Math.max(...cells.map((c) => c.cell.grid.ncols));
    if (cells.some((c) => maxRows % c.cell.grid.nrows !== 0 || maxCols % c.cell.grid.ncols !== 0)) {
      console.warn('UserWarning: tight_layout not applied: number of rows/columns in subplot specifications must be multiples of one another.');
      return none;
    }
    const fontIn = this.theme.font.sizePt / 72;
    const padIn = pads.pad * fontIn;
    const vpadIn = pads.h.kind === 'some' ? pads.h.value * fontIn : padIn;
    const hpadIn = pads.w.kind === 'some' ? pads.w.value * fontIn : padIn;
    const vspaces = Array.from({ length: maxRows + 1 }, () => zeros(maxCols));
    const hspaces = Array.from({ length: maxRows }, () => zeros(maxCols + 1));
    for (const { cell, members } of cells) {
      const [l0, b0, r0, t0] = cellPosition(cell, this.subplotpars);
      const t = unionBox(members.map((i) => this.meta[i].tight));
      const tight = { xmin: t.x0 / W, xmax: t.x1 / W, ymin: 1 - t.y1 / H, ymax: 1 - t.y0 / H };
      const dr = maxRows / cell.grid.nrows, dc = maxCols / cell.grid.ncols;
      const rs = [cell.rows[0] * dr, cell.rows[1] * dr], cs = [cell.cols[0] * dc, cell.cols[1] * dc];
      for (let r = rs[0]; r < rs[1]; r++) { hspaces[r][cs[0]] += l0 - tight.xmin; hspaces[r][cs[1]] += tight.xmax - r0; }
      for (let c = cs[0]; c < cs[1]; c++) { vspaces[rs[0]][c] += tight.ymax - t0; vspaces[rs[1]][c] += b0 - tight.ymin; }
    }
    const padW = padIn / this.widthIn, padH = padIn / this.heightIn;
    const sup = supBoxes(this.spec());
    const relW = (o: Option<{ readonly x0: number; readonly x1: number }>): number => (o.kind === 'some' ? (o.value.x1 - o.value.x0) / W + padW : 0);
    const relH = (o: Option<{ readonly y0: number; readonly y1: number }>): number => (o.kind === 'some' ? (o.value.y1 - o.value.y0) / H + padH : 0);
    // a rect side of 0 (or none) is "not given", as `if not margin_left` reads it
    const given = (i: 0 | 1 | 2 | 3): Option<number> => (rect.kind === 'some' && rect.value[i] !== 0 ? some(rect.value[i]) : none);
    const gl = given(0), gb = given(1), gr = given(2), gt = given(3);
    const left = gl.kind === 'some' ? gl.value : Math.max(maxOf(hspaces.map((row) => row[0])), 0) + padW + relW(sup.y);
    const right = gr.kind === 'some' ? 1 - gr.value : Math.max(maxOf(hspaces.map((row) => row[maxCols])), 0) + padW;
    const top = gt.kind === 'some' ? 1 - gt.value : Math.max(maxOf(vspaces[0]), 0) + padH + relH(sup.title);
    const bottom = gb.kind === 'some' ? gb.value : Math.max(maxOf(vspaces[maxRows]), 0) + padH + relH(sup.x);
    if (left + right >= 1) { console.warn('UserWarning: Tight layout not applied. The left and right margins cannot be made large enough to accommodate all Axes decorations.'); return none; }
    if (bottom + top >= 1) { console.warn('UserWarning: Tight layout not applied. The bottom and top margins cannot be made large enough to accommodate all Axes decorations.'); return none; }
    let wspace: Option<number> = none, hspace: Option<number> = none;
    if (maxCols > 1) {
      const hs = maxOf(hspaces.flatMap((row) => row.slice(1, -1))) + hpadIn / this.widthIn;
      const hAxes = (1 - right - left - hs * (maxCols - 1)) / maxCols;
      if (hAxes < 0) { console.warn('UserWarning: Tight layout not applied. tight_layout cannot make Axes width small enough to accommodate all Axes decorations'); return none; }
      wspace = some(hs / hAxes);
    }
    if (maxRows > 1) {
      const vs = maxOf(vspaces.slice(1, -1).flat()) + vpadIn / this.heightIn;
      const vAxes = (1 - top - bottom - vs * (maxRows - 1)) / maxRows;
      if (vAxes < 0) { console.warn('UserWarning: Tight layout not applied. tight_layout cannot make Axes height small enough to accommodate all Axes decorations.'); return none; }
      hspace = some(vs / vAxes);
    }
    return some({ left, bottom, right: 1 - right, top: 1 - top, wspace, hspace });
  }
  /** Run layout; one trace per run. */
  toScene(): Scene {
    // Cache by FigureSpec JSON — pure and deterministic; stable ordering by construction.
    const spec = this.spec();
    const key = JSON.stringify(spec);
    if (this._layoutCache.kind === 'some' && this._layoutCache.value.key === key) {
      // Keep meta in sync with the last produced layout
      this.meta = this._layoutCache.value.meta;
      return this._layoutCache.value.scene;
    }
    const root = tracer.startTrace('figure.layout', { axes: this.axes.length, dpi: this.dpi });
    try {
      const { scene, meta } = layoutFigure(spec, tracer);
      this.meta = meta;
      root.setAttribute('nodes', scene.nodes.length);
      this._layoutCache = some({ key, scene, meta });
      return scene;
    } catch (e) { root.recordException(e); throw e; } finally { root.end(); }
  }
  /** The figure as an SVG document string, as matplotlib's SVG backend writes it. */
  toSVG(): string {
    const scene = this.toScene();
    return tracer.span('render.svg', { topNodes: scene.nodes.length }, (sp) => {
      const out = iolistToString(svgIO(scene, tracer, this.theme.svgText));
      sp.setAttribute('bytes', out.length).setAttribute('leaves', scene.nodes.reduce((a, n) => a + leafCount(n), 0));
      return out;
    });
  }
  /** The SVG as a generator of string chunks. */
  svgChunks(): Generator<string> { return svgChunks(this.toScene(), tracer); }
  /** The SVG as a byte stream (Workers, browsers, Node). */
  svgStream(): ReadableStream<Uint8Array> { return svgStream(this.toScene(), tracer); }

  /** RGBA8 pixels (straight alpha), rasterized like matplotlib's Agg backend. */
  toRGBA(): Canvas { const scene = this.toScene(); return tracer.span('render.raster', { w: scene.width, h: scene.height }, () => renderRGBA(scene, tracer)); }
  /** PNG bytes via the platform's CompressionStream (Workers, browsers, Node ≥ 18). */
  toPNG(): Promise<Uint8Array> { return encodePNG(this.toRGBA()); }
  /** PNG bytes, synchronously, with the built-in deflate. */
  toPNGSync(): Uint8Array {
    const scene = this.toScene();
    const c = tracer.span('render.raster', { w: scene.width, h: scene.height }, () => renderScratch(scene, tracer));
    return tracer.span('png.encode', { w: c.w, h: c.h }, (sp) => { const b = encodePNGSync(c); sp.setAttribute('bytes', b.length); return b; });
  }
  /** PNG as a byte stream: IHDR first, IDAT chunks as the compressor yields them. */
  pngStream(): ReadableStream<Uint8Array> { return pngStream(this.toRGBA()); }
}

/** A major tick label (Tick.label1): its text, and the Text setters mpljs supports. */
export type TickLabelText = {
  readonly get_text: () => string;
  readonly set_fontweight: (w: unknown) => void;
  readonly set_color: (c: unknown) => void;
  readonly set_fontsize: (s: unknown) => void;
  readonly set: (kwargs: Kwargs) => void;
};
export type TransformRef = { readonly kind: 'transform'; readonly coords: TextCoords };
const parseCoords = (o: Option<unknown>): Result<TextCoords> => (o.kind === 'some' && (o.value === 'data' || o.value === 'axes') ? ok(o.value) : err('unknown transform'));
const weightOf = (v: unknown): Result<number> => (typeof v === 'number' || typeof v === 'string' ? ok(parseWeight(v)) : err('fontweight must be a number or a weight name'));
/** 'data' | '<figure|axes|offset> <points|pixels|fontsize|fraction>'; 'offset …' only for textcoords. */
function parseAnnotationCoords(v: unknown, what: 'xycoords' | 'textcoords'): Result<AnnotationCoords> {
  if (v === 'data') return ok({ kind: 'data' });
  const parts = typeof v === 'string' ? v.split(' ') : [];
  const [ref, unit] = parts;
  const refOk = ref === 'figure' || ref === 'axes' || (ref === 'offset' && what === 'textcoords');
  const unitOk = unit === 'points' || unit === 'pixels' || unit === 'fontsize' || (unit === 'fraction' && ref !== 'offset');
  return parts.length === 2 && refOk && unitOk
    ? ok({ kind: 'relative', ref, unit })
    : err(`${what} must be 'data' or '<figure|axes${what === 'textcoords' ? '|offset' : ''}> <points|pixels|fontsize|fraction>', got ${JSON.stringify(v)}`);
}
const parseHAlign = (v: unknown): Result<HAlign> => (v === 'left' || v === 'center' || v === 'right' ? ok(v) : err(`ha must be 'left', 'center' or 'right'`));
const parseVAlign = (v: unknown): Result<VAlign> => (v === 'top' || v === 'bottom' || v === 'center' || v === 'baseline' || v === 'center_baseline' ? ok(v) : err(`va must be one of top, bottom, center, baseline, center_baseline`));
const unitInterval = (name: string) => (v: unknown): Result<number> => (typeof v === 'number' && v >= 0 && v <= 1 ? ok(v) : err(`${name} must be a number in [0, 1]`));

/** Keyword arguments of subplots(): the Figure's, the grid's, and squeeze (each may be left out). */
export type SubplotsKwargs = Kwargs & Partial<{
  readonly style: unknown; readonly rc: Readonly<Record<string, unknown>>; readonly figsize: readonly [number, number]; readonly dpi: number;
  readonly sharex: boolean | Share; readonly sharey: boolean | Share; readonly squeeze: boolean;
  readonly gridspec_kw: Partial<{
    readonly left: number; readonly bottom: number; readonly right: number; readonly top: number;
    readonly wspace: number; readonly hspace: number; readonly width_ratios: readonly number[]; readonly height_ratios: readonly number[];
  }>;
}>;
/** A row-major grid of Axes: grid[row][col]. */
export type AxesGrid2D = readonly (readonly Axes[])[];
/** What subplots() can return when the shape is only known at run time. */
export type SubplotsAxes = Axes | readonly Axes[] | AxesGrid2D;
/**
 * The axes value subplots(nrows, ncols, { squeeze }) returns, from the literal types of its arguments:
 * squeeze=false: always rows of Axes; 1x1: one Axes; one row or column: a flat array; otherwise rows.
 * With non-literal sizes the shape is decided at run time, so it is the union.
 */
export type SubplotsResult<R extends number, C extends number, S extends boolean> =
  [S] extends [false] ? AxesGrid2D
  : number extends R ? SubplotsAxes : number extends C ? SubplotsAxes
  : [R] extends [1] ? ([C] extends [1] ? Axes : readonly Axes[])
  : [C] extends [1] ? readonly Axes[] : AxesGrid2D;

/** subplots() / subplots({ style, rc, figsize, dpi }) -> [fig, ax] */
export function subplots(): readonly [Figure, Axes];
export function subplots(kwargs: SubplotsKwargs): readonly [Figure, Axes];
/** subplots(nrows) -> [fig, axes]: a column of nrows Axes (one Axes when nrows is 1) */
export function subplots<R extends number>(nrows: R): readonly [Figure, SubplotsResult<R, 1, true>];
/** subplots(nrows, ncols) -> [fig, axes], squeezed as matplotlib does (SubplotsResult) */
export function subplots<R extends number, C extends number>(nrows: R, ncols: C): readonly [Figure, SubplotsResult<R, C, true>];
/** subplots(nrows, ncols, { sharex, sharey, squeeze = true, gridspec_kw, style, rc, figsize, dpi }) -> [fig, axes] */
export function subplots<R extends number, C extends number, S extends boolean = true>(
  nrows: R, ncols: C, kwargs: SubplotsKwargs & Partial<{ readonly squeeze: S }>): readonly [Figure, SubplotsResult<R, C, S>];
export function subplots(...args: readonly unknown[]): readonly [Figure, SubplotsAxes] {
  const [a, b, c] = args;
  if (args.length === 0 || isPlainObject(a)) {
    const fig = new Figure(isPlainObject(a) ? a : {});
    return [fig, fig.add_subplot()];
  }
  const kwargs: Kwargs = isPlainObject(c) ? c : {};
  const figKeys = new Set(['style', 'rc', 'figsize', 'dpi']);
  const pickKw = (f: (k: string) => boolean): Kwargs => Object.fromEntries(Object.entries(kwargs).filter(([k]) => f(k)));
  const squeezeRaw = prop(kwargs, 'squeeze');
  const squeeze = squeezeRaw.kind === 'some' && !isNullish(squeezeRaw.value) ? unwrap(bool('squeeze')(squeezeRaw.value)) : true;
  const fig = new Figure(pickKw((k) => figKeys.has(k)));
  const rows = fig.subplots(positiveInt('nrows', a), args.length < 2 ? 1 : positiveInt('ncols', b), pickKw((k) => !figKeys.has(k) && k !== 'squeeze'));
  if (!squeeze) return [fig, rows];
  // np.squeeze: drop the length-1 dimensions; a single Axes is returned as itself
  if (rows.length === 1 && rows[0].length === 1) return [fig, rows[0][0]];
  if (rows.length === 1) return [fig, rows[0]];
  if (rows[0].length === 1) return [fig, rows.map((r) => r[0])];
  return [fig, rows];
}
