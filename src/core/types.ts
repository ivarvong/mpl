// The domain model. Every composite type is a product of small unions whose
// state count equals the number of meaningful states — no sentinel strings
// ('None'), no optional fields, no `undefined`. Absence is a variant.
//
// Design check (naive product -> meaningful):
//   AxisSpec   numeric(2 scales × 2 × 2) + category(2 × 2) + datetime(2 × 2) = 16 of 16
//   Ink        fill | stroke | fillStroke                                = 3 of 3   (invisible is not a node)
//   Placement  horizontal(3 ha × 5 va) + ylabel + ylabelRight            = 17 of 17
//   LineArtist stroke(none|on) × markers(none|on) × label(none|text)     = 8 of 8   (none×none still autoscales)
//   LegendLoc  best | anchored(1..10)                                    = 11 of 11
//   Limits     auto | fixed(lo, hi)                                      = 2 of 2

// ---------------------------------------------------------------- algebra
export type Option<T> = { readonly kind: 'none' } | { readonly kind: 'some'; readonly value: T };
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

export const none: { readonly kind: 'none' } = { kind: 'none' };
export const some = <T>(value: T): Option<T> => ({ kind: 'some', value });
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const err = <T>(error: string): Result<T> => ({ ok: false, error });

/** The imperative shell's boundary: a Result becomes a value or an exception. */
export const unwrap = <T>(r: Result<T>): T => {
  if (r.ok) return r.value;
  throw new Error(r.error);
};

/** Exhaustiveness: unreachable when a switch handles every variant. */
export function assertNever(x: never): never {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
}

// ---------------------------------------------------------------- color & ink
/** A parsed color. alpha ∈ [0, 1]. */
export type Rgb = { readonly hex: string; readonly alpha: number };
/** A color slot that may be empty ('none' in matplotlib). */
export type Paint = { readonly kind: 'none' } | { readonly kind: 'solid'; readonly color: Rgb };

export type Cap = 'butt' | 'round' | 'square';
export type Join = 'miter' | 'round' | 'bevel';
/** Dash pattern in device px. */
export type Dash = { readonly kind: 'solid' } | { readonly kind: 'dashed'; readonly pattern: readonly number[]; readonly offset: number };
/** A visible stroke: width > 0 px. */
export type Stroke = { readonly color: Rgb; readonly width: number; readonly cap: Cap; readonly join: Join; readonly dash: Dash };
/** What a closed shape draws. The fourth state (neither) is not a node at all. */
export type Ink =
  | { readonly kind: 'fill'; readonly fill: Rgb }
  | { readonly kind: 'stroke'; readonly stroke: Stroke }
  | { readonly kind: 'fillStroke'; readonly fill: Rgb; readonly stroke: Stroke };

// ---------------------------------------------------------------- scene
export type Seg =
  | readonly ['M', number, number]
  | readonly ['L', number, number]
  | readonly ['Q', number, number, number, number]
  | readonly ['C', number, number, number, number, number, number]
  | readonly ['Z'];
export type Rotation = 'horizontal' | 'vertical';
/** A positioned glyph: a font glyph key (character or ligature) and its offset along the baseline in px. */
export type Glyph = { readonly gid: number; readonly dx: number };
export type Clip = { readonly kind: 'none' } | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number };

/** Renderer-independent output of layout, in device px, top-left origin, Agg snapping applied. */
export type Node =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly ink: Ink }
  | { readonly kind: 'path'; readonly segs: readonly Seg[]; readonly ink: Ink }
  | { readonly kind: 'polyline'; readonly xs: Float64Array; readonly ys: Float64Array; readonly stroke: Stroke }
  | { readonly kind: 'markers'; readonly shape: readonly Seg[]; readonly xs: Float64Array; readonly ys: Float64Array; readonly ink: Ink }
  | { readonly kind: 'text'; readonly text: string; readonly x: number; readonly y: number; readonly sizePx: number; readonly sizePt: number;
      readonly glyphs: readonly Glyph[]; readonly face: string; readonly color: Rgb; readonly rotation: Rotation }
  /** tag: provenance ('artist/<index>/<kind>' for an Axes artist's marks, '' otherwise) for interactive renderers */
  | { readonly kind: 'group'; readonly clip: Clip; readonly nodes: readonly Node[]; readonly tag: string };

/** dpi is carried for renderers that size fonts like FreeType (points × dpi, in 26.6). */
export type Scene = { readonly width: number; readonly height: number; readonly dpi: number; readonly background: Paint; readonly nodes: readonly Node[] };

// ---------------------------------------------------------------- tick labels
/**
 * What a tick label says. 'power' is matplotlib's mathtext `$\mathdefault{[c\times]b^{e}}$`
 * (LogFormatterSciNotation); it is laid out by the mathtext model in text.ts.
 */
export type TickLabel =
  | { readonly kind: 'plain'; readonly text: string }
  | { readonly kind: 'power'; readonly coeff: Option<string>; readonly base: string; readonly exponent: number };

// ---------------------------------------------------------------- text placement
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'bottom' | 'center' | 'baseline' | 'center_baseline';
/** Rotated text is only ever the y label (rotation=90, ha=center, va=bottom). */
export type Placement =
  | { readonly kind: 'horizontal'; readonly ha: HAlign; readonly va: VAlign }
  | { readonly kind: 'ylabel' }          // left y label: rotation 90, va bottom
  | { readonly kind: 'ylabelRight' };    // right y label (twinx): rotation 90, va top

// ---------------------------------------------------------------- artists
export type MarkerName = 'o' | 's' | '^' | 'v' | '<' | '>' | 'D' | 'd' | 'x' | '+' | '*' | '.' | 'p' | 'h' | 'X' | 'P';
export type LineStyleName = 'solid' | 'dashed' | 'dashdot' | 'dotted';
export type Label = { readonly kind: 'none' } | { readonly kind: 'text'; readonly text: string };

export type LineStroke = { readonly kind: 'none' } | { readonly kind: 'on'; readonly color: Rgb; readonly widthPt: number; readonly style: LineStyleName };
export type LineMarkers =
  | { readonly kind: 'none' }
  | { readonly kind: 'on'; readonly shape: MarkerName; readonly sizePt: number; readonly edgeWidthPt: number; readonly face: Paint; readonly edge: Paint };
export type BarEdge = { readonly kind: 'none' } | { readonly kind: 'on'; readonly color: Rgb; readonly widthPt: number };
export type Orientation = 'vertical' | 'horizontal';

export type LineArtist = {
  readonly kind: 'line'; readonly x: Float64Array; readonly y: Float64Array;
  readonly stroke: LineStroke; readonly markers: LineMarkers; readonly label: Label;
  readonly clip: boolean;
};
/** Rects in data coords; (x, y) is the corner at the base. The base axis is y for vertical bars (sticky edges). */
export type BarArtist = {
  readonly kind: 'bar'; readonly orientation: Orientation;
  readonly x: Float64Array; readonly y: Float64Array; readonly w: Float64Array; readonly h: Float64Array;
  /** face is the legend handle's (matplotlib uses the first patch); faces[i] paints bar i */
  readonly face: Paint; readonly faces: readonly Paint[]; readonly edge: BarEdge; readonly label: Label;
  readonly clip: boolean;
};
/** fill_between: the polygon start → (x, y1)… → end → (x, y2) reversed. `color=` paints the edge too (Collection.set_color). */
export type FillArtist = {
  readonly kind: 'fill'; readonly x: Float64Array; readonly y1: Float64Array; readonly y2: Float64Array;
  readonly face: Paint; readonly edge: BarEdge; readonly label: Label; readonly clip: boolean;
};
/** Where a text artist's (x, y) lives: data coordinates or axes fractions (transAxes). */
export type TextCoords = 'data' | 'axes';
export type TextArtist = {
  readonly kind: 'text'; readonly x: number; readonly y: number; readonly coords: TextCoords; readonly text: string;
  readonly sizePt: number; readonly weight: number; readonly color: Rgb; readonly ha: HAlign; readonly va: VAlign;
  readonly clip: boolean;
};
/** Scatter: a PathCollection of identical markers at (x, y), size in pt^2 (matplotlib semantics). */
export type ScatterArtist = {
  readonly kind: 'scatter'; readonly x: Float64Array; readonly y: Float64Array;
  readonly sizePt2: Float64Array; readonly shape: MarkerName;
  readonly face: Paint; readonly edge: Paint; readonly edgeWidthPt: number; readonly label: Label; readonly clip: boolean;
};
export type AnnotationCoords = 'data' | 'axes';
export type AnnotationArtist = {
  readonly kind: 'annotation';
  readonly x: number; readonly y: number; readonly xycoords: AnnotationCoords;
  readonly tx: number; readonly ty: number; readonly textcoords: AnnotationCoords;
  readonly text: string; readonly sizePt: number; readonly weight: number; readonly color: Rgb; readonly ha: HAlign; readonly va: VAlign;
  readonly arrow: { readonly color: Rgb; readonly widthPt: number; readonly headLengthPt: number; readonly headWidthPt: number };
  readonly clip: boolean;
};
/** axvspan/axhspan bands: oriented spans that may use axes-fraction extents on the non-data axis. */
export type SpanArtist = {
  readonly kind: 'span'; readonly orientation: Orientation;
  /** data coordinates on the data axis (x for vertical, y for horizontal) */
  readonly a0: number; readonly a1: number;
  /** [0,1] fractions on the other axis, in axes coordinates */
  readonly f0: number; readonly f1: number;
  readonly face: Paint; readonly edge: BarEdge; readonly label: Label; readonly clip: boolean;
};
export type Artist = LineArtist | BarArtist | FillArtist | TextArtist | ScatterArtist | AnnotationArtist | SpanArtist;

/** What a legend entry draws. */
export type Handle =
  | { readonly kind: 'line'; readonly stroke: LineStroke; readonly markers: LineMarkers }
  | { readonly kind: 'patch'; readonly face: Paint; readonly edge: BarEdge };
export type LegendEntry = { readonly label: string; readonly handle: Handle };

// ---------------------------------------------------------------- axes
export type Scale = { readonly kind: 'linear' } | { readonly kind: 'log'; readonly base: number };
export type Limits = { readonly kind: 'auto' } | { readonly kind: 'fixed'; readonly lo: number; readonly hi: number };
export type TickSpec = { readonly kind: 'auto' } | { readonly kind: 'fixed'; readonly locs: readonly number[] };
export type LabelSpec = { readonly kind: 'auto' } | { readonly kind: 'fixed'; readonly labels: readonly string[] };
/** 'auto' ticks/labels mean "what matplotlib's converter picks for this kind of axis". */
export type AxisSpec =
  | { readonly kind: 'numeric'; readonly scale: Scale; readonly limits: Limits; readonly ticks: TickSpec; readonly labels: LabelSpec }
  | { readonly kind: 'category'; readonly names: readonly string[]; readonly limits: Limits; readonly ticks: TickSpec; readonly labels: LabelSpec }
  /** values are matplotlib date numbers: days since 1970-01-01T00:00:00 UTC */
  | { readonly kind: 'datetime'; readonly limits: Limits; readonly ticks: TickSpec; readonly labels: LabelSpec };

export type GridWhich = 'x' | 'y' | 'both';
export type GridSpec = { readonly kind: 'off' } | { readonly kind: 'on'; readonly which: GridWhich };
export type AnchorCode = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type LegendLoc = { readonly kind: 'best' } | { readonly kind: 'anchored'; readonly code: AnchorCode };
export type LegendSpec =
  | { readonly kind: 'off' }
  | { readonly kind: 'on'; readonly loc: LegendLoc; readonly ncols: number; readonly frame: boolean; readonly fontSizePt: number };

/** A twinx Axes shares its host's x axis; its y axis, label and offset text live on the right. */
export type AxesRole = { readonly kind: 'primary' } | { readonly kind: 'twinx'; readonly host: number };

/** Fractions of the figure: left, bottom, right, top. */
export type Position = readonly [number, number, number, number];
export type AxesSpec = {
  readonly role: AxesRole; readonly position: Position; readonly artists: readonly Artist[];
  readonly title: string; readonly titleLoc: HAlign; readonly titleWeight: number; readonly xlabel: string; readonly ylabel: string;
  readonly x: AxisSpec; readonly y: AxisSpec; readonly grid: GridSpec; readonly legend: LegendSpec;
  readonly spines: {
    readonly left: { readonly visible: boolean; readonly color: Option<Rgb>; readonly widthPt: Option<number>; readonly position: Option<{ readonly kind: 'outward'; readonly pts: number }> };
    readonly right: { readonly visible: boolean; readonly color: Option<Rgb>; readonly widthPt: Option<number>; readonly position: Option<{ readonly kind: 'outward'; readonly pts: number }> };
    readonly top: { readonly visible: boolean; readonly color: Option<Rgb>; readonly widthPt: Option<number>; readonly position: Option<{ readonly kind: 'outward'; readonly pts: number }> };
    readonly bottom: { readonly visible: boolean; readonly color: Option<Rgb>; readonly widthPt: Option<number>; readonly position: Option<{ readonly kind: 'outward'; readonly pts: number }> };
  };
  readonly tick: { readonly x: TickTheme; readonly y: TickTheme };
};
export type FigureSpec = {
  readonly widthIn: number; readonly heightIn: number; readonly dpi: number; readonly theme: Theme; readonly axes: readonly AxesSpec[];
  readonly figText: readonly { readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }[];
  readonly suptitle: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }>;
  readonly supx: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }>;
  readonly supy: Option<{ readonly text: string; readonly x: number; readonly y: number; readonly ha: HAlign; readonly va: VAlign; readonly sizePt: number; readonly weight: number; readonly color: Rgb }>;
};

// ---------------------------------------------------------------- theme (parsed rcParams)
export type TickDirection = 'in' | 'out' | 'inout';
export type AxisBelow = 'below' | 'line' | 'above';
export type TickTheme = {
  readonly sizePt: number; readonly widthPt: number; readonly padPt: number; readonly labelSizePt: number;
  readonly minorSizePt: number; readonly minorWidthPt: number; readonly minorPadPt: number;
  readonly color: Rgb; readonly labelColor: Rgb; readonly direction: TickDirection;
  /** x: bottom/top, y: left/right */
  readonly near: boolean; readonly far: boolean; readonly labelNear: boolean;
};
export type Simplify = { readonly kind: 'off' } | { readonly kind: 'on'; readonly thresholdPx: number };

export type Theme = {
  readonly figure: { readonly widthIn: number; readonly heightIn: number; readonly dpi: number; readonly background: Paint; readonly subplot: Position };
  /** font.family resolved to faces by weight: body text, axes titles, axes labels */
  readonly font: { readonly families: readonly string[]; readonly sizePt: number; readonly weight: number; readonly titleWeight: number; readonly labelWeight: number };
  readonly text: { readonly color: Rgb };
  /** How SVG text is written: 'text' nodes or glyph 'path's (rc svg.fonttype: 'none' -> 'text', 'path' -> 'glyphs') */
  readonly svgText: 'text' | 'glyphs';
  readonly axes: {
    readonly face: Paint; readonly edge: Rgb; readonly linewidthPt: number;
    readonly spines: { readonly left: boolean; readonly bottom: boolean; readonly top: boolean; readonly right: boolean };
    readonly grid: GridSpec; readonly axisBelow: AxisBelow;
    readonly labelSizePt: number; readonly labelColor: Rgb; readonly labelPadPt: number;
    readonly titleSizePt: number; readonly titleColor: Rgb; readonly titlePadPt: number; readonly titleLoc: HAlign;
    readonly xmargin: number; readonly ymargin: number;
    readonly formatter: { readonly limits: readonly [number, number]; readonly offsetThreshold: number; readonly useOffset: boolean };
    readonly unicodeMinus: boolean;
    readonly cycle: readonly Rgb[];
  };
  readonly lines: {
    readonly widthPt: number; readonly style: Option<LineStyleName>; readonly marker: Option<MarkerName>;
    readonly markerSizePt: number; readonly markerEdgeWidthPt: number;
    /** lines.markeredgecolor / markerfacecolor; none = 'auto' (follow the line colour) */
    readonly markerEdge: Option<Paint>; readonly markerFace: Option<Paint>;
    readonly solidCap: Cap; readonly solidJoin: Join; readonly dashCap: Cap; readonly dashJoin: Join;
    readonly patterns: { readonly dashed: readonly number[]; readonly dashdot: readonly number[]; readonly dotted: readonly number[] };
    readonly scaleDashes: boolean;
  };
  readonly simplify: Simplify;
  readonly patch: { readonly linewidthPt: number; readonly edge: Rgb; readonly forceEdge: boolean };
  readonly grid: { readonly color: Rgb; readonly style: LineStyleName; readonly widthPt: number; readonly alpha: number };
  readonly xtick: TickTheme;
  readonly ytick: TickTheme;
  readonly legend: {
    readonly loc: LegendLoc; readonly frame: boolean; readonly frameAlpha: number; readonly face: Rgb; readonly edge: Rgb; readonly fancy: boolean;
    readonly fontSizePt: number; readonly labelColor: Rgb;
    readonly borderPad: number; readonly labelSpacing: number; readonly handleLength: number; readonly handleHeight: number;
    readonly handleTextPad: number; readonly borderAxesPad: number; readonly columnSpacing: number;
  };
  readonly offsetTextPadPt: number;
};

// ---------------------------------------------------------------- layout output
export type AxisMeta = {
  readonly lim: readonly [number, number]; readonly ticks: readonly number[]; readonly labels: readonly string[]; readonly offset: string;
  readonly minor: readonly number[]; readonly minorLabels: readonly string[];
};
export type LegendMeta = { readonly loc: number; readonly x0: number; readonly x1: number; readonly top: number; readonly bottom: number };
/** The data → device mapping layout used for this axes (see core/frame.ts): what an interactive layer inverts. */
export type FrameMeta = {
  readonly box: { readonly x0: number; readonly x1: number; readonly yTop: number; readonly yBot: number };
  readonly xlim: readonly [number, number]; readonly ylim: readonly [number, number];
  readonly xscale: Scale; readonly yscale: Scale; readonly H: number;
};
export type AxesMeta = { readonly x: AxisMeta; readonly y: AxisMeta; readonly legend: Option<LegendMeta>; readonly frame: FrameMeta };
