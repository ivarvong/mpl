// Numeric oracle for colormaps and norms against fixtures/colormap_oracle.json (matplotlib 3.11.2).
import { readFileSync } from 'node:fs';
import {
  applyNorm, availableColormaps, getColormap, logNorm, mapBytes, normalize, registerColormapRgba, registerColormaps, twoSlopeNorm,
} from '../src/core/colormap.ts';
import { unwrap as unwrapR } from '../src/core/types.ts';
import { allColormaps } from '../src/colormaps/all.ts';
import { allColormapRgba } from '../src/colormaps/all.rgba.ts';
registerColormaps(...allColormaps);
registerColormapRgba(...allColormapRgba);

type Oracle = {
  bytes_xs: (number | string)[];
  bytes: Record<string, number[][]>;
  e2e_viridis_norm: { xs: (number | string)[]; rgba: number[][] };
  e2e_plasma_log: { xs: (number | string)[]; rgba: number[][] };
  e2e_coolwarm_twoslope: { xs: (number | string)[]; rgba: number[][] };
  listed_tab10: { xs: number[]; rgba: number[][] };
  normalize: { vmin: number; vmax: number; xs: (number | string)[]; out: (number | string)[] };
  lognorm: { vmin: number; vmax: number; xs: (number | string)[]; out: (number | string)[] };
  twoslope: { vmin: number; vcenter: number; vmax: number; xs: (number | string)[]; out: (number | string)[] };
};
const oracle: Oracle = JSON.parse(readFileSync(new URL('../fixtures/colormap_oracle.json', import.meta.url), 'utf8'));

const num = (s: number | string): number =>
  (typeof s === 'number' ? s : s === 'nan' ? NaN : s === 'inf' ? Infinity : s === '-inf' ? -Infinity : Number(s));

let fails = 0;
const fail = (msg: string): void => { fails++; console.log(`FAIL ${msg}`); };

const sameRgba = (got: Uint8Array, want: number[][], label: string): void => {
  if (got.length !== want.length * 4) { fail(`${label}: length ${got.length} want ${want.length * 4}`); return; }
  for (let i = 0; i < want.length; i++) {
    const w = want[i];
    if (got[i * 4] !== w[0] || got[i * 4 + 1] !== w[1] || got[i * 4 + 2] !== w[2] || got[i * 4 + 3] !== w[3]) {
      fail(`${label}[${i}]: got [${got[i * 4]},${got[i * 4 + 1]},${got[i * 4 + 2]},${got[i * 4 + 3]}] want ${w}`);
      return;
    }
  }
};

/** Bit-identical to matplotlib's float output (Object.is), including ±0 and NaN. */
const sameNorm = (got: Float64Array, want: (number | string)[], label: string): void => {
  if (got.length !== want.length) { fail(`${label}: length`); return; }
  for (let i = 0; i < want.length; i++) {
    const w = num(want[i]), g = got[i];
    if (!Object.is(g, w) && !(Number.isNaN(g) && Number.isNaN(w))) {
      fail(`${label}[${i}]: got ${g} want ${w}`);
      return;
    }
  }
};

{
  const cmap = unwrapR(getColormap('viridis'));
  const xs = oracle.e2e_viridis_norm.xs.map(num);
  const mid = new Float64Array(xs.length);
  applyNorm(normalize(0, 1), xs, mid);
  const out = new Uint8Array(xs.length * 4);
  mapBytes(cmap, mid, out);
  sameRgba(out, oracle.e2e_viridis_norm.rgba, 'e2e_viridis_norm');
}
{
  const cmap = unwrapR(getColormap('plasma'));
  const xs = oracle.e2e_plasma_log.xs.map(num);
  const mid = new Float64Array(xs.length);
  applyNorm(logNorm(1, 1000), xs, mid);
  const out = new Uint8Array(xs.length * 4);
  mapBytes(cmap, mid, out);
  sameRgba(out, oracle.e2e_plasma_log.rgba, 'e2e_plasma_log');
}
{
  const cmap = unwrapR(getColormap('coolwarm'));
  const xs = oracle.e2e_coolwarm_twoslope.xs.map(num);
  const mid = new Float64Array(xs.length);
  applyNorm(twoSlopeNorm(-2, 0, 4), xs, mid);
  const out = new Uint8Array(xs.length * 4);
  mapBytes(cmap, mid, out);
  sameRgba(out, oracle.e2e_coolwarm_twoslope.rgba, 'e2e_coolwarm_twoslope');
}
{
  const cmap = unwrapR(getColormap('tab10'));
  const xs = oracle.listed_tab10.xs;
  const out = new Uint8Array(xs.length * 4);
  mapBytes(cmap, xs, out);
  sameRgba(out, oracle.listed_tab10.rgba, 'listed_tab10');
}

// Every shipped colormap and its _r over the dense+random grid
{
  const xs = oracle.bytes_xs.map(num);
  const names = availableColormaps();
  let nOk = 0;
  for (const name of names) {
    const want = oracle.bytes[name];
    if (!want) { fail(`bytes oracle missing ${name}`); continue; }
    const cmap = unwrapR(getColormap(name));
    const out = new Uint8Array(xs.length * 4);
    mapBytes(cmap, xs, out);
    const before = fails;
    sameRgba(out, want, `bytes_${name}`);
    if (fails === before) nOk++;
  }
  console.log(`bytes oracle: ${nOk}/${names.length} colormaps exact over ${xs.length} samples`);
}

{
  const o = oracle.normalize;
  const mid = new Float64Array(o.xs.length);
  applyNorm(normalize(o.vmin, o.vmax), o.xs.map(num), mid);
  sameNorm(mid, o.out, 'normalize');
}
{
  const o = oracle.lognorm;
  const mid = new Float64Array(o.xs.length);
  applyNorm(logNorm(o.vmin, o.vmax), o.xs.map(num), mid);
  sameNorm(mid, o.out, 'lognorm');
}
{
  const o = oracle.twoslope;
  const mid = new Float64Array(o.xs.length);
  applyNorm(twoSlopeNorm(o.vmin, o.vcenter, o.vmax), o.xs.map(num), mid);
  sameNorm(mid, o.out, 'twoslope');
}

if (fails > 0) { console.log(`colormap: ${fails} failure(s)`); process.exit(1); }
console.log('colormap: e2e + fuzz + norms exact vs matplotlib 3.11.2');
