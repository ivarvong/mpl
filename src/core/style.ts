// Style sheets: matplotlib .mplstyle text -> RcLayer, and composition of layers.
//   DEFAULTS < style sheet(s) < per-figure rc < per-artist kwargs
import { STYLELIB } from './data/stylelib.ts';
import { DEFAULTS, mergeLayers } from './rc.ts';
import type { RcLayer, RcValue } from './rc.ts';
import { lookup } from './std.ts';
import type { Result } from './types.ts';
import { err, ok } from './types.ts';

export type StyleSpec =
  | { readonly kind: 'bundled'; readonly name: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'layer'; readonly layer: RcLayer };

const TRUE = new Set(['true', 't', 'yes', 'y', 'on', '1']);
const FALSE = new Set(['false', 'f', 'no', 'n', 'off', '0']);

/** Coerce a raw string by the type of the key's default. Unknown keys stay strings. */
function coerce(key: string, raw: string): Result<RcValue> {
  const v = raw.trim();
  if (key === 'axes.prop_cycle') return parsePropCycle(v);
  const d = lookup(DEFAULTS, key);
  if (d.kind === 'none') return ok(v);
  const dv = d.value;
  if (typeof dv === 'boolean') {
    const l = v.toLowerCase();
    if (TRUE.has(l)) return ok(true);
    if (FALSE.has(l)) return ok(false);
    // keys like axes.axisbelow default to a string but accept bools; handled by the theme parser
    return err(`${key}: expected bool, got ${v}`);
  }
  if (typeof dv === 'number') {
    if (key.endsWith('size') && /^[a-z-]+$/i.test(v)) return ok(v);   // font size aliases
    if (key === 'hist.bins' && /^[a-z]+$/.test(v)) return ok(v);      // an estimator name
    const n = Number(v);
    return Number.isFinite(n) ? ok(n) : err(`${key}: expected number, got ${v}`);
  }
  if (Array.isArray(dv)) {
    const parts = v.replace(/^[[(]|[\])]$/g, '').split(',').map((p) => p.trim()).filter((p) => p.length > 0);
    if (dv.length > 0 && typeof dv[0] === 'number') {
      const nums = parts.map(Number);
      return nums.every(Number.isFinite) ? ok(nums) : err(`${key}: expected number list, got ${v}`);
    }
    return ok(parts);
  }
  if (key.endsWith('size') && v !== '' && Number.isFinite(Number(v))) return ok(Number(v));
  return ok(v);
}

/** cycler('color', ['E24A33', '348ABD']) -> ['#e24a33', '#348abd'] */
export function parsePropCycle(v: string): Result<RcValue> {
  const m = /cycler\(\s*['"]color['"]\s*,\s*\[([^\]]*)\]\s*\)/.exec(v);
  if (!m) return err(`axes.prop_cycle: only cycler('color', [...]) is supported, got ${v}`);
  const cols = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).map((c) => (/^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : c));
  return cols.length > 0 ? ok(cols) : err('axes.prop_cycle: empty cycle');
}

// '#' starts a comment unless it begins a 3/6/8-digit hex color token.
function stripComment(s: string): string {
  let i = s.indexOf('#');
  while (i >= 0) {
    const m = /^#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/.exec(s.slice(i));
    if (!m) return s.slice(0, i).trim();
    i = s.indexOf('#', i + m[0].length);
  }
  return s.trim();
}

/** Parse .mplstyle / matplotlibrc text. */
export function parseStyle(text: string): Result<RcLayer> {
  const out = new Map<string, RcValue>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    if (line === '') continue;
    const idx = line.indexOf(':');
    if (idx < 0) return err(`line ${i + 1}: expected "key : value"`);
    const r = coerce(line.slice(0, idx).trim(), line.slice(idx + 1));
    if (!r.ok) return err(`line ${i + 1}: ${r.error}`);
    out.set(line.slice(0, idx).trim(), r.value);
  }
  return ok(out);
}

export function bundledStyle(name: string): Result<RcLayer> {
  const text = lookup(STYLELIB, name);
  if (text.kind === 'none') return err(`unknown style ${JSON.stringify(name)}; bundled: ${[...STYLELIB.keys()].join(', ')}`);
  return parseStyle(text.value);
}

/** Compose DEFAULTS and style layers; later wins. */
export function composeStyles(specs: readonly StyleSpec[]): Result<RcLayer> {
  const layers: RcLayer[] = [DEFAULTS];
  for (const s of specs) {
    switch (s.kind) {
      case 'layer': layers.push(s.layer); break;
      case 'text': { const r = parseStyle(s.text); if (!r.ok) return r; layers.push(r.value); break; }
      case 'bundled': { const r = bundledStyle(s.name); if (!r.ok) return r; layers.push(r.value); break; }
    }
  }
  return ok(mergeLayers(layers));
}

export const availableStyles = (): readonly string[] => [...STYLELIB.keys()];
