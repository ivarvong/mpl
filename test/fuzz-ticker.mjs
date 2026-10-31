// Oracle fuzz: MaxNLocator + ScalarFormatter vs matplotlib over random intervals.
import { readFileSync } from 'node:fs';
import { autoTicks, scalarFormat } from '../src/core/ticker.ts';
import { tracer } from '../src/trace.ts';

const data = JSON.parse(readFileSync(new URL('../fixtures/ref/_ticker_fuzz.json', import.meta.url), 'utf8'));
if (process.env.TRACE) tracer.enable();
const close = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
let fail = 0;
const root = tracer.startTrace('fuzz.ticker', { n: data.cases.length, seed: data.seed });
for (const c of data.cases) {
  const span = tracer.startSpan('case', { axis: c.axis, lo: c.lo, hi: c.hi, kind: c.kind });
  let ticks, labels, offset;
  try {
    ticks = autoTicks(c.lo, c.hi, c.tickspace);
    ({ labels, offset } = scalarFormat(ticks, [c.lo, c.hi], { useOffset: true, offsetThreshold: 4, powerlimits: [-5, 6], unicodeMinus: true }));
  } catch (e) { span.recordException(e); span.end(); fail++; console.log('THREW', c, e.message); continue; }
  const ok = ticks.length === c.ticks.length && ticks.every((t, i) => close(t, c.ticks[i]))
    && labels.every((l, i) => l === c.labels[i]) && offset === c.offset;
  if (!ok) {
    fail++; span.setAttribute('ok', false);
    span.addEvent('mismatch', { got: JSON.stringify({ ticks, labels, offset }), want: JSON.stringify({ ticks: c.ticks, labels: c.labels, offset: c.offset }) });
    if (fail <= 10) console.log(`MISMATCH ${c.axis} [${c.lo}, ${c.hi}] (${c.kind})\n  got  ${JSON.stringify({ ticks, labels, offset })}\n  want ${JSON.stringify({ ticks: c.ticks, labels: c.labels, offset: c.offset })}`);
  }
  span.end();
}
root.setAttribute('failures', fail).end();
console.log(`${data.cases.length - fail}/${data.cases.length} ticker fuzz cases match matplotlib (seed ${data.seed})`);
if (process.env.TRACE) console.log(`flushed ${await tracer.flush(process.env.TRACE)} spans to ${process.env.TRACE}`);
process.exit(fail ? 1 : 0);
