// boxplot_stats + Axes.boxplot against matplotlib itself (fixtures/boxplot_oracle.json).
import { readFileSync } from 'node:fs';
import { boxplotStats, parseWhis, reshapeBoxplotData, type BoxplotStats } from '../src/core/boxplot.ts';
import { none, some } from '../src/core/types.ts';
import { subplots } from '../src/index.ts';
import type { Axes, BoxplotResult } from '../src/index.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

type StatsRec = {
  mean: string; med: string; q1: string; q3: string; iqr: string;
  cilo: string; cihi: string; whislo: string; whishi: string; fliers: string[]; label?: string | null;
};
type Case = {
  name: string; kind: 'stats' | 'api'; ok: boolean;
  x?: unknown; args?: unknown[]; kwargs?: Record<string, unknown>; setup?: [string, unknown[], Record<string, unknown>][];
  stats?: StatsRec[]; counts?: Record<string, number>;
  xlim?: number[]; ylim?: number[]; xticks?: number[]; yticks?: number[];
  xticklabels?: string[]; yticklabels?: string[];
  median0?: { x: string[]; y: string[] }; fliers0?: string[];
  error?: string; message?: string;
};
const oracle: { cases: Case[] } = JSON.parse(readFileSync(new URL('../fixtures/boxplot_oracle.json', import.meta.url), 'utf8'));

const num = (s: string): number => (s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));
const same = (a: number, b: number): boolean => Object.is(a, b) || a === b;
/** Same float or adjacent (numpy.mean vs Neumaier can differ by 1 ULP on some lengths). */
const sameMean = (a: number, b: number): boolean => {
  if (same(a, b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const buf = new ArrayBuffer(8), dv = new DataView(buf);
  dv.setFloat64(0, a, true); const ia = dv.getBigInt64(0, true);
  dv.setFloat64(0, b, true); const ib = dv.getBigInt64(0, true);
  const d = ia > ib ? ia - ib : ib - ia;
  return d <= 1n;
};
const sameArr = (got: ArrayLike<number>, want: readonly string[]): boolean =>
  got.length === want.length && want.every((w, i) => same(got[i], num(w)));
const decode = (a: unknown): unknown => {
  if (Array.isArray(a)) return a.map(decode);
  if (a && typeof a === 'object' && '$float' in a) {
    const s = String((a as { $float: string }).$float);
    if (s === 'nan') return NaN;
    if (s === 'inf') return Infinity;
    if (s === '-inf') return -Infinity;
    return Number(s);
  }
  return a;
};
const close = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

const checkStats = (got: BoxplotStats, want: StatsRec, tag: string): string | null => {
  if (!sameMean(got.mean, num(want.mean))) return `${tag}.mean: got ${got.mean} want ${want.mean}`;
  for (const k of ['med', 'q1', 'q3', 'iqr', 'cilo', 'cihi', 'whislo', 'whishi'] as const) {
    if (!same(got[k], num(want[k]))) return `${tag}.${k}: got ${got[k]} want ${want[k]}`;
  }
  if (!sameArr(got.fliers, want.fliers)) return `${tag}.fliers: got ${[...got.fliers]} want ${want.fliers}`;
  const lbl = got.label.kind === 'some' ? got.label.value : null;
  const wantLbl = want.label ?? null;
  if (lbl !== wantLbl) return `${tag}.label: got ${lbl} want ${wantLbl}`;
  return null;
};

type Dyn = Record<string, (...args: unknown[]) => unknown>;
const call = (ax: Axes, m: string, args: unknown[], kw: Record<string, unknown>): unknown => {
  const f = (ax as unknown as Dyn)[m];
  return Object.keys(kw).length > 0 ? f.call(ax, ...args, kw) : f.call(ax, ...args);
};

let fails = 0;
const fail = (msg: string): void => { fails++; console.log(`FAIL ${msg}`); };

for (const c of oracle.cases) {
  if (c.kind === 'stats') {
    const x = decode(c.x);
    const kw = (c.kwargs ?? {}) as { whis?: unknown; labels?: unknown; autorange?: boolean };
    const datasets = reshapeBoxplotData(x);
    const whis = parseWhis(kw.whis ?? 1.5);
    if (!c.ok) {
      // reshape or whis or labels mismatch may throw via Result
      if (!datasets.ok) {
        if (datasets.error !== c.message) fail(`${c.name}: reshape message\n  got  ${datasets.error}\n  want ${c.message}`);
        continue;
      }
      if (!whis.ok) {
        if (whis.error !== c.message) fail(`${c.name}: whis message\n  got  ${whis.error}\n  want ${c.message}`);
        continue;
      }
      const labels = kw.labels !== undefined
        ? some((kw.labels as unknown[]).map((v) => (typeof v === 'string' || typeof v === 'number' ? some(String(v)) : none)))
        : none;
      const r = boxplotStats(datasets.value, whis.value, labels, kw.autorange ?? false);
      if (r.ok) { fail(`${c.name}: expected error ${c.message}`); continue; }
      if (r.error !== c.message) fail(`${c.name}: message\n  got  ${r.error}\n  want ${c.message}`);
      continue;
    }
    if (!datasets.ok) { fail(`${c.name}: reshape ${datasets.error}`); continue; }
    if (!whis.ok) { fail(`${c.name}: whis ${whis.error}`); continue; }
    const labels = kw.labels !== undefined
      ? some((kw.labels as unknown[]).map((v) => (typeof v === 'string' || typeof v === 'number' ? some(String(v)) : none)))
      : none;
    const r = boxplotStats(datasets.value, whis.value, labels, kw.autorange ?? false);
    if (!r.ok) { fail(`${c.name}: ${r.error}`); continue; }
    if (r.value.length !== (c.stats ?? []).length) { fail(`${c.name}: ${r.value.length} stats, want ${(c.stats ?? []).length}`); continue; }
    r.value.forEach((s, i) => {
      const msg = checkStats(s, (c.stats ?? [])[i], `${c.name}[${i}]`);
      if (msg) fail(msg);
    });
    continue;
  }

  // api
  const [, ax] = subplots();
  for (const [m, a, k] of c.setup ?? []) call(ax, m, a as unknown[], k);
  const args = (decode(c.args) as unknown[]) ?? [];
  const kwargs = decode(c.kwargs ?? {}) as Record<string, unknown>;
  let out: unknown;
  try { out = call(ax, 'boxplot', args, kwargs); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (c.ok) { fail(`${c.name}: threw ${msg}`); continue; }
    if (msg !== c.message) fail(`${c.name}: message\n  got  ${msg}\n  want ${c.message}`);
    // bootstrap etc: we throw TypeError; matplotlib may throw something else — accept matching message preferentially,
    // and for our deliberate unsupported keys accept our TypeError message even when matplotlib differs.
    continue;
  }
  if (!c.ok) { fail(`${c.name}: expected ${c.error}: ${c.message}`); continue; }
  const bp = out as BoxplotResult;
  for (const k of Object.keys(c.counts ?? {})) {
    const got = (bp as unknown as Record<string, unknown[]>)[k]?.length;
    if (got !== (c.counts ?? {})[k]) fail(`${c.name}: ${k} length ${got} want ${(c.counts ?? {})[k]}`);
  }
  // settle view limits
  ax.fig.toScene();
  const meta = ax.fig.meta[0];
  const xlim = meta.x.lim, ylim = meta.y.lim;
  if (c.xlim && (!close(xlim[0], c.xlim[0]) || !close(xlim[1], c.xlim[1]))) fail(`${c.name}: xlim ${xlim} want ${c.xlim}`);
  if (c.ylim && (!close(ylim[0], c.ylim[0]) || !close(ylim[1], c.ylim[1]))) fail(`${c.name}: ylim ${ylim} want ${c.ylim}`);
  if (c.xticks && (meta.x.ticks.length !== c.xticks.length || meta.x.ticks.some((t, i) => !close(t, (c.xticks ?? [])[i])))) {
    fail(`${c.name}: xticks ${meta.x.ticks} want ${c.xticks}`);
  }
  if (c.yticks && (meta.y.ticks.length !== c.yticks.length || meta.y.ticks.some((t, i) => !close(t, (c.yticks ?? [])[i])))) {
    fail(`${c.name}: yticks ${meta.y.ticks} want ${c.yticks}`);
  }
  if (c.xticklabels && meta.x.labels.join('|') !== c.xticklabels.join('|')) {
    fail(`${c.name}: xticklabels ${JSON.stringify(meta.x.labels)} want ${JSON.stringify(c.xticklabels)}`);
  }
  if (c.yticklabels && meta.y.labels.join('|') !== c.yticklabels.join('|')) {
    fail(`${c.name}: yticklabels ${JSON.stringify(meta.y.labels)} want ${JSON.stringify(c.yticklabels)}`);
  }
  if (c.median0 && bp.medians[0]) {
    if (!sameArr(bp.medians[0].x, c.median0.x) || !sameArr(bp.medians[0].y, c.median0.y)) {
      fail(`${c.name}: median0 x=${[...bp.medians[0].x]} y=${[...bp.medians[0].y]} want x=${c.median0.x} y=${c.median0.y}`);
    }
  }
  if (c.fliers0 && bp.fliers[0]) {
    // fliers along the value axis
    const vert = kwargs['orientation'] !== 'horizontal' && kwargs['vert'] !== false;
    const vals = vert ? bp.fliers[0].y : bp.fliers[0].x;
    if (!sameArr(vals, c.fliers0)) fail(`${c.name}: fliers0 ${[...vals]} want ${c.fliers0}`);
  }
}

// API shape extras the oracle can't show
{
  const [, ax] = subplots();
  const r = ax.boxplot([[1, 2, 3, 4, 5], [2, 3, 4, 5, 6, 20]]);
  if (r.boxes.length !== 2 || r.medians.length !== 2 || r.whiskers.length !== 4 || r.caps.length !== 4) {
    fail(`shape: boxes=${r.boxes.length} medians=${r.medians.length} whiskers=${r.whiskers.length} caps=${r.caps.length}`);
  }
  const patch = ax.boxplot([1, 2, 3], { patch_artist: true });
  if (patch.boxes[0].kind !== 'polygon') fail('patch_artist boxes should be polygons');
  try { ax.boxplot([1, 2, 3], { bootstrap: 500 }); fail('bootstrap must throw'); }
  catch (e) { if (!(e instanceof TypeError)) fail(`bootstrap: ${String(e)}`); }
}

if (fails > 0) { console.log(`boxplot: ${fails} failure(s)`); process.exit(1); }
console.log(`boxplot: ${oracle.cases.length} matplotlib cases exact, plus API shape checks`);
