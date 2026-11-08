// Oracle fuzz: matplotlib's RRuleLocators (Month/Day/Hour/Minute/SecondLocator) and YearLocator, with the default
// AutoDateFormatter (whose format follows the locator's unit), over random parameters and views
// (fixtures/fuzz_rrule_dates.py, matplotlib 3.11.2). An RRuleLocator anchors its rrule at vmin − relativedelta(vmax, vmin),
// so with interval > 1 the tick phase depends on the view.
import { readFileSync } from 'node:fs';
import { autoDateFormat, dateTicks } from '../src/core/dates.ts';
import { DayLocator, HourLocator, MinuteLocator, MonthLocator, SecondLocator, YearLocator } from '../src/index.ts';

const CLS = { DayLocator, HourLocator, MinuteLocator, MonthLocator, SecondLocator, YearLocator } as const;
const data = JSON.parse(readFileSync(new URL('../fixtures/ref/_rrule_dates_fuzz.json', import.meta.url), 'utf8'));
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
let fail = 0;
const byKind = new Map<string, number>();
for (const c of data.cases) {
  const kind = c.kind as keyof typeof CLS;
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  let ticks: readonly number[], labels: readonly string[];
  try {
    const r = dateTicks(new CLS[kind](c.kw).spec, [c.lo, c.hi]);
    ticks = r.locs; labels = autoDateFormat(ticks, r.unitDays);
  } catch (e) { fail++; console.log('THREW', kind, JSON.stringify(c.kw), (e as Error).message); continue; }
  const ok = ticks.length === c.ticks.length && ticks.every((t, i) => close(t, c.ticks[i])) && labels.every((l, i) => l === c.labels[i]);
  if (!ok && ++fail <= 6) {
    console.log(`MISMATCH ${kind}(${JSON.stringify(c.kw)}) [${c.lo}, ${c.hi}]\n  got  ${JSON.stringify(labels.slice(0, 6))} (${ticks.length})\n  want ${JSON.stringify(c.labels.slice(0, 6))} (${c.ticks.length})`);
  }
}
console.log(`${data.cases.length - fail}/${data.cases.length} rrule date fuzz cases match matplotlib (seed ${data.seed}) · ${[...byKind].map(([k, n]) => `${k}:${n}`).join(' ')}`);
process.exit(fail ? 1 : 0);
