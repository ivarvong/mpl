// src/core/histogram.ts against numpy.histogram (fixtures/histogram_oracle.json, fixtures/generate_histogram.py):
// every bin edge and count must be the same double, and every error the same message.
import { readFileSync } from 'node:fs';
import { histogram } from '../src/core/histogram.ts';
import type { Bins } from '../src/core/histogram.ts';
import { BIN_ESTIMATORS } from '../src/core/histogram.ts';
import { none, some } from '../src/core/types.ts';

type Case = { data: string; bins: unknown; range: [number, number] | null; density: boolean; weights: string[] | null; counts?: string[]; edges?: string[]; error?: string };
const oracle: { data: Record<string, string[]>; integer: string[]; cases: Case[] } = JSON.parse(readFileSync(new URL('../fixtures/histogram_oracle.json', import.meta.url), 'utf8'));
const num = (s: string): number => (s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));
const arr = (xs: string[]): Float64Array => Float64Array.from(xs, num);
const same = (a: number, b: number): boolean => Object.is(a, b) || (a === b);

let fails = 0;
for (const c of oracle.cases) {
  const bins: Bins = typeof c.bins === 'number' ? { kind: 'count', n: c.bins }
    : typeof c.bins === 'string' ? { kind: 'estimator', name: BIN_ESTIMATORS.find((e) => e === c.bins) ?? 'auto' }
    : { kind: 'edges', edges: Float64Array.from(c.bins as number[]) };
  const r = histogram({ values: arr(oracle.data[c.data]), integer: oracle.integer.includes(c.data) }, bins, c.range ? some(c.range) : none, c.density, c.weights ? some(arr(c.weights)) : none);
  const tag = `${c.data} bins=${JSON.stringify(c.bins)} range=${JSON.stringify(c.range)} density=${c.density} weighted=${c.weights !== null}`;
  if (c.error !== undefined) {
    if (r.ok || r.error !== c.error) { fails++; console.log(`FAIL ${tag}: want error ${JSON.stringify(c.error)}, got ${r.ok ? 'ok' : JSON.stringify(r.error)}`); }
    continue;
  }
  if (!r.ok) { fails++; console.log(`FAIL ${tag}: ${r.error}`); continue; }
  const e = arr(c.edges ?? []), n = arr(c.counts ?? []);
  const eOk = e.length === r.value.edges.length && e.every((v, i) => same(v, r.value.edges[i]));
  const nOk = n.length === r.value.counts.length && n.every((v, i) => same(v, r.value.counts[i]));
  if (!eOk || !nOk) {
    fails++;
    console.log(`FAIL ${tag}: edges ${eOk ? 'ok' : `${r.value.edges.length} vs ${e.length}: ${[...r.value.edges].slice(0, 4)} want ${[...e].slice(0, 4)}`} counts ${nOk ? 'ok' : `${[...r.value.counts].slice(0, 6)} want ${[...n].slice(0, 6)}`}`);
  }
}
if (fails > 0) { console.log(`histogram: ${fails} of ${oracle.cases.length} cases differ from numpy`); process.exit(1); }
console.log(`histogram: ${oracle.cases.length} numpy cases bit-exact`);
