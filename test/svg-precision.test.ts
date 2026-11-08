// toSVG({ precision }): opt-in compact path data (src/render/svg.ts PathData). Default output is unchanged.
import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import { fdp } from '../src/render/svg.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

// fdp(v, dp) is String(Math.round(v · 10^dp) / 10^dp)
let seed = 7;
const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
for (let dp = 0; dp <= 4; dp++) {
  const p = 10 ** dp, ref = (v: number): string => String(Math.round(v * p) / p);
  for (let k = -50000; k <= 50000; k++) for (const v of [k / p, (k + 0.5) / p, k / 1000 + 1e-7]) assert.equal(fdp(v, dp), ref(v), `fdp(${v}, ${dp})`);
  for (let i = 0; i < 50000; i++) { const v = (rnd() - 0.5) * 10 ** (rnd() * 20 - 4); assert.equal(fdp(v, dp), ref(v), `fdp(${v}, ${dp})`); }
  for (const v of [0, -0, Number.NaN, Infinity, -Infinity, 1e20, -1e300]) assert.equal(fdp(v, dp), ref(v));
}

const t = Array.from({ length: 5000 }, (_, i) => i / 50);
const fig = (): ReturnType<typeof subplots>[0] => {
  const [f, ax] = subplots();
  ax.plot(t, t.map((v) => Math.sin(v) + Math.sin(v * 37) * 0.2), { label: 'a' });
  ax.plot([1, 2, Number.NaN, 4, 5], [0, 1, 0, 1, 0], 'o-');
  ax.legend();
  return f;
};
const dflt = fig().toSVG();
assert.equal(fig().toSVG({}), dflt, 'no precision: unchanged');
const lineD = (svg: string): string[] => [...svg.matchAll(/<path d="(M[^"]*)" fill="none"/g)].map((m) => m[1] ?? '');
/** Absolute vertices of path data with M, L and relative l (implicit repeats, '-' and '.5' number forms). */
const coords = (dd: string): number[][] => {
  const out: number[][] = [];
  let cmd = 'M', x = 0, y = 0;
  const toks = dd.match(/[MLl]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  for (let i = 0; i < toks.length;) {
    const tok = toks[i] ?? '';
    if (/[MLl]/.test(tok)) { cmd = tok; i++; continue; }
    const a = Number(tok), b = Number(toks[i + 1]);
    i += 2;
    if (cmd === 'l') { x += a; y += b; } else { x = a; y = b; }
    out.push([x, y]);
  }
  return out;
};
for (const precision of [0, 1, 2, 4]) {
  const svg = fig().toSVG({ precision });
  assert.ok(svg.length < dflt.length, `precision ${precision} is smaller`);
  const a = lineD(dflt), b = lineD(svg);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const da = a[i] ?? '', db = b[i] ?? '';
    // the same subpaths; a line letter is never repeated back to back (relative l runs, an absolute L anchor every 32)
    assert.equal((db.match(/M/g) ?? []).length, (da.match(/M/g) ?? []).length);
    assert.ok(!/l[^MLlZ]*l|L[^MLlZ]*L/.test(db), 'no repeated command letter');
    if (coords(db).length > 200) assert.ok((db.match(/[Ll]/g) ?? []).length < coords(db).length / 8, 'most vertices carry no letter');
    // every kept vertex is a default vertex (4 decimals) rounded to `precision`, in order
    const tol = 0.5 / 10 ** precision + 1e-4 + 1e-6, ca = coords(da), cb = coords(db);
    assert.ok(cb.length <= ca.length);
    let j = 0;
    for (const v of cb) {
      while (j < ca.length && !(Math.abs((ca[j]?.[0] ?? 0) - (v[0] ?? 0)) <= tol && Math.abs((ca[j]?.[1] ?? 0) - (v[1] ?? 0)) <= tol)) j++;
      assert.ok(j < ca.length, 'kept vertex is a rounded default vertex');
    }
  }
}
assert.equal(fig().svgChunks({ precision: 1 }).next().done, false);
for (const bad of [-1, 5, 1.5, '1', Number.NaN]) assert.throws(() => fig().toSVG({ precision: bad }), /precision must be/);
assert.throws(() => fig().toSVG({ decimals: 1 }), /decimals/);
console.log('svg precision: ok');
