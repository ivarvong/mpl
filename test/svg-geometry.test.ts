// mpl's SVG geometry against matplotlib 3.11.2's own SVG (fixtures/ref/<case>.svg, linux/amd64). At 72 dpi
// matplotlib's SVG units (pt) are mpl's px, so path coordinates compare directly: mpl writes 4 decimals and
// matplotlib 6, so coordinates match to 6e-5 and commands exactly.
//  - Line2D paths (by stroke colour): the SVG backend flips with the float canvas height and PathClipper clips to
//    the float canvas ±1, where Agg uses its int height.
import { readFileSync } from 'node:fs';
import { build, loadFixture } from '../tools/replay.ts';

const REF = new URL('../fixtures/ref/', import.meta.url).pathname;
type Cmd = readonly [string, number, number];
const parse = (d: string): Cmd[] => [...d.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])] as const);
const same = (a: readonly Cmd[], b: readonly Cmd[]): boolean =>
  a.length === b.length && a.every((v, k) => v[0] === b[k][0] && Math.abs(v[1] - b[k][1]) <= 6e-5 && Math.abs(v[2] - b[k][2]) <= 6e-5);

/** matplotlib's SVG: every Line2D path stroked in `hex` (style="fill: none; stroke: #…"). */
const refLines = (svg: string, hex: string): Cmd[][] =>
  [...svg.matchAll(/<path d="([^"]*)"[^>]*style="fill: none; stroke: (#[0-9a-f]{6})[^"]*"/g)].filter((m) => m[2] === hex).map((m) => parse(m[1]));
/** mpl's SVG: every unfilled path stroked in `hex`. */
const ourLines = (svg: string, hex: string): Cmd[][] =>
  [...svg.matchAll(/<path d="([^"]*)" fill="none" stroke="(#[0-9a-f]{6})"/g)].filter((m) => m[2] === hex).map((m) => parse(m[1]));

const LINE_CASES: readonly { readonly name: string; readonly colors: readonly string[] }[] = [
  { name: 'frac_canvas_svg_clip', colors: ['#d62728', '#2ca02c'] },
];

let failed = 0, checked = 0;
for (const c of LINE_CASES) {
  const ref = readFileSync(REF + c.name + '.svg', 'utf8');
  const ours = build(loadFixture(c.name)).toSVG();
  for (const hex of c.colors) {
    checked++;
    const want = refLines(ref, hex), got = ourLines(ours, hex);
    if (!(want.length === got.length && want.every((p, i) => same(p, got[i])))) {
      failed++;
      console.log(`FAIL ${c.name} ${hex}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
    }
  }
}
console.log(`svg-geometry: ${checked - failed}/${checked} match matplotlib's SVG`);
if (failed > 0) process.exit(1);
