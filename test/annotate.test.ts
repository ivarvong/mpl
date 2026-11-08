// Annotated SVG (fig.toSVG({ interactive: true })), in Node:
//  1. byte identity: every fixture's default SVG is unchanged by the option machinery, and the annotated SVG is
//     the default SVG plus whole inserted lines (axes wrappers and sidecars) and nothing else;
//  2. the sidecar's data ↔ pixel mapping round-trips through the client's own inverse (src/interactive/client.ts)
//     for linear, log, date, category and inverted axes, twinx and subplots, and its pixel points are the drawn ones;
//  3. decimation keeps extremes; legend boxes sit in the legend; XML-hostile labels survive; ids prefix cleanly.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerSidecar, subplots } from '../src/index.ts';
import type { Figure } from '../src/index.ts';
import { MAX_POINTS, sidecar } from '../src/annotate.ts';
import type { AxesInfo } from '../src/interactive/client.ts';
import { dataToPixel, formatValue, nearest, parseSidecar, pixelToData, unitOf } from '../src/interactive/client.ts';
import { build, loadFixture } from '../tools/replay.ts';

let checks = 0;
const unxml = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sidecars = (svg: string): AxesInfo[] => [...svg.matchAll(/<metadata class="mpl-axes">([^<]*)<\/metadata>/g)].map((m) => parseSidecar(unxml(m[1])));

/** The annotated SVG minus whole inserted lines must be the plain SVG; returns how many wrappers it skipped. */
function insertedOnly(plain: string, rich: string): number {
  const P = plain.split('\n'), R = rich.split('\n');
  let i = 0, j = 0, opened = 0, closed = 0;
  while (j < R.length) {
    if (i < P.length && P[i] === R[j]) { i++; j++; continue; }
    if (/^<g data-mpl-axes="\d+">$/.test(R[j]) && /^<metadata class="mpl-axes">[^<]*<\/metadata>$/.test(R[j + 1] ?? '')) { opened++; j += 2; continue; }
    if (R[j] === '</g>' && closed < opened) { closed++; j++; continue; }
    throw new Error(`annotated SVG differs beyond inserted lines at line ${j}: ${R[j].slice(0, 80)}`);
  }
  assert.equal(i, P.length, 'plain SVG fully consumed');
  assert.equal(opened, closed, 'every wrapper closed');
  return opened;
}

// ---- 0. the writer is opt-in: without registerSidecar, interactive: true says what to import (plain SVG still works)
{
  const [fig, ax] = subplots();
  ax.plot([1, 2], [3, 4]);
  assert.throws(() => fig.toSVG({ interactive: true }), /import \{ sidecar \} from 'mpl\/annotate'/);
  assert.ok(fig.toSVG().startsWith('<svg'));
  registerSidecar(sidecar);
  checks += 2;
}

// ---- 1. byte identity over every fixture
const names: string[] = JSON.parse(readFileSync(new URL('../fixtures/ref/_index.json', import.meta.url), 'utf8'));
for (const n of names) {
  const fig = build(loadFixture(n));
  const plain = fig.toSVG();
  assert.equal(fig.toSVG({}), plain, `${n}: toSVG({})`);
  assert.equal(fig.toSVG({ interactive: false }), plain, `${n}: interactive: false`);
  const rich = fig.toSVG({ interactive: true });
  assert.equal(insertedOnly(plain, rich), fig.axes.length, `${n}: one wrapper per Axes`);
  assert.equal(fig.toSVG(), plain, `${n}: an annotated render leaves the next plain one unchanged`);
  assert.deepEqual(sidecars(rich).map((sc) => sc.a.length), fig.axes.map((ax) => ax.artists.length), `${n}: one sidecar entry per artist`);
  checks += 4;
}
// svgChunks / svgStream take the same keywords
{
  const fig = build(loadFixture(names[0]));
  const plain = [...fig.svgChunks()].join(''), rich = [...fig.svgChunks({ interactive: true })].join('');
  assert.equal(insertedOnly(plain, rich), fig.axes.length, 'svgChunks: annotated = plain + inserted lines');
  const streamed = await new Response(fig.svgStream({ interactive: true })).text();
  assert.equal(streamed, [...fig.svgChunks({ interactive: true })].join(''));
  checks += 3;
}

// ---- 2. data ↔ pixel round trips
/** Every point: pixel → data through the client's inverse is the data value (to the pixel rounding), and back. */
function roundTrip(name: string, fig: Figure, k: number): AxesInfo {
  const sc = sidecars(fig.toSVG({ interactive: true }))[k];
  let pts = 0;
  for (const a of sc.a) {
    for (let j = 0; j < a.p.length / 2; j++) {
      for (const [w, o] of [['x', 0], ['y', 1]] as const) {
        const d = a.d[2 * j + o], p = a.p[2 * j + o], axis = w === 'x' ? sc.x : sc.y;
        // 0.006 px of rounding in the sidecar, as data on this axis at this point
        const back = pixelToData(sc, w, p), tol = Math.abs(pixelToData(sc, w, p + 0.006) - back) + 1e-12 * Math.max(1, Math.abs(d));
        assert.ok(Math.abs(back - d) <= tol, `${name} ${w}: pixel ${p} → ${back}, data ${d} (tol ${tol}, ${axis.s})`);
        assert.ok(Math.abs(dataToPixel(sc, w, d) - p) <= 0.006, `${name} ${w}: data ${d} → ${dataToPixel(sc, w, d)}, pixel ${p}`);
        pts++;
      }
    }
  }
  assert.ok(pts > 0, `${name}: has points`);
  checks += pts;
  return sc;
}
{ // linear, and the pixel points are the vertices actually drawn
  const [fig, ax] = subplots();
  ax.plot([0, 1, 2, 3.5], [2, -1, 4, 0.25], { label: 'zig' });
  const sc = roundTrip('linear', fig, 0);
  assert.equal(sc.x.s, 'linear');
  const d = /<path d="([^"]*)" fill="none" stroke="#1f77b4"/.exec(fig.toSVG());
  assert.ok(d, 'line path');
  const verts = [...d[1].matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  sc.a[0].p.forEach((v, i) => assert.ok(Math.abs(v - verts[i >> 1][i & 1]) <= 0.006, `drawn vertex ${i}: ${v} vs ${verts[i >> 1][i & 1]}`));
  assert.equal(sc.a[0].l, 'zig'); assert.equal(sc.a[0].c, '#1f77b4'); assert.equal(sc.a[0].s, 'x');
}
{ // log on both axes
  const [fig, ax] = subplots();
  ax.plot([1, 10, 100, 1000], [3, 30, 3000, 2]); ax.set_xscale('log'); ax.set_yscale('log');
  const sc = roundTrip('log', fig, 0);
  assert.deepEqual([sc.x.s, sc.x.b, sc.y.s, sc.y.b], ['log', 10, 'log', 10]);
}
{ // dates: matplotlib date numbers, days since 1970
  const [fig, ax] = subplots();
  const t = [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 3, 12), Date.UTC(2026, 1, 1)];
  ax.plot(t.map((v) => new Date(v)), [1, 3, 2]);
  const sc = roundTrip('dates', fig, 0);
  assert.equal(sc.x.s, 'date');
  assert.deepEqual(sc.a[0].d.filter((_, i) => i % 2 === 0), t.map((v) => v / 864e5));
}
{ // inverted axes
  const [fig, ax] = subplots();
  ax.scatter([1, 2, 3], [5, 6, 9]); ax.set_xlim(4, 0); ax.set_ylim(10, 0);
  const sc = roundTrip('inverted', fig, 0);
  assert.equal(sc.x.lim[0] > sc.x.lim[1] && sc.y.lim[0] > sc.y.lim[1], true);
  const a = sc.a[0];
  assert.ok(a.p[0] > a.p[2] && a.p[1] < a.p[3], 'larger x is further left, larger y further down');
}
{ // twinx: two Axes, one box, own y scales
  const [fig, ax] = subplots();
  ax.bar([1, 2, 3], [10, 1000, 100]); ax.set_yscale('log');
  const tw = ax.twinx(); tw.plot([1, 2, 3], [0.1, 0.5, 0.2], 'o-');
  const host = roundTrip('twinx host', fig, 0), twin = roundTrip('twinx twin', fig, 1);
  assert.deepEqual(host.box, twin.box);
  assert.equal(host.y.s, 'log'); assert.equal(twin.y.s, 'linear');
  assert.equal(host.a[0].s, 'x'); assert.ok(host.a[0].b.length === 0, 'bars from 0 carry no bases');
}
{ // subplots, categories, horizontal bars, steps
  const [fig, [l, r]] = subplots(1, 2);
  l.barh(['a', 'b', 'c'], [3, 1, 2], { left: [1, 1, 1] });
  r.step([0, 1, 2, 3], [1, 3, 2, 4], { where: 'mid' });
  const L = roundTrip('subplots left', fig, 0), R = roundTrip('subplots right', fig, 1);
  assert.ok(L.box[2] < R.box[0], 'left Axes is left of right Axes');
  assert.deepEqual([L.y.s, [...L.y.names]], ['cat', ['a', 'b', 'c']]);
  assert.deepEqual([L.a[0].s, [...L.a[0].b], L.a[0].d.slice(0, 2)], ['y', [1, 1, 1], [4, 0]]);
  assert.equal(R.a[0].ds, 'mid');
  // nearest: barh snaps on y; the closest bar end wins
  const hit = nearest(L.a, L.a[0].p[2] - 50, L.a[0].p[3] + 1);
  assert.equal(hit[0].j, 1);
}

// ---- 3. decimation, legend boxes, reference lines, XML-hostile labels, keywords, id prefixes
{
  const n = 100_000, xs = Array.from({ length: n }, (_, i) => i), ys = xs.map((i) => Math.sin(i / 300) + (i === 77_777 ? 9 : 0) - (i === 12_345 ? 7 : 0));
  const [fig, ax] = subplots();
  ax.plot(xs, ys);
  const a = sidecars(fig.toSVG({ interactive: true }))[0].a[0];
  assert.ok(a.p.length / 2 <= MAX_POINTS, `decimated to ${a.p.length / 2}`);
  const yv = a.d.filter((_, i) => i % 2 === 1);
  assert.ok(Math.max(...yv) > 9 && Math.min(...yv) < -7, 'spikes survive decimation');
  assert.match(fig.toSVG({ interactive: true }), /"n":100000/);
  checks += 3;
}
{
  const [fig, ax] = subplots();
  ax.plot([0, 1], [0, 1], { label: 'a</metadata>&"<b>' });
  ax.scatter([0.5], [0.5], { label: 'pts' });
  ax.axvline(0.3, { label: 'ref' });
  ax.text(0.2, 0.8, 'note');
  ax.legend();
  const svg = fig.toSVG({ interactive: true }), sc = sidecars(svg)[0];
  assert.equal(sc.a[0].l, 'a</metadata>&"<b>');
  assert.equal(svg.match(/<\/metadata>/g)?.length, 1, 'a label cannot close the metadata element');
  assert.deepEqual(sc.a.map((a) => [a.k, a.p.length]), [['line', 4], ['scatter', 2], ['line', 0], ['text', 0]]);
  assert.deepEqual(sc.lg.map((e) => e[0]), [0, 1, 2], 'legend entries name their artists, in legend order');
  const m = fig.meta[0].legend;
  assert.ok(m.kind === 'some');
  for (const [, x0, y0, x1, y1] of sc.lg) assert.ok(x0 >= m.value.x0 - 0.01 && x1 <= m.value.x1 + 0.01 && y0 >= m.value.top - 0.01 && y1 <= m.value.bottom + 0.01, 'entry inside the legend');
  assert.ok(sc.lg[1][2] > sc.lg[0][2], 'entries go down');
  checks += 6;
}
{ // a bar is a legend container: listed after the children, and its entry still names it
  const [fig, ax] = subplots();
  ax.plot([0, 1], [0, 1], { label: 'line' }); ax.bar([0.5], [0.4], { label: 'bar' }); ax.scatter([0.2], [0.8], { label: 'pts' });
  ax.legend();
  assert.deepEqual(sidecars(fig.toSVG({ interactive: true }))[0].lg.map((e) => e[0]), [0, 2, 1]);
  checks++;
}
{
  const [fig, ax] = subplots({ rc: { 'svg.fonttype': 'path' } });
  ax.plot([1, 2], [3, 4], 'o-'); ax.set_title('ids');
  assert.throws(() => fig.toSVG({ interactive: 1 }), /interactive must be a bool/);
  assert.throws(() => fig.toSVG({ interactiv: true }), /unexpected keyword argument 'interactiv'/);
  assert.throws(() => fig.toSVG({ idPrefix: 'a b' }), /idPrefix must be an XML name/);
  const svg = fig.toSVG({ interactive: true, idPrefix: 'p1-' });
  const ids = [...svg.matchAll(/ id="([^"]+)"/g)].map((x) => x[1]), refs = [...svg.matchAll(/(?:href="#|url\(#)([^")]+)/g)].map((x) => x[1]);
  assert.ok(ids.length > 3 && ids.every((i) => i.startsWith('p1-')), 'every id prefixed');
  assert.ok(refs.every((r) => ids.includes(r)), 'every reference resolves');
  assert.equal(new Set(ids).size, ids.length, 'ids unique');
  checks += 6;
}
// ---- 4. composes with toSVG({ precision }): the annotated SVG is the precision SVG plus inserted lines, and the
// sidecar's pixel points sit on the precision-rounded vertices (exactly at precision 0–2, within 0.005 px at 3–4)
/** Absolute vertices of compact or default path data (M, L, relative l; '-' and '.5' number forms), in integer units of 10^-dp. */
const verts = (dd: string, dp: number): string[] => {
  const p = 10 ** dp, out: string[] = [];
  let cmd = 'M', x = 0, y = 0;
  const toks = dd.match(/[MLl]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  for (let i = 0; i < toks.length;) {
    if (/[MLl]/.test(toks[i])) { cmd = toks[i]; i++; continue; }
    const a = Math.round(Number(toks[i]) * p), b = Math.round(Number(toks[i + 1]) * p);
    i += 2;
    if (cmd === 'l') { x += a; y += b; } else { x = a; y = b; }
    out.push(`${x},${y}`);
  }
  return out;
};
const make = (): Figure => {
  const [fig, ax] = subplots();
  const t = Array.from({ length: 100 }, (_, i) => i / 3.3);   // < 128 vertices: no PathSimplifier, every point is drawn
  ax.plot(t, t.map((v) => Math.sin(v) * 3.3 + v / 7));
  ax.plot([1, 2, 5, 9], [1, 4, 2, 6], 'o', { color: 'C3' });
  return fig;
};
{
  for (const precision of [0, 1, 2, 3, 4]) {
    const fig = make(), plain = fig.toSVG({ precision }), rich = fig.toSVG({ precision, interactive: true });
    assert.equal(insertedOnly(plain, rich), 1, `precision ${precision}: annotated = precision SVG + inserted lines`);
    const sc = sidecars(rich)[0], dp = Math.min(2, precision), p = 10 ** precision;
    const line = /<path d="(M[^"]*)" fill="none" stroke="#1f77b4"/.exec(rich);
    assert.ok(line);
    const drawn = new Set(verts(line[1], precision));
    let exact = 0;
    for (let j = 0; j < sc.a[0].p.length / 2; j++) {
      const x = sc.a[0].p[2 * j], y = sc.a[0].p[2 * j + 1];
      if (precision <= 2) { assert.ok(drawn.has(`${Math.round(x * p)},${Math.round(y * p)}`), `precision ${precision}: (${x}, ${y}) is a drawn vertex`); exact++; }
      else assert.ok([...drawn].some((v) => { const [a, b] = v.split(',').map(Number); return Math.abs(a / p - x) <= 0.005 + 1e-9 && Math.abs(b / p - y) <= 0.005 + 1e-9; }), `precision ${precision}: (${x}, ${y}) within 0.005 px`);
    }
    // markers: Agg snaps marker positions to pixel centres, floor(v + 0.5) + 0.5 (as matplotlib does), so a <use> sits
    // within 1 px of the exact transform, plus the precision's and the sidecar's rounding
    const uses = [...rich.matchAll(/<use href="#[^"]+" x="([^"]+)" y="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    const mtol = 1 + 0.5 / p + 0.5 / 10 ** dp + 1e-9;
    for (let j = 0; j < sc.a[1].p.length / 2; j++) {
      const x = sc.a[1].p[2 * j], y = sc.a[1].p[2 * j + 1], u = uses[j];
      assert.ok(Math.abs(u[0] - x) <= mtol && Math.abs(u[1] - y) <= mtol, `precision ${precision}: marker (${x}, ${y}) vs drawn (${u.join(', ')})`);
    }
    assert.equal(sc.a[0].p.every((v) => Math.round(v * 10 ** dp) / 10 ** dp === v), true, `pixels at ${dp} decimals`);
    checks += 3 + exact;
  }
}
const u = (s: string): readonly string[] => { const r = unitOf(s); return [r.plain, r.muted, r.name]; };
// ---- 6. value text: dates at their own resolution, numbers to the axis' resolution, units read off the axis label
{
  const t0 = Date.UTC(2026, 10, 5, 8, 40) / 864e5;
  const axis = { s: 'date', lim: [t0 - 1, t0 + 1], b: 10, names: [], px: 400, g: 0, t: '', step: 1 / 1440 } as const;
  // 08:40 stored to the sidecar's 12 significant digits used to print 08:39:59.999
  assert.equal(formatValue(Number(t0.toPrecision(12)), axis, 'x', true), 'Nov 5, 08:40');
  assert.equal(formatValue(t0, { ...axis, step: 1 }, 'x', true), 'Nov 5');
  assert.equal(formatValue(t0, { ...axis, step: 1 / 86400 }, 'x', true), 'Nov 5, 08:40:00');
  assert.equal(formatValue(t0, { ...axis, step: 30 }, 'x', true), 'Nov 2026');
  assert.equal(formatValue(t0, { ...axis, step: 365 }, 'x', true), '2026');
  assert.equal(formatValue(t0, { ...axis, step: 1, lim: [Date.UTC(2025, 11, 20) / 864e5, Date.UTC(2026, 0, 20) / 864e5] }, 'x', true), 'Nov 5, 2026', 'the year when the axis crosses one');
  const lin = { s: 'linear', lim: [40, 90], b: 10, names: [], px: 300, g: 0, t: '', step: 0 } as const;
  assert.equal(formatValue(75.6199, lin, 'y', true), '75.6');
  assert.equal(formatValue(72, lin, 'y', true), '72');
  assert.equal(formatValue(0.012345, { ...lin, lim: [0, 1000] }, 'y', true), '0.0123', 'at least 3 significant digits');
  assert.equal(formatValue(-0.0001, { ...lin, lim: [-1, 1], px: 10 }, 'y', true), '-0.0001');
  assert.equal(formatValue(0, lin, 'y', true), '0');
  const log = { ...lin, s: 'log', lim: [1, 10000] } as const;
  assert.equal(formatValue(75.6199, log, 'y', true), '75.6');
  assert.equal(formatValue(9000.4, log, 'y', true), '9000');
  assert.deepEqual(u('ms'), ['ms', '', '']);
  assert.deepEqual(u('latency (ms)'), ['ms', '', 'latency']);
  assert.deepEqual(u('Latency [ms]'), ['ms', '', 'Latency']);
  assert.deepEqual(u('requests / s'), ['', 'requests / s', '']);
  assert.deepEqual(u('requests (log)'), ['', '', 'requests']);
  assert.deepEqual(u('p99 ms'), ['', '', 'p99 ms']);
  assert.deepEqual(u('CPU'), ['', '', 'CPU']);
  assert.deepEqual(u('%'), ['%', '', '']);
  // the sidecar carries the label
  const [fl, al] = subplots();
  al.plot([1, 2], [3, 4]);
  al.set_ylabel('latency (ms)');
  const sc6 = sidecars(fl.toSVG({ interactive: true }))[0];
  assert.deepEqual([sc6.y.t, sc6.x.t], ['latency (ms)', '']);
}

console.log(`annotate: ${names.length} fixtures byte-identical by default, annotated = default + inserted lines; ${checks} checks ok`);
