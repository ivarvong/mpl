// Colormaps and norms, matching matplotlib.colors (3.11.2): LUT lookup, Normalize,
// LogNorm, TwoSlopeNorm, and Colormap.__call__(…, bytes=True).
// Each face of LUT data is its own module under src/colormaps/; viridis is built in.
import { viridis } from '../colormaps/viridis.ts';
import { CMAP_NAMES } from './data/colormaps.ts';
import { log10 } from './libm.ts';
import { isPlainObject, lookup, prop } from './std.ts';
import type { Option, Paint, Result, Rgb } from './types.ts';
import { assertNever, err, none, ok, some } from './types.ts';

/** Packed LUT: trunc RGBA×(N+3) then round RGBA×(N+3), base64. */
export type CmapPack = { readonly name: string; readonly N: number; readonly b64: string };

/** A baked colormap: N LUT entries plus under / over / bad. */
export type Colormap = {
  readonly name: string;
  readonly N: number;
  /** bytes=True (trunc): RGBA uint8, length 4·(N+3) */
  readonly trunc: Uint8Array;
  /** Agg/SVG (round): RGBA uint8, length 4·(N+3) */
  readonly round: Uint8Array;
};

const hex2 = (v: number): string => v.toString(16).padStart(2, '0');
const fromB64 = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const registry = new Map<string, Colormap>();

function bake(pack: CmapPack): Colormap {
  const raw = fromB64(pack.b64);
  const half = 4 * (pack.N + 3);
  if (raw.length !== 2 * half) throw new Error(`colormap ${pack.name}: packed length ${raw.length}, want ${2 * half}`);
  return { name: pack.name, N: pack.N, trunc: raw.subarray(0, half), round: raw.subarray(half) };
}

function revLut(src: Uint8Array, N: number): Uint8Array {
  const lut = new Uint8Array(4 * (N + 3));
  for (let i = 0; i < N; i++) {
    const s = (N - 1 - i) * 4, d = i * 4;
    lut[d] = src[s]; lut[d + 1] = src[s + 1]; lut[d + 2] = src[s + 2]; lut[d + 3] = src[s + 3];
  }
  const u = N * 4, o = (N + 1) * 4, b = (N + 2) * 4;
  for (let k = 0; k < 4; k++) { lut[u + k] = src[o + k]; lut[o + k] = src[u + k]; lut[b + k] = src[b + k]; }
  return lut;
}

function reversedOf(c: Colormap): Colormap {
  return {
    name: c.name.endsWith('_r') ? c.name.slice(0, -2) : `${c.name}_r`,
    N: c.N, trunc: revLut(c.trunc, c.N), round: revLut(c.round, c.N),
  };
}

function put(c: Colormap): void {
  registry.set(c.name, c);
  const rev = reversedOf(c);
  registry.set(rev.name, rev);
}

/** Register one or more colormap packs (each `src/colormaps/*.ts` export). Viridis is built in. */
export function registerColormaps(...packs: readonly CmapPack[]): void {
  for (const p of packs) put(bake(p));
}

// Built-in: viridis (matplotlib's default for ScalarMappable)
registerColormaps(viridis);

/** matplotlib.pyplot.get_cmap. Unknown or unregistered names error with the import to add. */
export function getColormap(name: string): Result<Colormap> {
  const hit = lookup(registry, name);
  if (hit.kind === 'some') return ok(hit.value);
  const base = name.endsWith('_r') ? name.slice(0, -2) : name;
  if (!CMAP_NAMES.some((n) => n === base)) {
    return err(`Unknown colormap name '${name}'. Available: ${CMAP_NAMES.join(', ')} (and _r)`);
  }
  const mod = base === 'RdBu' ? 'rdBu' : base.toLowerCase() === base ? base : base[0].toLowerCase() + base.slice(1);
  // Greys/Blues file names are lowercased
  const file = base === 'RdBu' ? 'rdBu' : base.toLowerCase();
  return err(`Colormap '${name}' is not registered. Import it and registerColormaps(…): `
    + `import { ${mod === 'rdBu' ? 'rdBu' : file} } from 'mpljs/colormaps/${file}'`);
}

export const availableColormaps = (): readonly string[] =>
  [...CMAP_NAMES, ...CMAP_NAMES.map((n) => `${n}_r`)];

export const registeredColormaps = (): readonly string[] => [...registry.keys()].toSorted();

/** RGBA uint8 → Paint (hex + alpha in [0,1]). Fully transparent → none. */
export function rgbaToPaint(r: number, g: number, b: number, a: number): Paint {
  if (a === 0) return { kind: 'none' };
  return { kind: 'solid', color: { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a / 255 } };
}

export function rgbaToRgb(r: number, g: number, b: number, a: number): Rgb {
  return { hex: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha: a / 255 };
}

function lutIndex(cmap: Colormap, x: number): number {
  const { N } = cmap;
  if (Number.isNaN(x)) return N + 2;
  let xa = x * N;
  if (xa === N) xa = N - 1;
  if (xa < 0) return N;
  if (xa >= N) return N + 1;
  return xa | 0;
}

/** Colormap.__call__(X, bytes=True). */
export function mapBytes(cmap: Colormap, xs: ArrayLike<number>, out: Uint8Array): Uint8Array {
  const { trunc } = cmap;
  for (let i = 0; i < xs.length; i++) {
    const s = lutIndex(cmap, xs[i]) * 4, o = i * 4;
    out[o] = trunc[s]; out[o + 1] = trunc[s + 1]; out[o + 2] = trunc[s + 2]; out[o + 3] = trunc[s + 3];
  }
  return out;
}

/** Convenience: one float → RGBA uint8 tuple (bytes=True). */
export function mapOneBytes(cmap: Colormap, x: number): readonly [number, number, number, number] {
  const buf = new Uint8Array(4);
  mapBytes(cmap, [x], buf);
  return [buf[0], buf[1], buf[2], buf[3]];
}

/** Map normalized floats to Paint[] using Agg's rounded uint8 LUT. */
export function mapPaints(cmap: Colormap, xs: ArrayLike<number>): readonly Paint[] {
  const { round } = cmap;
  const out: Paint[] = [];
  for (let i = 0; i < xs.length; i++) {
    const s = lutIndex(cmap, xs[i]) * 4;
    out.push(rgbaToPaint(round[s], round[s + 1], round[s + 2], round[s + 3]));
  }
  return out;
}

// ---------------------------------------------------------------- norms

export type Norm =
  | { readonly kind: 'linear'; readonly vmin: number; readonly vmax: number; readonly clip: boolean }
  | { readonly kind: 'log'; readonly vmin: number; readonly vmax: number; readonly clip: boolean }
  | { readonly kind: 'twoslope'; readonly vmin: number; readonly vcenter: number; readonly vmax: number; readonly clip: boolean };

export const normalize = (vmin: number, vmax: number, clip = false): Norm => ({ kind: 'linear', vmin, vmax, clip });
export const logNorm = (vmin: number, vmax: number, clip = false): Norm => ({ kind: 'log', vmin, vmax, clip });
export const twoSlopeNorm = (vmin: number, vcenter: number, vmax: number, clip = false): Norm =>
  ({ kind: 'twoslope', vmin, vcenter, vmax, clip });

export function autoscaleNorm(n: Norm, data: ArrayLike<number>): Norm {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (n.kind === 'log' && !(v > 0)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!(lo <= hi)) { lo = 0; hi = 1; }
  switch (n.kind) {
    case 'linear':
      return { kind: 'linear', vmin: Number.isFinite(n.vmin) ? n.vmin : lo, vmax: Number.isFinite(n.vmax) ? n.vmax : hi, clip: n.clip };
    case 'log':
      return { kind: 'log', vmin: Number.isFinite(n.vmin) ? n.vmin : lo, vmax: Number.isFinite(n.vmax) ? n.vmax : hi, clip: n.clip };
    case 'twoslope':
      return n;
    default: return assertNever(n);
  }
}

export function applyNorm(n: Norm, xs: ArrayLike<number>, out: Float64Array): Float64Array {
  const len = xs.length;
  switch (n.kind) {
    case 'linear': {
      const { vmin, vmax, clip } = n;
      if (vmin === vmax) { for (let i = 0; i < len; i++) out[i] = Number.isNaN(xs[i]) ? NaN : 0; return out; }
      if (vmin > vmax) throw new Error('minvalue must be less than or equal to maxvalue');
      const span = vmax - vmin;
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        out[i] = (v - vmin) / span;
      }
      return out;
    }
    case 'log': {
      const { vmin, vmax, clip } = n;
      if (vmin > vmax) throw new Error('vmin must be less or equal to vmax');
      if (vmin === vmax) { for (let i = 0; i < len; i++) out[i] = Number.isNaN(xs[i]) ? NaN : 0; return out; }
      const tMin = log10(vmin), tMax = log10(vmax);
      if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) throw new Error('Invalid vmin or vmax');
      const span = tMax - tMin;
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        const t = log10(v);
        out[i] = Number.isFinite(t) ? (t - tMin) / span : NaN;
      }
      return out;
    }
    case 'twoslope': {
      const { vmin, vcenter, vmax, clip } = n;
      if (!(vmin < vcenter && vcenter < vmax)) throw new Error('vmin, vcenter, and vmax must be in ascending order');
      for (let i = 0; i < len; i++) {
        let v = xs[i];
        if (Number.isNaN(v)) { out[i] = NaN; continue; }
        if (clip) v = v < vmin ? vmin : v > vmax ? vmax : v;
        if (v < vmin) out[i] = -Infinity;
        else if (v > vmax) out[i] = Infinity;
        else if (v < vcenter) out[i] = 0.5 * (v - vmin) / (vcenter - vmin);
        else out[i] = 0.5 + 0.5 * (v - vcenter) / (vmax - vcenter);
      }
      return out;
    }
    default: return assertNever(n);
  }
}

export function scalarToPaints(cmap: Colormap, norm: Norm, data: ArrayLike<number>): readonly Paint[] {
  const n = autoscaleNorm(norm, data);
  const mid = new Float64Array(data.length);
  applyNorm(n, data, mid);
  return mapPaints(cmap, mid);
}

export function parseColormap(v: unknown): Result<Colormap> {
  if (typeof v !== 'string') return err(`cmap must be a colormap name string, got ${typeof v}`);
  return getColormap(v);
}

export function parseNormKw(opts: {
  readonly vmin: Option<number>; readonly vmax: Option<number>;
  readonly norm: Option<unknown>;
}): Result<Norm> {
  const vmin = opts.vmin.kind === 'some' ? opts.vmin.value : NaN;
  const vmax = opts.vmax.kind === 'some' ? opts.vmax.value : NaN;
  if (opts.norm.kind === 'none') return ok(normalize(vmin, vmax, false));
  const n = opts.norm.value;
  if (n === 'linear') return ok(normalize(vmin, vmax, false));
  if (n === 'log') {
    if (!Number.isFinite(vmin) || !Number.isFinite(vmax)) return err('LogNorm requires vmin and vmax');
    return ok(logNorm(vmin, vmax, false));
  }
  if (isPlainObject(n)) {
    const kindO = prop(n, 'kind');
    const kind = kindO.kind === 'some' ? kindO.value : 'linear';
    const numProp = (k: string): Option<number> => {
      const p = prop(n, k);
      return p.kind === 'some' && typeof p.value === 'number' ? some(p.value) : none;
    };
    const clipP = prop(n, 'clip');
    const clip = clipP.kind === 'some' && clipP.value === true;
    const lo = numProp('vmin'); const hi = numProp('vmax');
    if (kind === 'linear') return ok(normalize(lo.kind === 'some' ? lo.value : vmin, hi.kind === 'some' ? hi.value : vmax, clip));
    if (kind === 'log') {
      const a = lo.kind === 'some' ? lo.value : vmin, b = hi.kind === 'some' ? hi.value : vmax;
      if (!Number.isFinite(a) || !Number.isFinite(b)) return err('LogNorm requires vmin and vmax');
      return ok(logNorm(a, b, clip));
    }
    if (kind === 'twoslope') {
      const vc = numProp('vcenter');
      if (lo.kind === 'none' || vc.kind === 'none' || hi.kind === 'none') return err('TwoSlopeNorm requires vmin, vcenter, vmax');
      return ok(twoSlopeNorm(lo.value, vc.value, hi.value, clip));
    }
  }
  return err(`norm must be 'linear', 'log', or { kind, vmin, vmax, … }, got ${JSON.stringify(n)}`);
}

export function isNumericColorArray(v: unknown): v is ArrayLike<number> {
  if (v instanceof Float64Array || v instanceof Float32Array) return true;
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((x) => typeof x === 'number');
}

export { CMAP_NAMES };
