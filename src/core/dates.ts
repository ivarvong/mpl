// Port of matplotlib.dates (3.11.2): date numbers (days since 1970-01-01 UTC),
// num2date / date2num, dateutil.relativedelta, AutoDateLocator (interval_multiples=True)
// and AutoDateFormatter with the default rc formats. UTC only.
import { pyDivmod } from './ticker.ts';
import { assertNever } from './types.ts';

const US_PER_DAY = 86_400_000_000;
const DAYS_PER_YEAR = 365, DAYS_PER_MONTH = 30;

/** A calendar instant: whole days since the epoch plus microseconds into the day [0, 86.4e9). */
export type DT = { readonly day: number; readonly us: number };
type Civil = { readonly y: number; readonly m: number; readonly d: number; readonly hh: number; readonly mm: number; readonly ss: number; readonly micro: number };

// Howard Hinnant's civil-from-days / days-from-civil (proleptic Gregorian).
function civilFromDays(z0: number): readonly [number, number, number] {
  const z = z0 + 719468, era = Math.floor(z / 146097), doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153), d = doy - Math.floor((153 * mp + 2) / 5) + 1, m = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (m <= 2 ? 1 : 0), m, d];
}
export function daysFromCivil(y0: number, m: number, d: number): number {
  const y = y0 - (m <= 2 ? 1 : 0), era = Math.floor(y / 400), yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
}
const monthDays = (y: number, m: number): number => daysFromCivil(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - daysFromCivil(y, m, 1);

function civil(t: DT): Civil {
  const [y, m, d] = civilFromDays(t.day);
  const s = Math.floor(t.us / 1e6);
  return { y, m, d, hh: Math.floor(s / 3600), mm: Math.floor(s / 60) % 60, ss: s % 60, micro: t.us - s * 1e6 };
}
const fromCivil = (c: Civil): DT => ({ day: daysFromCivil(c.y, c.m, c.d), us: ((c.hh * 60 + c.mm) * 60 + c.ss) * 1e6 + c.micro });
const cmp = (a: DT, b: DT): number => (a.day !== b.day ? a.day - b.day : a.us - b.us);

/** A JS Date (ms since the epoch) as a DT. */
export function fromEpochMs(ms: number): DT {
  const day = Math.floor(ms / 86_400_000);
  return { day, us: (ms - day * 86_400_000) * 1000 };
}

/** date2num via _dt64_to_ordinalf: (whole seconds + extra_ns / 1e9) / 86400. */
export function date2num(t: DT): number {
  const sec = Math.floor(t.us / 1e6);
  const extraNs = (t.us - sec * 1e6) * 1000;
  return (t.day * 86400 + sec + extraNs / 1e9) / 86400;
}

const rint = (v: number): number => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; };

/** num2date via _from_ordinalf: round to whole µs; beyond 70 years from the epoch, round to 20 µs. */
export function num2date(x: number): DT {
  const total = BigInt(rint(x * US_PER_DAY));
  const perDay = BigInt(US_PER_DAY);
  let day = total / perDay, rem = total % perDay;
  if (rem < 0n) { rem += perDay; day -= 1n; }
  let t: DT = { day: Number(day), us: Number(rem) };
  if (Math.abs(x) > 70 * 365) {
    const c = civil(t);
    const ms = rint(c.micro / 20) * 20;
    t = ms === 1e6 ? addSeconds({ ...t, us: t.us - c.micro }, 1) : { ...t, us: t.us - c.micro + ms };
  }
  return t;
}
function addSeconds(t: DT, s: number): DT {
  const us = t.us + s * 1e6;
  const dd = Math.floor(us / US_PER_DAY);
  return { day: t.day + dd, us: us - dd * US_PER_DAY };
}

// ---------------------------------------------------------------- dateutil.relativedelta(dt1, dt2), dt1 >= dt2
type RelDelta = { readonly years: number; readonly months: number; readonly hours: number; readonly minutes: number };

function addMonths(c: Civil, years: number, months: number): Civil {
  let y = c.y + years, m = c.m + months;
  if (m > 12) { y += 1; m -= 12; } else if (m < 1) { y -= 1; m += 12; }
  return { ...c, y, m, d: Math.min(monthDays(y, m), c.d) };
}
const splitMonths = (months: number): readonly [number, number] => {
  if (Math.abs(months) <= 11) return [0, months];
  const s = Math.sign(months), [div, mod] = pyDivmod(months * s, 12);
  return [div * s, mod * s];
};
function relativedelta(dt1: DT, dt2: DT): RelDelta {
  const c1 = civil(dt1), c2 = civil(dt2);
  let months = (c1.y - c2.y) * 12 + (c1.m - c2.m);
  let [years, mo] = splitMonths(months);
  let dtm = fromCivil(addMonths(c2, years, mo));
  while (cmp(dt1, dtm) < 0) {                      // overshot: step back one month
    months -= 1;
    [years, mo] = splitMonths(months);
    dtm = fromCivil(addMonths(c2, years, mo));
  }
  // timedelta dt1 - dtm -> seconds + microseconds, then _fix into minutes and hours
  const totalUs = (dt1.day - dtm.day) * US_PER_DAY + (dt1.us - dtm.us);
  const seconds = Math.floor(totalUs / 1e6);
  let minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  minutes %= 60; hours %= 24;
  return { years, months: mo, hours, minutes };
}

// ---------------------------------------------------------------- AutoDateLocator
/**
 * What AutoDateLocator.get_locator picks. Under interval_multiples every rrule frequency runs
 * at interval 1, fixes all finer units to zero, and filters exactly one field.
 */
export type DateLocator =
  | { readonly kind: 'yearly'; readonly base: number }
  | { readonly kind: 'monthly'; readonly months: readonly number[] }
  | { readonly kind: 'daily'; readonly monthdays: readonly number[] }
  | { readonly kind: 'hourly'; readonly hours: readonly number[] }
  | { readonly kind: 'minutely'; readonly minutes: readonly number[] }
  | { readonly kind: 'secondly'; readonly seconds: readonly number[] }
  | { readonly kind: 'microsecond'; readonly interval: number; readonly unitDays: number };

const MINTICKS = 5;
const MAXTICKS = [11, 12, 11, 12, 11, 11, 8];
const INTERVALS: readonly (readonly number[])[] = [
  [1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 400, 500, 1000, 2000, 4000, 5000, 10000],
  [1, 2, 3, 4, 6],
  [1, 2, 4, 7, 14],                                 // DAILY under interval_multiples
  [1, 2, 3, 4, 6, 12],
  [1, 5, 10, 15, 30],
  [1, 5, 10, 15, 30],
  [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000],
];
const range = (a: number, b: number, step: number): number[] => { const out: number[] = []; for (let v = a; v < b; v += step) out.push(v); return out; };

export function chooseDateLocator(dmin: DT, dmax: DT): DateLocator {
  const delta = relativedelta(dmax, dmin);
  const totalUs = (dmax.day - dmin.day) * US_PER_DAY + (dmax.us - dmin.us);
  const numYears = delta.years;
  const numMonths = numYears * 12 + delta.months;
  const numDays = Math.floor(totalUs / US_PER_DAY);                 // timedelta.days
  const numHours = numDays * 24 + delta.hours;
  const numMinutes = numHours * 60 + delta.minutes;
  const numSeconds = Math.floor(totalUs / 1e6);
  const numMicro = Math.floor(totalUs);
  const nums = [numYears, numMonths, numDays, numHours, numMinutes, numSeconds, numMicro];
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] < MINTICKS) continue;
    let interval = INTERVALS[i][INTERVALS[i].length - 1];
    for (const iv of INTERVALS[i]) if (nums[i] <= iv * (MAXTICKS[i] - 1)) { interval = iv; break; }
    switch (i) {
      case 0: return { kind: 'yearly', base: interval };
      case 1: return { kind: 'monthly', months: range(1, 13, interval) };
      // matplotlib tests `i in (DAILY, WEEKLY)` against dateutil constants (3, 2): index 2 is daily
      case 2: return { kind: 'daily', monthdays: interval === 14 ? [1, 15] : interval === 7 ? [1, 8, 15, 22] : range(1, 32, interval) };
      case 3: return { kind: 'hourly', hours: range(0, 24, interval) };
      case 4: return { kind: 'minutely', minutes: range(0, 60, interval) };
      case 5: return { kind: 'secondly', seconds: range(0, 60, interval) };
      case 6: return { kind: 'microsecond', interval, unitDays: 1 / US_PER_DAY };
      default: throw new Error(`unreachable frequency index ${i}`);
    }
  }
  // no frequency had enough ticks: MicrosecondLocator(1); self._freq keeps its initial YEARLY
  return { kind: 'microsecond', interval: 1, unitDays: DAYS_PER_YEAR };
}

/** RRuleLocator / YearLocator unit (get_unit_generic), which picks the AutoDateFormatter format. */
export function locatorUnitDays(l: DateLocator): number {
  switch (l.kind) {
    case 'yearly': return DAYS_PER_YEAR;
    case 'monthly': return DAYS_PER_MONTH;
    case 'daily': return 1;
    case 'hourly': return 1 / 24;
    case 'minutely': return 1 / 1440;
    case 'secondly': return 1 / 86400;
    case 'microsecond': return l.unitDays;
    default: return assertNever(l);
  }
}

/** Every instant in [lo, hi] whose fields match: unit-by-unit enumeration (rrule with interval 1). */
function filtered(lo: DT, hi: DT, l: Exclude<DateLocator, { kind: 'yearly' } | { kind: 'microsecond' }>): DT[] {
  const out: DT[] = [];
  const keep = (t: DT): void => { if (cmp(t, lo) >= 0 && cmp(t, hi) <= 0) out.push(t); };
  const a = civil(lo), b = civil(hi);
  switch (l.kind) {
    case 'monthly':
      for (let y = a.y, m = a.m; y < b.y || (y === b.y && m <= b.m); m === 12 ? (y++, m = 1) : m++) {
        if (l.months.includes(m)) keep({ day: daysFromCivil(y, m, 1), us: 0 });
      }
      return out;
    case 'daily':
      for (let day = lo.day; day <= hi.day; day++) if (l.monthdays.includes(civilFromDays(day)[2])) keep({ day, us: 0 });
      return out;
    case 'hourly': case 'minutely': case 'secondly': {
      const stepUs = l.kind === 'hourly' ? 3.6e9 : l.kind === 'minutely' ? 6e7 : 1e6;
      const field = (t: DT): number => { const c = civil(t); return l.kind === 'hourly' ? c.hh : l.kind === 'minutely' ? c.mm : c.ss; };
      const allowed = l.kind === 'hourly' ? l.hours : l.kind === 'minutely' ? l.minutes : l.seconds;
      for (let t: DT = { day: lo.day, us: Math.floor(lo.us / stepUs) * stepUs }; cmp(t, hi) <= 0; t = addUs(t, stepUs)) {
        if (allowed.includes(field(t))) keep(t);
      }
      return out;
    }
    default: return assertNever(l);
  }
}
function addUs(t: DT, us: number): DT {
  const v = t.us + us;
  return v >= US_PER_DAY ? { day: t.day + 1, us: v - US_PER_DAY } : { day: t.day, us: v };
}

/** AutoDateLocator.__call__ on the view interval (date numbers). */
export function autoDateTicks(view: readonly [number, number]): { readonly locs: readonly number[]; readonly locator: DateLocator } {
  const vmin = Math.min(view[0], view[1]), vmax = Math.max(view[0], view[1]);
  const dmin = num2date(vmin), dmax = num2date(vmax);
  const l = chooseDateLocator(dmin, dmax);
  switch (l.kind) {
    case 'yearly': {
      // YearLocator._create_rrule: Jan 1 of base-multiples; `start` keeps vmin's microsecond, the rule drops it
      const a = civil(dmin), b = civil(dmax);
      const ymin = Math.max(Math.floor(a.y / l.base) * l.base, 1);
      const ymax = Math.min(Math.ceil(b.y / l.base) * l.base, 9999);
      const start: DT = { day: daysFromCivil(ymin, 1, 1), us: a.micro };
      const stop: DT = { day: daysFromCivil(ymax, 1, 1), us: a.micro };
      const out: number[] = [];
      for (let y = ymin; y <= ymax; y += l.base) {
        const t: DT = { day: daysFromCivil(y, 1, 1), us: 0 };
        if (cmp(t, start) >= 0 && cmp(t, stop) <= 0) out.push(date2num(t));
      }
      return { locs: out.length > 0 ? out : [vmin, vmax], locator: l };
    }
    case 'monthly': case 'daily': case 'hourly': case 'minutely': case 'secondly': {
      const ts = filtered(dmin, dmax, l);
      return { locs: ts.length > 0 ? ts.map(date2num) : [date2num(dmin), date2num(dmax)], locator: l };
    }
    case 'microsecond': {
      // MicrosecondLocator: MultipleLocator(interval) on µs since the start of vmin's day
      const nmin = date2num(dmin), t0 = Math.floor(nmin);
      const lo = (nmin - t0) * US_PER_DAY, hi = (date2num(dmax) - t0) * US_PER_DAY, step = l.interval;
      const [d, m] = pyDivmod(lo, step);
      const first = (Math.abs(m / step) < 1e-10 ? d : d + 1) * step;
      const n = Math.floor((hi - first + 0.001 * step) / step);
      return { locs: Array.from({ length: n + 3 }, (_, i) => (first - step + i * step) / US_PER_DAY + t0), locator: l };
    }
    default: return assertNever(l);
  }
}

// ---------------------------------------------------------------- AutoDateFormatter (default rc formats)
const SCALED: ReadonlyArray<readonly [number, string]> = [
  [1 / US_PER_DAY, '%M:%S.%f'], [1 / 86400, '%H:%M:%S'], [1 / 1440, '%d %H:%M'], [1 / 24, '%m-%d %H'],
  [1, '%Y-%m-%d'], [DAYS_PER_MONTH, '%Y-%m'], [DAYS_PER_YEAR, '%Y'],
];
const pad = (v: number, n: number): string => String(v).padStart(n, '0');

/** datetime.strftime for the directives the default formats use. */
export function strftime(t: DT, fmt: string): string {
  const c = civil(t);
  return fmt.replace(/%([YmdHMSf%])/g, (_, k: string) => {
    switch (k) {
      case 'Y': return String(c.y);
      case 'm': return pad(c.m, 2);
      case 'd': return pad(c.d, 2);
      case 'H': return pad(c.hh, 2);
      case 'M': return pad(c.mm, 2);
      case 'S': return pad(c.ss, 2);
      case 'f': return pad(c.micro, 6);
      case '%': return '%';
      default: throw new Error(`unsupported strftime directive %${k}`);
    }
  });
}

/** The first scaled format whose scale is >= the locator unit (else '%Y-%m-%d'). */
export function autoDateFormat(locs: readonly number[], locator: DateLocator): readonly string[] {
  const unit = locatorUnitDays(locator);
  const i = SCALED.findIndex(([scale]) => scale >= unit);
  const fmt = i >= 0 ? SCALED[i][1] : '%Y-%m-%d';
  return locs.map((x) => strftime(num2date(x), fmt));
}

/** AutoDateLocator.nonsingular; with no data the default limits are 1970-01-01 .. 1970-01-02. */
export function dateNonsingular(v0: number, v1: number): readonly [number, number] {
  if (!Number.isFinite(v0) || !Number.isFinite(v1)) return [0, 1];
  const lo = Math.min(v0, v1), hi = Math.max(v0, v1);
  return lo === hi ? [lo - DAYS_PER_YEAR * 2, hi + DAYS_PER_YEAR * 2] : [lo, hi];
}
