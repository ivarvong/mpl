// Axes.pie against matplotlib itself (fixtures/pie_oracle.json, written by fixtures/generate_pie_oracle.py):
// Path.arc and Wedge paths bit for bit, pie()'s wedges, shadows and texts, the axes state it leaves, Python's
// printf-style autopct strings, and the errors it raises.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pyPercentFormat, pyStrFormat, unitArc, wedgePath } from '../src/core/pie.ts';
import { none, some } from '../src/core/types.ts';
import type { Paint, Rgb, TextArtist, WedgeArtist } from '../src/core/types.ts';
import { registerFonts, subplots } from '../src/index.ts';
import { dejavuSansBold } from '../src/fonts/dejavu-sans-bold.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();
registerFonts(dejavuSansBold);   // the 'props' pie's bold textprops

type PathRec = { x: string[]; y: string[]; codes: number[] };
type TextRec = { x: string; y: string; s: string; ha: string; va: string; rotation: string; size: string; color: string; weight: string; clip: boolean };
type WedgeRec =
  | { shadow: false; cx: string; cy: string; r: string; theta1: string; theta2: string; width: string | null; face: string[]; edge: string[]; lw: string; label: string; zorder: string; clip: boolean }
  | { shadow: true; of: number; face: string[]; edge: string[]; lw: string; zorder: string; ox: string; oy: string };
type PieRec = {
  name: string; x: number[]; kw: Record<string, unknown>; wedges: WedgeRec[]; texts: TextRec[]; autotexts: TextRec[]; fracs: string[];
  aspect: number; frame_on: boolean; xlim: string[]; ylim: string[]; xticks: string[]; yticks: string[]; legend: string[];
};
type Oracle = {
  matplotlib: string;
  arcs: (PathRec & { theta1: number; theta2: number })[];
  wedges: (PathRec & { center: [number, number]; r: number; theta1: number; theta2: number; width?: number })[];
  formats: { fmt: string; value: string; out: string }[];
  pies: PieRec[];
  errors: { name: string; x: (number | { $float: string })[]; kw: Record<string, unknown>; error: { type: string; message: string } }[];
  strformats: ({ fmt: string; dtype: 'int' | 'float'; value: number | string } & ({ out: string } | { error: { type: string; message: string } }))[];
  pie_labels: { name: string; x: number[]; pie: Record<string, unknown>; calls: { labels: string | string[]; kw: Record<string, unknown> }[]; texts: TextRec[][] }[];
  label_errors: { name: string; x: number[]; labels: string | string[]; kw: Record<string, unknown>; error: { type: string; message: string } }[];
  label_strings: ({ x: number[]; dtype: 'int64' | 'float64'; labels: string; pie: Record<string, unknown> } & ({ out: string[] } | { error: { type: string; message: string } }))[];
};
const oracle: Oracle = JSON.parse(readFileSync(new URL('../fixtures/pie_oracle.json', import.meta.url), 'utf8'));
assert.equal(oracle.matplotlib, '3.11.2');

let checks = 0;
const bits = (got: number, want: string, what: string): void => { assert.ok(Object.is(got, Number(want)), `${what}: got ${got}, want ${want}`); checks++; };
const samePath = (got: { xs: Float64Array; ys: Float64Array; codes: Uint8Array }, want: PathRec, what: string): void => {
  assert.deepEqual([...got.codes], want.codes, `${what}: codes`);
  assert.equal(got.xs.length, want.x.length, `${what}: vertex count`);
  want.x.forEach((v, i) => bits(got.xs[i], v, `${what} x[${i}]`));
  want.y.forEach((v, i) => bits(got.ys[i], v, `${what} y[${i}]`));
};

// Path.arc and Wedge._recompute_path
for (const a of oracle.arcs) samePath(unitArc(a.theta1, a.theta2), a, `arc(${a.theta1}, ${a.theta2})`);
for (const w of oracle.wedges) {
  const width = typeof w.width === 'number' ? some(w.width) : none;
  samePath(wedgePath(w.center[0], w.center[1], w.r, w.theta1, w.theta2, width), w, `wedge(${w.theta1}, ${w.theta2}, width ${w.width})`);
}

// autopct % value: Python's printf-style formatting, correctly rounded half to even
for (const f of oracle.formats) {
  const got = pyPercentFormat(f.fmt, Number(f.value));
  assert.ok(got.ok, `${f.fmt} % ${f.value}: ${got.ok ? '' : got.error}`);
  assert.equal(got.value, f.out, `${JSON.stringify(f.fmt)} % ${f.value}`);
  checks++;
}
assert.ok(!pyPercentFormat('no conversion', 1).ok, 'a format without a conversion is "not all arguments converted"');
assert.ok(!pyPercentFormat('%f %f', 1).ok, 'two conversions need two arguments');

// pie(): wedges, shadows, texts and the axes state
const rgba8 = (f: string[]): string => '#' + f.slice(0, 3).map((v) => Math.round(Number(v) * 255).toString(16).padStart(2, '0')).join('');
const samePaint = (got: Paint, want: string[], what: string): void => {
  if (Number(want[3]) === 0) { assert.ok(got.kind === 'none' || got.color.alpha === 0, `${what}: want transparent`); checks++; return; }
  assert.equal(got.kind, 'solid', `${what}: kind`);
  if (got.kind !== 'solid') return;
  assert.equal(got.color.hex, rgba8(want), `${what}: rgb`);
  assert.equal(got.color.alpha, Number(want[3]), `${what}: alpha`);
  checks++;
};
const sameRgb = (got: Rgb, want: string, what: string): void => {
  assert.equal(got.hex, want.slice(0, 7), `${what}: rgb`);
  assert.equal(Math.round(got.alpha * 255), parseInt(want.slice(7, 9), 16), `${what}: alpha`);
  checks++;
};
const WEIGHTS: Readonly<Record<string, number>> = { normal: 400, bold: 700 };
const sameText = (got: TextArtist, want: TextRec, what: string): void => {
  bits(got.x, want.x, `${what}.x`); bits(got.y, want.y, `${what}.y`);
  assert.equal(got.text, want.s, `${what}.text`);
  assert.equal(got.ha, want.ha, `${what}.ha`); assert.equal(got.va, want.va, `${what}.va`);
  bits(got.rotation, want.rotation, `${what}.rotation`);
  bits(got.sizePt, want.size, `${what}.size`);
  sameRgb(got.color, want.color, `${what}.color`);
  assert.equal(got.weight, WEIGHTS[want.weight], `${what}.weight`);
  assert.equal(got.clip, want.clip, `${what}.clip`);
};

for (const p of oracle.pies) {
  const [fig, ax] = subplots();
  const res = ax.pie(p.x, p.kw);
  const wedges = ax.artists.filter((a): a is WedgeArtist => a.kind === 'wedge');
  assert.equal(wedges.length, p.wedges.length, `${p.name}: patch count`);
  p.wedges.forEach((want, i) => {
    const got = wedges[i], what = `${p.name} patch ${i}`;
    samePaint(got.face, want.face, `${what}.face`);
    if (Number(want.lw) > 0) samePaint(got.edge.kind === 'on' ? { kind: 'solid', color: got.edge.color } : { kind: 'none' }, want.edge, `${what}.edge`);
    else assert.equal(got.edge.kind, 'none', `${what}: lw 0 draws no edge`);
    if (got.edge.kind === 'on') bits(got.edge.widthPt, want.lw, `${what}.lw`);
    bits(got.zorder, want.zorder, `${what}.zorder`);
    if (want.shadow) {
      const of = wedges[want.of];
      assert.ok(got.shift.kind === 'some', `${what}: a shadow is shifted`);
      if (got.shift.kind === 'some') { bits(got.shift.value.oxPt, want.ox, `${what}.ox`); bits(got.shift.value.oyPt, want.oy, `${what}.oy`); }
      assert.deepEqual([got.cx, got.cy, got.r, got.theta1, got.theta2, got.width], [of.cx, of.cy, of.r, of.theta1, of.theta2, of.width], `${what}: the shadow follows its wedge's path`);
      assert.equal(got.label.kind, 'none', `${what}: _nolegend_`);
    } else {
      bits(got.cx, want.cx, `${what}.cx`); bits(got.cy, want.cy, `${what}.cy`); bits(got.r, want.r, `${what}.r`);
      bits(got.theta1, want.theta1, `${what}.theta1`); bits(got.theta2, want.theta2, `${what}.theta2`);
      if (want.width === null) assert.equal(got.width.kind, 'none', `${what}.width`);
      else { assert.equal(got.width.kind, 'some', `${what}.width`); if (got.width.kind === 'some') bits(got.width.value, want.width, `${what}.width`); }
      assert.equal(got.label.kind === 'text' ? got.label.text : '', want.label.startsWith('_') ? '' : want.label, `${what}.label`);
      assert.equal(got.clip, want.clip, `${what}.clip`);
      assert.equal(got.shift.kind, 'none', `${what}: a wedge is not shifted`);
    }
  });
  assert.equal(res.wedges.length, p.wedges.filter((w) => !w.shadow).length, `${p.name}: PieContainer.wedges`);
  assert.equal(res.texts.length, p.texts.length, `${p.name}: label texts`);
  res.texts.forEach((t, i) => sameText(t, p.texts[i], `${p.name} text ${i}`));
  assert.equal(res.autotexts.length, p.autotexts.length, `${p.name}: autotexts`);
  res.autotexts.forEach((t, i) => sameText(t, p.autotexts[i], `${p.name} autotext ${i}`));
  p.fracs.forEach((f, i) => bits(res.fracs[i], f, `${p.name}.fracs[${i}]`));
  const spec = ax.spec();
  assert.equal(spec.aspect.kind, 'equal', `${p.name}: set_aspect('equal')`); assert.equal(p.aspect, 1);
  assert.equal(spec.frameOn, p.frame_on, `${p.name}: frame_on`);
  fig.toScene();
  const m = fig.meta[0];
  p.xlim.forEach((v, i) => bits(m.x.lim[i], v, `${p.name}.xlim[${i}]`));
  p.ylim.forEach((v, i) => bits(m.y.lim[i], v, `${p.name}.ylim[${i}]`));
  assert.deepEqual([m.x.ticks.length, m.y.ticks.length], [p.xticks.length, p.yticks.length], `${p.name}: no ticks`);
  const legend = res.wedges.flatMap((w) => (w.label.kind === 'text' ? [w.label.text] : []));
  assert.deepEqual(legend, p.legend, `${p.name}: legend handles`);
}

// errors, with matplotlib's messages
for (const e of oracle.errors) {
  const x = e.x.map((v) => (typeof v === 'number' ? v : Number(v.$float)));
  const [, ax] = subplots();
  assert.throws(() => ax.pie(x, e.kw), (err: unknown) => err instanceof Error && err.message === e.error.message, `${e.name}: ${e.error.message}`);
  checks++;
}

// pie_label: str.format labels on numpy int64/float64 values, as `labels.format(absval=v, frac=v)`
for (const f of oracle.strformats) {
  const v = { kind: f.dtype, value: Number(f.value) } as const;
  const got = pyStrFormat(f.fmt, { absval: v, frac: v });
  const what = `${JSON.stringify(f.fmt)}.format(${f.dtype} ${f.value})`;
  if ('out' in f) {
    assert.ok(got.ok, `${what}: ${got.ok ? '' : got.error}`);
    assert.equal(got.value, f.out, what);
  } else {
    assert.ok(!got.ok, `${what}: want ${f.error.type}: ${f.error.message}`);
    assert.equal(got.error, f.error.message, what);
  }
  checks++;
}

// pie_label's texts: position, alignment, rotation, size, colour and weight for each call on a pie() container
for (const p of oracle.pie_labels) {
  const [, ax] = subplots();
  const pc = ax.pie(p.x, p.pie);
  p.calls.forEach((c, k) => {
    const got = ax.pie_label(pc, c.labels, c.kw);
    assert.equal(got.length, p.texts[k].length, `${p.name} call ${k}: text count`);
    got.forEach((t, i) => sameText(t, p.texts[k][i], `${p.name} call ${k} text ${i}`));
  });
}
for (const e of oracle.label_errors) {
  const [, ax] = subplots();
  const pc = ax.pie(e.x);
  assert.throws(() => ax.pie_label(pc, e.labels, e.kw), (err: unknown) => err instanceof Error && err.message === e.error.message, `${e.name}: ${e.error.message}`);
  checks++;
}
{
  const [, ax] = subplots();
  const pc = ax.pie([1, 2]);
  assert.throws(() => ax.pie_label(pc, ['a', 'b'], { textprops: { rotation: 45 } }), TypeError);
  assert.throws(() => ax.pie_label(pc, 'x', { bogus: 1 }), TypeError);
  assert.throws(() => ax.pie_label(pc, '{absval!r}'), /not supported in mpl/);
  assert.throws(() => ax.pie_label({ wedges: [] } as never, ['a']), /PieContainer/);
}

// What mpl leaves out throws rather than drawing something matplotlib would not
{
  const [, ax] = subplots();
  assert.throws(() => ax.pie([1, 2], { frame: true }), TypeError);
  assert.throws(() => ax.pie([1, 2], { hatch: '//' }), TypeError);
  assert.throws(() => ax.pie([1, 2], { wedgeprops: { linestyle: '--' } }), TypeError);
  assert.throws(() => ax.pie([1, 2], { textprops: { rotation: 45 } }), TypeError);
  assert.throws(() => ax.pie([1, 2], { explode: [0, 0], bogus: 1 }), TypeError);
}
// autopct as a function: called with each percentage, its str() is the text
{
  const [, ax] = subplots();
  const seen: number[] = [];
  const res = ax.pie([1, 3], { autopct: (p: number) => { seen.push(p); return `${p.toFixed(0)} pct`; } });
  assert.deepEqual(seen, [25, 75]);
  assert.deepEqual(res.autotexts.map((t) => t.text), ['25 pct', '75 pct']);
}

// pie_label's strings by dtype: a plain array of whole numbers is numpy int64 (JS has no 10.0), a Float64Array is float64
for (const c of oracle.label_strings) {
  const [, ax] = subplots();
  const pc = ax.pie(c.dtype === 'float64' ? Float64Array.from(c.x) : c.x, c.pie);
  const what = `pie(${c.dtype} ${JSON.stringify(c.x)}, ${JSON.stringify(c.pie)}) ${JSON.stringify(c.labels)}`;
  if ('out' in c) assert.deepEqual(ax.pie_label(pc, c.labels).map((t) => t.text), c.out, what);
  else assert.throws(() => ax.pie_label(pc, c.labels), (err: unknown) => err instanceof Error && err.message === c.error.message, what);
  checks++;
}

console.log(`pie: ${checks} checks ok against matplotlib ${oracle.matplotlib} (${oracle.arcs.length} arcs, ${oracle.wedges.length} wedge paths, ${oracle.formats.length} autopct formats, ${oracle.pies.length} pies, ${oracle.errors.length} errors, ${oracle.strformats.length} str.format labels, ${oracle.pie_labels.length} pie_label cases, ${oracle.label_errors.length} pie_label errors, ${oracle.label_strings.length} pie_label dtype cases)`);
