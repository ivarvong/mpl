// Oracle fuzz: AutoDateLocator + AutoDateFormatter vs matplotlib over random intervals.
import { readFileSync } from 'node:fs';
import { autoDateFormat, autoDateTicks } from '../src/core/dates.ts';

const data = JSON.parse(readFileSync(new URL('../fixtures/ref/_dates_fuzz.json', import.meta.url), 'utf8'));
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
let fail = 0;
const byKind = new Map();
for (const c of data.cases) {
  let ticks, labels, kind;
  try {
    const r = autoDateTicks([c.lo, c.hi]);
    ticks = r.locs; labels = autoDateFormat(ticks, r.locator); kind = r.locator.kind;
  } catch (e) { fail++; console.log('THREW', c.lo, c.hi, e.message); continue; }
  byKind.set(kind, (byKind.get(kind) || 0) + 1);
  const ok = ticks.length === c.ticks.length && ticks.every((t, i) => close(t, c.ticks[i])) && labels.every((l, i) => l === c.labels[i]);
  if (!ok) {
    fail++;
    if (fail <= 6) console.log(`MISMATCH [${c.lo}, ${c.hi}] (${kind})\n  got  ${JSON.stringify(labels)}\n  want ${JSON.stringify(c.labels)}\n  gotT ${JSON.stringify(ticks.slice(0, 3))} wantT ${JSON.stringify(c.ticks.slice(0, 3))}`);
  }
}
console.log(`${data.cases.length - fail}/${data.cases.length} date fuzz cases match matplotlib (seed ${data.seed}) · ${[...byKind].map(([k, n]) => `${k}:${n}`).join(' ')}`);
process.exit(fail ? 1 : 0);
