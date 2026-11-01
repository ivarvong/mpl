// Axis._update_ticks: major and minor tick locations, labels and offset text.
// 'auto' means "what matplotlib picks for this kind of axis and scale".
import { autoDateFormat, autoDateTicks } from './dates.ts';
import { logFormat, logTicks } from './log.ts';
import { forward } from './scale.ts';
import { autoTicks, scalarFormat } from './ticker.ts';
import type { AxisSpec, Scale, Theme, TickLabel } from './types.ts';
import { assertNever } from './types.ts';

/** `index` is the tick's place in its locator's list (Axis.get_major_ticks order), in view or not. */
export type Tick = { readonly loc: number; readonly label: TickLabel; readonly minor: boolean; readonly index: number };
export type TickSet = {
  readonly locs: readonly number[]; readonly labels: readonly TickLabel[]; readonly offset: string;
  readonly minor: readonly number[]; readonly minorLabels: readonly TickLabel[];
  /** major then minor, restricted to the view interval */
  readonly visible: readonly Tick[];
};

/** XAxis/YAxis.get_tick_space: how many labels fit (aspect heuristics 3:1 for x, 2:1 for y). */
export function tickSpace(axis: 'x' | 'y', lengthPx: number, dpi: number, labelSizePt: number): number {
  const lengthPt = lengthPx / dpi * 72;
  const size = labelSizePt * (axis === 'x' ? 3 : 2);
  return size > 0 ? Math.floor(lengthPt / size) : 2 ** 31 - 1;
}

export const scaleOf = (spec: AxisSpec): Scale => {
  switch (spec.kind) {
    case 'numeric': return spec.scale;
    case 'category': case 'datetime': return { kind: 'linear' };
    default: return assertNever(spec);
  }
};

type Locs = { readonly major: readonly number[]; readonly minor: readonly number[] };

function locations(spec: AxisSpec, lim: readonly [number, number], space: number, minpos: number): Locs {
  switch (spec.kind) {
    case 'numeric': {
      const s = spec.scale;
      switch (s.kind) {
        case 'linear':
          return { major: spec.ticks.kind === 'fixed' ? spec.ticks.locs : autoTicks(lim[0], lim[1], space), minor: [] };
        case 'log': {                                                           // LogLocator major + LogLocator(subs='auto') minor
          const major = spec.ticks.kind === 'fixed' ? spec.ticks.locs : logTicks(lim[0], lim[1], s.base, { kind: 'major' }, space, minpos);
          return { major, minor: logTicks(lim[0], lim[1], s.base, { kind: 'minorAuto' }, space, minpos) };
        }
        default: return assertNever(s);
      }
    }
    case 'category':
      return { major: spec.ticks.kind === 'fixed' ? spec.ticks.locs : spec.names.map((_, i) => i), minor: [] };   // StrCategoryLocator
    case 'datetime':                                                            // AutoDateLocator; no minor locator
      return { major: spec.ticks.kind === 'fixed' ? spec.ticks.locs : autoDateTicks(lim).locs, minor: [] };
    default: return assertNever(spec);
  }
}

type Formatted = { readonly labels: readonly TickLabel[]; readonly offset: string; readonly minor: readonly TickLabel[] };
const plain = (text: string): TickLabel => ({ kind: 'plain', text });

function format(spec: AxisSpec, l: Locs, lim: readonly [number, number], theme: Theme): Formatted {
  if (spec.labels.kind === 'fixed') {                                            // FixedFormatter (major only)
    const fixed = spec.labels.labels;
    return { labels: l.major.map((_, i) => plain(i < fixed.length ? fixed[i] : '')), offset: '', minor: l.minor.map(() => plain('')) };
  }
  switch (spec.kind) {
    case 'numeric': {
      const s = spec.scale;
      switch (s.kind) {
        case 'linear': {
          const f = theme.axes.formatter;                                        // ScalarFormatter
          const r = scalarFormat(l.major, lim, { useOffset: f.useOffset, offsetThreshold: f.offsetThreshold, powerlimits: f.limits, unicodeMinus: theme.axes.unicodeMinus });
          return { labels: r.labels.map(plain), offset: r.offset, minor: [] };
        }
        case 'log':                                                              // LogFormatterSciNotation for both
          return { labels: logFormat(l.major, lim, s.base), offset: '', minor: logFormat(l.minor, lim, s.base) };
        default: return assertNever(s);
      }
    }
    case 'category': {                                                           // StrCategoryFormatter
      const names = spec.names;
      return { labels: l.major.map((v) => plain(Number.isInteger(v) && v >= 0 && v < names.length ? names[v] : '')), offset: '', minor: [] };
    }
    case 'datetime':                                                            // AutoDateFormatter: format chosen by the locator's unit
      return { labels: autoDateFormat(l.major, autoDateTicks(lim).locator).map(plain), offset: '', minor: [] };
    default: return assertNever(spec);
  }
}

export function computeTicks(spec: AxisSpec, lim: readonly [number, number], space: number, theme: Theme, minpos: number): TickSet {
  const scale = scaleOf(spec);
  const raw = locations(spec, lim, space, minpos);
  // get_minorticklocs: drop minor ticks within 1e-5 of the transformed view span of a major tick
  const lo = Math.min(forward(scale, lim[0]), forward(scale, lim[1])), hi = Math.max(forward(scale, lim[0]), forward(scale, lim[1]));
  const tolMinor = (hi - lo) * 1e-5;
  const majorT = raw.major.map((v) => forward(scale, v));
  const minor = raw.minor.filter((v) => { const t = forward(scale, v); return !majorT.some((m) => Math.abs(t - m) <= tolMinor); });
  const locs: Locs = { major: raw.major, minor };
  const f = format(spec, locs, lim, theme);
  // _interval_contains_close in transformed space, rtol 1e-10
  const tol = 1e-10 * (hi - lo);
  const inView = (v: number): boolean => { const t = forward(scale, v); return t >= lo - tol && t <= hi + tol; };
  const visible: Tick[] = [];
  locs.major.forEach((v, i) => { if (inView(v)) visible.push({ loc: v, label: f.labels[i], minor: false, index: i }); });
  locs.minor.forEach((v, i) => { if (inView(v)) visible.push({ loc: v, label: f.minor[i], minor: true, index: i }); });
  return { locs: locs.major, labels: f.labels, offset: f.offset, minor: locs.minor, minorLabels: f.minor, visible };
}
