// matplotlib.dates AutoDateLocator / DateFormatter / ConciseDateFormatter as typed handles.
// Locators currently only expose AutoDateLocator (interval_multiples=True, the mpl default).
import { prop, isPlainObject } from './std.ts';
import { assertNever, none, some, type DateFormatterSpec, type Option } from './types.ts';

/** AutoDateLocator — the only locator ConciseDateFormatter / date axes need today. */
export class AutoDateLocator {
  readonly kind = 'auto' as const;
}

/** DateFormatter(fmt) — fixed strftime. */
export class DateFormatter {
  readonly kind = 'strftime' as const;
  readonly fmt: string;
  constructor(fmt: string) {
    if (typeof fmt !== 'string' || fmt.length === 0) throw new TypeError('DateFormatter fmt must be a non-empty string');
    this.fmt = fmt;
  }
}

/** Six format strings — ConciseDateFormatter level 0..5 (years … seconds), as matplotlib. */
export type DateFormatList = readonly [string, string, string, string, string, string];

/**
 * ConciseDateFormatter kwargs, matplotlib-shaped: every field optional; omitted → matplotlib default.
 * Format lists are 6-tuples at the type level; a wrong length still throws RangeError for JS callers.
 * Written as Partial<{…}> (not `x?:`) so check_strict stays happy; absence is lifted via prop().
 */
export type ConciseDateFormatterInit = Partial<{
  readonly formats: DateFormatList;
  readonly zero_formats: DateFormatList;
  readonly offset_formats: DateFormatList;
  readonly show_offset: boolean;
}>;

/** ConciseDateFormatter(locator, { formats, zero_formats, offset_formats, show_offset }). */
export class ConciseDateFormatter {
  readonly kind = 'concise' as const;
  readonly formats: Option<readonly string[]>;
  readonly zeroFormats: Option<readonly string[]>;
  readonly offsetFormats: Option<readonly string[]>;
  readonly showOffset: boolean;
  constructor(locator: AutoDateLocator, opts: ConciseDateFormatterInit = {}) {
    if (!(locator instanceof AutoDateLocator)) {
      throw new TypeError('ConciseDateFormatter requires an AutoDateLocator (other locators are not supported yet)');
    }
    if (!isPlainObject(opts)) {
      throw new TypeError('ConciseDateFormatter options must be a plain object');
    }
    this.formats = readFormatList('formats', prop(opts, 'formats'));
    this.zeroFormats = readFormatList('zero_formats', prop(opts, 'zero_formats'));
    this.offsetFormats = readFormatList('offset_formats', prop(opts, 'offset_formats'));
    const show = prop(opts, 'show_offset');
    switch (show.kind) {
      case 'none': this.showOffset = true; break;
      case 'some': {
        if (typeof show.value !== 'boolean') throw new TypeError('show_offset must be a bool');
        this.showOffset = show.value;
        break;
      }
      default: assertNever(show);
    }
  }
}

function readFormatList(name: string, o: Option<unknown>): Option<readonly string[]> {
  switch (o.kind) {
    case 'none': return none;
    case 'some': {
      const v = o.value;
      if (!Array.isArray(v) || v.length !== 6) {
        throw new RangeError(`${name} argument must be a list of 6 format strings (or None)`);
      }
      const out: string[] = [];
      for (let i = 0; i < 6; i++) {
        const x = v[i];
        if (typeof x !== 'string') {
          throw new RangeError(`${name} argument must be a list of 6 format strings (or None)`);
        }
        out.push(x);
      }
      return some(out);
    }
    default: return assertNever(o);
  }
}

export type MajorFormatter = DateFormatter | ConciseDateFormatter | { readonly kind: 'auto' };

export function formatterSpecOf(f: MajorFormatter): DateFormatterSpec {
  switch (f.kind) {
    case 'auto': return { kind: 'auto' };
    case 'strftime': return { kind: 'strftime', fmt: f.fmt };
    case 'concise':
      return {
        kind: 'concise',
        formats: f.formats,
        zeroFormats: f.zeroFormats,
        offsetFormats: f.offsetFormats,
        showOffset: f.showOffset,
      };
    default: return assertNever(f);
  }
}
