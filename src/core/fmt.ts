// Parsers for plot format strings, line styles and marker names.
// Port of matplotlib.axes._base._process_plot_format.
import { MARKERS, MARKER_NAMES } from './data/markers.ts';
import { parsePaint } from './colors.ts';
import type { LineStyleName, MarkerName, Option, Result } from './types.ts';
import { err, none, ok, some } from './types.ts';

/** What a fmt string says about shape. 'default' = neither given (rc decides); naming one implies the other is off. */
export type FmtShape =
  | { readonly kind: 'default' }
  | { readonly kind: 'line'; readonly line: LineStyleName }
  | { readonly kind: 'marker'; readonly marker: MarkerName }
  | { readonly kind: 'both'; readonly line: LineStyleName; readonly marker: MarkerName };
export type Fmt = { readonly color: Option<string>; readonly shape: FmtShape };

const FMT_LINES: ReadonlyArray<readonly [string, LineStyleName]> = [['--', 'dashed'], ['-.', 'dashdot'], ['-', 'solid'], [':', 'dotted']];
const BASE_COLORS = 'bgrcmykw';
const ANY_CYCLE = [{ hex: '#000000', alpha: 1 }];

function markerFromChar(c: string): Option<MarkerName> {
  for (const m of MARKER_NAMES) if (m === c) return some(m);
  return none;
}

export function parseFmt(fmt: string): Result<Fmt> {
  if (fmt === '') return ok({ color: none, shape: { kind: 'default' } });
  // matplotlib first tries the whole string as a color ('red', '#ff0000', 'C1', '0.5').
  if (parsePaint(fmt, ANY_CYCLE).ok) return ok({ color: some(fmt), shape: { kind: 'default' } });
  let color: Option<string> = none, line: Option<LineStyleName> = none, marker: Option<MarkerName> = none;
  let i = 0;
  while (i < fmt.length) {
    const rest = fmt.slice(i);
    const ls = FMT_LINES.find(([tok]) => rest.startsWith(tok));
    if (ls) {
      if (line.kind === 'some') return err(`Illegal format string "${fmt}"; two linestyle symbols`);
      line = some(ls[1]); i += ls[0].length; continue;
    }
    const c = fmt[i];
    const mk = markerFromChar(c);
    if (mk.kind === 'some') {
      if (marker.kind === 'some') return err(`Illegal format string "${fmt}"; two marker symbols`);
      marker = mk; i += 1; continue;
    }
    if (BASE_COLORS.includes(c) || (c === 'C' && /\d/.test(fmt.slice(i + 1, i + 2)))) {
      if (color.kind === 'some') return err(`Illegal format string "${fmt}"; two color symbols`);
      let j = i + 1;
      if (c === 'C') while (j < fmt.length && /\d/.test(fmt[j])) j++;
      color = some(fmt.slice(i, j)); i = j; continue;
    }
    return err(`Unrecognized character ${c} in format string "${fmt}"`);
  }
  if (line.kind === 'some' && marker.kind === 'some') return ok({ color, shape: { kind: 'both', line: line.value, marker: marker.value } });
  if (line.kind === 'some') return ok({ color, shape: { kind: 'line', line: line.value } });
  if (marker.kind === 'some') return ok({ color, shape: { kind: 'marker', marker: marker.value } });
  return ok({ color, shape: { kind: 'default' } });
}

/** '-', 'solid', '--', 'dashed', ... ; 'None' / 'none' / '' / ' ' parse to none. */
export function parseLinestyle(v: unknown): Result<Option<LineStyleName>> {
  if (typeof v !== 'string') return err(`linestyle must be a string, got ${typeof v}`);
  switch (v) {
    case '-': case 'solid': return ok(some('solid'));
    case '--': case 'dashed': return ok(some('dashed'));
    case '-.': case 'dashdot': return ok(some('dashdot'));
    case ':': case 'dotted': return ok(some('dotted'));
    case 'None': case 'none': case '': case ' ': return ok(none);
    default: return err(`unknown linestyle ${JSON.stringify(v)}`);
  }
}

export function parseMarker(v: unknown): Result<Option<MarkerName>> {
  if (typeof v !== 'string') return err(`marker must be a string, got ${typeof v}`);
  if (v === 'None' || v === 'none' || v === '' || v === ' ') return ok(none);
  const m = markerFromChar(v);
  return m.kind === 'some' && Object.hasOwn(MARKERS, v) ? ok(m) : err(`unknown marker ${JSON.stringify(v)}`);
}
