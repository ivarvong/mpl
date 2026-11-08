// mpl's SVG geometry against matplotlib 3.11.2's own SVG (fixtures/ref/<case>.svg, linux/amd64). At 72 dpi
// matplotlib's SVG units (pt) are mpl's px, so coordinates compare directly: mpl writes 4 decimals and matplotlib 6,
// so they match to 6e-5 and path commands exactly.
//  - The SVG backend flips with the float canvas height and PathClipper clips lines to the float canvas ± 1, where
//    Agg uses its int height (frac_canvas_svg_clip).
//  - It never pixel-snaps: no PathSnapper, and draw_markers writes each marker at its exact offset (svg_nosnap). mpl's
//    PNG keeps Agg's snapping; only the SVG layout drops it.
// Legend geometry compares to LEGEND_TOL px, not 6e-5. matplotlib's SVG backend measures text with TextToPath
// (FT2Font at 100 pt / 72 dpi, NO_HINTING, scaled to the font size), where Agg and mpl use FT2Font at the font size
// and figure dpi. The legend box is sized from its labels' extents, so matplotlib's SVG legend is 0.0156 px wider and
// 0.0031 px taller than its Agg one in svg_nosnap; every handle moves with it. mpl lays out text as Agg does.
const LEGEND_TOL = 0.02;
import { readFileSync } from 'node:fs';
import { build, loadFixture } from '../tools/replay.ts';

const REF = new URL('../fixtures/ref/', import.meta.url).pathname;
type Cmd = readonly [string, ...number[]];
const parse = (d: string): Cmd[] => [...d.matchAll(/([MLQCZz])([^MLQCZz]*)/g)]
  .map((m) => [m[1].toUpperCase(), ...m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)] as Cmd);
let tol = 6e-5;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= tol;
const samePath = (a: readonly Cmd[], b: readonly Cmd[]): boolean =>
  a.length === b.length && a.every((v, k) => v[0] === b[k][0] && v.length === b[k].length && v.every((x, j) => j === 0 || near(x as number, b[k][j] as number)));
const samePts = (a: readonly (readonly [number, number])[], b: readonly (readonly [number, number])[]): boolean =>
  a.length === b.length && a.every((p, i) => near(p[0], b[i][0]) && near(p[1], b[i][1]));
/** the first n elements exactly (the Axes' own artists), the rest (the legend's) to LEGEND_TOL */
function split<T>(got: readonly T[], want: readonly T[], n: number, same: (a: T, b: T) => boolean): boolean {
  if (got.length !== want.length) return false;
  const exact = tol;
  const ok = got.every((g, i) => { tol = i < n ? exact : LEGEND_TOL; return same(g, want[i]); });
  tol = exact;
  return ok;
}
/** a path split at each MOVETO: matplotlib draws each gridline or tick as its own element, mpl one path per family */
const subpaths = (ps: readonly Cmd[][]): Cmd[][] => ps.flatMap((p) => {
  const out: Cmd[][] = [];
  for (const c of p) { if (c[0] === 'M' || out.length === 0) out.push([]); out[out.length - 1].push(c); }
  return out;
});
const attr = (tag: string, name: string): string => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? '';

// ---- matplotlib's SVG: <path d style> and <use xlink:href x y style>, outside the glyph and marker <defs>
type RefPath = { readonly d: Cmd[]; readonly style: string };
function refPaths(svg: string): RefPath[] {
  const body = svg.replace(/<defs>[\s\S]*?<\/defs>/g, '');
  return [...body.matchAll(/<path d="([^"]*)"[^>]*?style="([^"]*)"/g)].map((m) => ({ d: parse(m[1]), style: m[2] }));
}
const refUses = (svg: string, style: RegExp): [number, number][] =>
  [...svg.matchAll(/<use xlink:href="#m[^"]*" x="([^"]*)" y="([^"]*)" style="([^"]*)"/g)].filter((m) => style.test(m[3])).map((m) => [Number(m[1]), Number(m[2])]);

// ---- mpl's SVG: <path d ...attrs>, <rect>, and <use href x y> of a <defs><path id fill stroke>
type OurPath = { readonly d: Cmd[]; readonly tag: string };
const ourPaths = (svg: string): OurPath[] => [...svg.replace(/<defs>[\s\S]*?<\/defs>/g, '').matchAll(/<path d="([^"]*)"[^>]*>/g)].map((m) => ({ d: parse(m[1]), tag: m[0] }));
const ourRects = (svg: string, fill: string): [number, number, number, number][] =>
  [...svg.matchAll(/<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"[^>]*>/g)].filter((m) => attr(m[0], 'fill') === fill).map((m) => [+m[1], +m[2], +m[3], +m[4]]);
function ourUses(svg: string, fill: string): [number, number][] {
  const ids = new Set([...svg.matchAll(/<defs><path id="([^"]*)" d="[^"]*"([^>]*)\/><\/defs>/g)].filter((m) => attr(m[2], 'fill') === fill).map((m) => m[1]));
  return [...svg.matchAll(/<use href="#([^"]*)" x="([^"]*)" y="([^"]*)"\/>/g)].filter((m) => ids.has(m[1])).map((m) => [Number(m[2]), Number(m[3])]);
}
/** a rectangle path M L L L z → its four corners (matplotlib writes bars and spans as paths) */
const corners = (d: readonly Cmd[]): [number, number][] => d.filter((c) => c[0] !== 'Z').slice(0, 4).map((c) => [c[1] as number, c[2] as number]);
const rectCorners = (r: readonly [number, number, number, number]): [number, number][] => {
  const [x, y, w, h] = r;
  return [[x, y + h], [x + w, y + h], [x + w, y], [x, y]];
};
const sortPts = (p: [number, number][]): [number, number][] => p.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);

let failed = 0, checked = 0;
function check(what: string, ok: boolean, got: unknown, want: unknown): void {
  checked++;
  if (!ok) { failed++; console.log(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
}
const lineStroke = (hex: string) => (s: string): boolean => s.startsWith(`fill: none; stroke: ${hex}`) && !s.includes('stroke-linecap: square; stroke-linejoin: miter');

for (const name of ['frac_canvas_svg_clip', 'svg_nosnap']) {
  const ref = readFileSync(REF + name + '.svg', 'utf8');
  const ours = build(loadFixture(name)).toSVG();
  const rp = refPaths(ref), op = ourPaths(ours);
  const ourStroked = (hex: string, pred: (tag: string) => boolean = () => true): Cmd[][] =>
    op.filter((p) => attr(p.tag, 'fill') === 'none' && attr(p.tag, 'stroke') === hex && pred(p.tag)).map((p) => p.d);
  const refStroked = (pred: (s: string) => boolean): Cmd[][] => rp.filter((p) => pred(p.style)).map((p) => p.d);

  // Line2D paths (data lines, axhline/axvline, legend handles, gridlines) by stroke colour
  // (count: subpaths drawn in the Axes; the rest are legend handles)
  const colours: readonly (readonly [string, number])[] = name === 'svg_nosnap'
    ? [['#1f77b4', 1], ['#9467bd', 1], ['#8c564b', 1], ['#e377c2', 1], ['#b0b0b0', 16]] : [['#d62728', 4], ['#2ca02c', 0]];
  for (const [hex, n] of colours) {
    const want = subpaths(refStroked(lineStroke(hex))), got = subpaths(ourStroked(hex, (t) => attr(t, 'stroke-linejoin') === 'round'));
    check(`${name} lines ${hex}`, split(got, want, n, samePath), got, want);
  }
  if (name !== 'svg_nosnap') continue;

  // spines: Spine paths (miter join, square cap) — left, right, bottom, top
  {
    const want = refStroked((s) => s === 'fill: none; stroke: #000000; stroke-width: 0.8; stroke-linejoin: miter; stroke-linecap: square');
    const got = ourStroked('#000000', (t) => attr(t, 'stroke-linecap') === 'square');
    check(`${name} spines`, want.length === got.length && want.every((p, i) => samePath(p, got[i])), got, want);
  }
  // tick marks: matplotlib's <use> origins; mpl's tick paths start each mark at its origin (direction 'out')
  {
    const want = refUses(ref, /^stroke: #000000; stroke-width: 0\.8$/);
    const got = subpaths(ourStroked('#000000', (t) => attr(t, 'stroke-linecap') === '')).map((p): [number, number] => [p[0][1] as number, p[0][2] as number]);
    check(`${name} tick origins`, samePts(got, want), got, want);
    const ticks = subpaths(ourStroked('#000000', (t) => attr(t, 'stroke-linecap') === ''));
    const len = ticks.map((p) => Math.hypot((p[1][1] as number) - (p[0][1] as number), (p[1][2] as number) - (p[0][2] as number)));
    check(`${name} tick length 3.5`, len.every((l) => near(l, 3.5)), len, 3.5);
  }
  // the axes patch (second white fill), bars and the axvspan. mpl writes these as <rect x y width height>, so a
  // far corner (x + width) carries two 4-decimal roundings: 1.1e-4.
  {
    tol = 1.1e-4;
    const white = rp.filter((p) => p.style === 'fill: #ffffff').map((p) => corners(p.d));
    const got = ourRects(ours, '#ffffff').map(rectCorners);
    check(`${name} axes patch`, samePts(sortPts(got[0] ?? []), sortPts(white[1])), got[0], white[1]);
    const bars = rp.filter((p) => p.style.startsWith('fill: #ff7f0e')).map((p) => sortPts(corners(p.d)));
    const ourBars = ourRects(ours, '#ff7f0e').map((r) => sortPts(rectCorners(r)));
    check(`${name} bars`, split(ourBars, bars, 3, samePts), ourBars, bars);
    const span = rp.filter((p) => p.style.startsWith('fill: #bcbd22')).map((p) => sortPts(corners(p.d)));
    const ourSpan = ourRects(ours, '#bcbd22').map((r) => sortPts(rectCorners(r)));
    check(`${name} axvspan`, span.length === ourSpan.length && span.every((b, i) => samePts(b, ourSpan[i])), ourSpan, span);
    tol = 6e-5;
  }
  // markers: line 'o' markers and the scatter squares, data then legend, at their exact offsets
  for (const [hex, style, n] of [['#1f77b4', /^fill: #1f77b4; stroke: #1f77b4$/, 4], ['#17becf', /^fill: #17becf; stroke: #000000$/, 3]] as const) {
    const want = refUses(ref, style), got = ourUses(ours, hex);
    check(`${name} markers ${hex}`, split(got.map((p) => [p]), want.map((p) => [p]), n, samePts), got, want);
  }
  // the legend frame (FancyBboxPatch, rounded)
  {
    const want = rp.filter((p) => p.style.startsWith('fill: #ffffff; opacity: 0.8; stroke: #cccccc')).map((p) => p.d);
    const got = op.filter((p) => attr(p.tag, 'stroke') === '#cccccc').map((p) => p.d);
    check(`${name} legend frame (to ${LEGEND_TOL} px)`, split(got, want, 0, samePath), got, want);
  }
}
console.log(`svg-geometry: ${checked - failed}/${checked} match matplotlib's SVG`);
if (failed > 0) process.exit(1);
