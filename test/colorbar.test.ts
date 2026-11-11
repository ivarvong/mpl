// Colorbar under LogNorm (issue #65) against fixtures/colorbar_oracle.json (matplotlib 3.11.2): band edges, view
// limits and colour indices exactly, the long axis' LogLocator ticks and labels, and the typed errors.
import { readFileSync } from 'node:fs';
import { colorbarBands } from '../src/core/colorbar.ts';
import { registerColormaps, subplots } from '../src/index.ts';
import { allColormaps } from '../src/colormaps/all.ts';
registerColormaps(...allColormaps);

type Case = { vmin: number; vmax: number; cmap: string; N: number; edges: number[]; lim: number[]; index: number[]; ticks: number[]; labels: string[]; minor: number[] };
const oracle: Case[] = JSON.parse(readFileSync(new URL('../fixtures/colorbar_oracle.json', import.meta.url), 'utf8'));
let fails = 0, checks = 0, maxUlp = 0;
const check = (ok: boolean, msg: string): void => { checks++; if (!ok) { fails++; console.log(`FAIL ${msg}`); } };
const ulp = (v: number): number => 2 ** (Math.floor(Math.log2(Math.abs(v))) - 52);
const sameList = <T>(a: readonly T[], b: readonly T[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

for (const c of oracle) {
  const tag = `LogNorm(${c.vmin}, ${c.vmax})`;
  const bands = colorbarBands({ kind: 'log', vmin: c.vmin, vmax: c.vmax }, c.N);
  check(bands.scale === 'log', `${tag}: scale`);
  // Edges go through np.exp twice (LogNorm.inverse, then _mesh's round trip through the norm). numpy dispatches float64
  // exp by CPU: on the AVX512_SKX machine that wrote this oracle it is Intel SVML's vector exp (~1 ulp, not correctly
  // rounded); elsewhere it is libm's. mpl uses its correctly rounded libm.exp, as scale.ts does for every log axis, so
  // an edge's last bits depend on the machine that ran matplotlib, and the round trip (log10, then exp(t·ln10) with t
  // up to ~28) multiplies one ulp several times. Edges are held to 16 ulp (the worst seen is printed); the band
  // pixels (fixtures/ref/colorbar_lognorm*), the limits, the colour indices and the ticks are exact.
  const ulps = Array.from(bands.edges, (v, i) => Math.abs(v - c.edges[i]) / ulp(c.edges[i]));
  const worst = Math.max(...ulps);
  maxUlp = Math.max(maxUlp, worst);
  check(bands.edges.length === c.edges.length && worst <= 16, `${tag}: an edge is ${worst} ulp from matplotlib's`);
  check(sameList(bands.lim, c.lim), `${tag}: lim ${JSON.stringify(bands.lim)} want ${JSON.stringify(c.lim)}`);
  const index = Array.from(bands.colorAt, (x) => Math.min(c.N - 1, Math.max(0, Math.floor(x * c.N))));
  check(sameList(index, c.index), `${tag}: colour index differs at ${index.findIndex((v, i) => v !== c.index[i])}`);
  // the whole path: imshow(norm='log') + fig.colorbar, then the cax's long axis as laid out
  const [fig, ax] = subplots();
  const im = ax.imshow([[c.vmin, c.vmax]], { cmap: c.cmap, norm: 'log', vmin: c.vmin, vmax: c.vmax });
  fig.colorbar(im, { ax });
  fig.toSVG();
  const y = fig.meta[1].y;
  check(sameList(y.lim, c.lim), `${tag}: cax ylim ${JSON.stringify(y.lim)} want ${JSON.stringify(c.lim)}`);
  check(sameList(y.ticks, c.ticks), `${tag}: ticks ${JSON.stringify(y.ticks)} want ${JSON.stringify(c.ticks)}`);
  check(sameList(y.labels, c.labels), `${tag}: labels ${JSON.stringify(y.labels)} want ${JSON.stringify(c.labels)}`);
  check(sameList(y.minor, c.minor), `${tag}: minor ${JSON.stringify(y.minor)} want ${JSON.stringify(c.minor)}`);
}

// typed errors: a LogNorm needs positive limits, given or found in the data
const throwsRange = (f: () => unknown, what: string): void => {
  try { f(); check(false, `${what}: did not throw`); } catch (e) { check(e instanceof RangeError, `${what}: threw ${(e as Error).name}: ${(e as Error).message}`); }
};
throwsRange(() => colorbarBands({ kind: 'log', vmin: 0, vmax: 10 }, 256), 'colorbarBands vmin=0');
throwsRange(() => colorbarBands({ kind: 'log', vmin: 10, vmax: 10 }, 256), 'colorbarBands vmin=vmax');
throwsRange(() => { const [, ax] = subplots(); ax.imshow([[0, -1], [-2, 0]], { norm: 'log' }); }, 'imshow LogNorm, no positive data');
throwsRange(() => { const [, ax] = subplots(); ax.scatter([0, 1], [0, 1], { c: [-1, 0], norm: 'log' }); }, 'scatter LogNorm, no positive data');

if (fails > 0) { console.log(`colorbar: ${fails} of ${checks} checks failed`); process.exit(1); }
console.log(`colorbar: ${oracle.length} LogNorm cases exact vs matplotlib 3.11.2 (limits, colours, ticks; edges within ${maxUlp} ulp), typed errors; ${checks} checks ok`);
