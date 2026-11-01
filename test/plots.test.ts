// hist's return values and the plotting calls' errors against matplotlib itself (fixtures/plots_oracle.json,
// fixtures/generate_plots_oracle.py): n and bins bit for bit, errors with matplotlib's exact message. Python's
// TypeError must be a TypeError here; its ValueError is any other Error. Plus the API shapes the oracle can't show.
import { readFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';
import type { Axes, HistResult, HistResultMulti } from '../src/index.ts';

type Case = { name: string; setup: [string, unknown[], Record<string, unknown>][]; method: string; args: unknown[]; kwargs: Record<string, unknown>;
  ok: boolean; n?: string[] | string[][]; bins?: string[]; patches?: number; error?: string; message?: string };
const oracle: { cases: Case[] } = JSON.parse(readFileSync(new URL('../fixtures/plots_oracle.json', import.meta.url), 'utf8'));
const num = (s: string): number => (s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));
const sameArr = (got: ArrayLike<number>, want: readonly string[]): boolean => got.length === want.length && want.every((w, i) => Object.is(num(w), got[i]) || num(w) === got[i]);
type Dyn = Record<string, (...args: unknown[]) => unknown>;
const call = (ax: Axes, m: string, args: unknown[], kw: Record<string, unknown>): unknown => {
  const f = (ax as unknown as Dyn)[m];
  return Object.keys(kw).length > 0 ? f.call(ax, ...args, kw) : f.call(ax, ...args);
};

let fails = 0;
const fail = (msg: string): void => { fails++; console.log(`FAIL ${msg}`); };
for (const c of oracle.cases) {
  const [, ax] = subplots();
  for (const [m, a, k] of c.setup) call(ax, m, a, k);
  let out: unknown;
  try { out = call(ax, c.method, c.args, c.kwargs); } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (c.ok) { fail(`${c.name}: threw ${msg}`); continue; }
    if (msg !== c.message) fail(`${c.name}: message\n  got  ${msg}\n  want ${c.message}`);
    if ((c.error === 'TypeError') !== (e instanceof TypeError)) fail(`${c.name}: Python raised ${c.error}, got ${e instanceof Error ? e.name : typeof e}`);
    continue;
  }
  if (!c.ok) { fail(`${c.name}: expected ${c.error}: ${c.message}`); continue; }
  if (c.method !== 'hist') continue;
  const [n, bins, patches] = out as HistResult | HistResultMulti;
  if (!sameArr(bins, c.bins ?? [])) fail(`${c.name}: bins ${[...bins].slice(0, 4)} want ${(c.bins ?? []).slice(0, 4)}`);
  const wantN = c.n ?? [];
  const multi = Array.isArray(wantN[0]);
  const rows = (multi ? (n as readonly Float64Array[]) : [n as Float64Array]);
  const wantRows = (multi ? wantN : [wantN]) as string[][];
  if (rows.length !== wantRows.length || rows.some((r, i) => !sameArr(r, wantRows[i]))) fail(`${c.name}: n ${rows.map((r) => [...r].slice(0, 5).join(',')).join(' | ')} want ${wantRows.map((r) => r.slice(0, 5).join(',')).join(' | ')}`);
  const nPatches = Array.isArray(patches) ? patches.length : (patches as { kind: string; bars?: { x: Float64Array } }).kind === 'bars' ? (patches as { bars: { x: Float64Array } }).bars.x.length : 1;
  if (nPatches !== c.patches) fail(`${c.name}: ${nPatches} patches, want ${c.patches}`);
}

// errorevery's (start, step) tuple is { start, step } here (a JS array is Python's list: an index list)
{
  const [, ax] = subplots();
  const xs = [0, 1, 2, 3, 4, 5, 6];
  const eb = ax.errorbar(xs, xs, { yerr: 0.5, errorevery: { start: 1, step: 3 } });
  const got = [...eb.barlinecols[0].x0];
  if (got.join() !== '1,4') fail(`errorevery {start: 1, step: 3}: bars at ${got}, want 1,4`);
  const eb2 = ax.errorbar(xs, xs, { yerr: 0.5, errorevery: [-1, 2] });
  if ([...eb2.barlinecols[0].x0].join() !== '2,6') fail(`errorevery [-1, 2]: bars at ${[...eb2.barlinecols[0].x0]}, want 2,6`);
  if (eb.data_line.kind !== 'some' || eb.caplines.length !== 0 || !eb.has_yerr || eb.has_xerr) fail('errorbar container shape');
  const none = ax.errorbar(xs, xs, { xerr: 0.1, fmt: 'none', capsize: 2 });
  if (none.data_line.kind !== 'none' || none.caplines.length !== 2) fail('errorbar fmt=none: no data line, two cap lines');
}
// hist's typed result: one dataset gives a single n row and one patches entry, several give one per dataset
{
  const [, ax] = subplots();
  const [n1, , p1] = ax.hist([1, 2, 2, 3], { bins: 3 });
  if (!(n1 instanceof Float64Array) || p1.kind !== 'bars' || p1.bars.x.length !== 3) fail('hist single: Float64Array n and a bars patch');
  const [n2, , p2] = ax.hist([[1, 2], [2, 3]], { histtype: 'step' });
  if (n2.length !== 2 || p2.length !== 2 || p2[0].kind !== 'polygons') fail('hist multi: per-dataset n and polygons');
}
// axline's draw-time ValueError comes at the call here
{
  const [, ax] = subplots();
  try { ax.axline([1, 1], [1, 1]); fail('axline through identical points must throw'); } catch (e) {
    if (!(e instanceof Error) || e.message !== 'Cannot draw a line through two identical points') fail(`axline identical points: ${String(e)}`);
  }
}

if (fails > 0) { console.log(`plots: ${fails} failure(s)`); process.exit(1); }
console.log(`plots: ${oracle.cases.length} matplotlib cases exact, plus API shape checks`);
