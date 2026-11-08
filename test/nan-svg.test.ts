// plot() with NaN or ±Infinity: the SVG line path breaks exactly as matplotlib 3.11.2's does. PathNanRemover drops
// each non-finite vertex and starts the next finite one with a MOVETO, and dataLim skips the whole vertex.
// The expected `d` strings are matplotlib's own SVG (default rc, 72 dpi so SVG units are px), generated on
// linux/amd64. mpl writes 4 decimals and matplotlib 6, so coordinates compare to 6e-5 and commands exactly.
// One deliberate difference: mpl's SVG shares the Agg scene, so a path that Agg's PathSnapper snaps (SNAP_AUTO: every
// LINETO axis-aligned, which includes a path of lone MOVETOs) carries Agg's snapped coordinates. matplotlib's SVG
// backend never snaps. Such a case is marked `snapped`, and its expectation is matplotlib's d snapped as Agg does it:
// floor(v + 0.5) + 0, since a 1.5 px stroke rounds to an even width.
import { subplots } from '../src/index.ts';

const nan = NaN, inf = Infinity;
const CASES: readonly { readonly x: readonly number[]; readonly y: readonly number[]; readonly d: string; readonly snapped: boolean }[] = [
  { x: [0, 1, 2, 3, 4, 5], y: [0, 1, nan, 3, 4, 5], d: 'M 73.832727 295.488 L 138.763636 247.104 M 268.625455 150.336 L 333.556364 101.952 L 398.487273 53.568', snapped: false },
  { x: [0, 1, 2, 3, 4, 5, 6], y: [nan, 1, 2, nan, nan, 2, nan], d: 'M 73.832727 295.488 L 154.996364 53.568 M 398.487273 53.568', snapped: false },
  { x: [0, 1, nan, 3, 4], y: [1, 2, 3, 4, 5], d: 'M 73.832727 295.488 L 154.996364 235.008 M 317.323636 114.048 L 398.487273 53.568', snapped: false },
  { x: [0, 1, 2, 3], y: [1, inf, 2, 3], d: 'M 73.832727 295.488 M 290.269091 174.528 L 398.487273 53.568', snapped: false },
  { x: [0, 1, 2, 3, 4], y: [0, nan, 2, nan, 4], d: 'M 73.832727 295.488 M 236.16 174.528 M 398.487273 53.568', snapped: true },
  { x: [nan, nan], y: [nan, 1], d: '', snapped: false },
];

type Cmd = readonly [string, number, number];
const parse = (d: string): Cmd[] => [...d.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])] as const);
let failed = 0;
for (const c of CASES) {
  const [fig, ax] = subplots({ rc: { 'figure.dpi': 72 } });
  ax.plot([...c.x], [...c.y]);
  const svg = fig.toSVG();
  // the data line is the only C0 stroke
  const got = [...svg.matchAll(/<path d="([^"]*)" fill="none"[^>]*stroke="#1f77b4"/g)].map((m) => m[1]);
  const snap = (v: number): number => (c.snapped ? Math.floor(v + 0.5) : v);
  const want = c.d === '' ? [] : [parse(c.d).map((v): Cmd => [v[0], snap(v[1]), snap(v[2])])];
  const g = got.map(parse);
  const same = g.length === want.length && g.every((p, i) => p.length === want[i].length &&
    p.every((v, k) => v[0] === want[i][k][0] && Math.abs(v[1] - want[i][k][1]) <= 6e-5 && Math.abs(v[2] - want[i][k][2]) <= 6e-5));
  if (!same) { failed++; console.log(`FAIL y=[${c.y.join(', ')}]\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(c.d)}`); }
}
console.log(`nan-svg: ${CASES.length - failed}/${CASES.length} line paths match matplotlib's SVG`);
if (failed > 0) process.exit(1);
