// Per-face font modules: the encoding is lossless, and the registry never substitutes a face.
// Runs in its own process against mpl/core so the registry starts empty (lean entry).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { decodeFace, decodeTables, decodeVlq, FACE_CATALOG } from '../src/core/fontcodec.ts';
import { FACE_LOADS, FontNotLoadedError, registerFonts, registeredFonts, subplots } from '../src/core.ts';
import { allFonts, dejavuSans, dejavuSansBold, interMedium, interRegular } from '../src/fonts/all.ts';
import { encodeFace } from '../scripts/encode_fonts.ts';

// 1. lossless: each face decodes to exactly the JSON scripts/gen_fonts.py baked before the split
//    (sha256 of JSON.stringify of the original src/core/data/fonts/<name>.ts object, at 3e8352f)
const BAKED_SHA256: Readonly<Record<string, string>> = {
  'dejavu-sans': 'd2f7faa48bc489114a5c98bf79f99956ab13535a7889d60f3e9956dd8116ece5',
  'dejavu-sans-bold': '76c5e15c215b28a5975d19ca08aee47ff1a84f3a78a7f940649c873616072f1a',
  'dejavu-serif': 'dcd708f6cd093db9b3bb19201f40f93e14526ea0f9e5b47dc5c2dc8f82187e06',
  'dejavu-serif-bold': '45d6b481dd91bc044ba89189946fe1661cb7e78e3db934e07e7988b37eecffed',
  'inter-regular': '986aca56316e1215a1f996b2f36ffc324c79c1624b144ae72bc3b185b4b9bc44',
  'inter-medium': 'e43f59fa0a018b8325ed4cebd13b13fb4649b450c5f874c5647eacace8914e52',
  'inter-semibold': 'c91ee1bf2c5e08285bc137f3e6806a8a5fe3d710f0d96a03c7f841ee63894f35',
  'inter-bold': '4de29b99d554a7534d1d30cc82ddf19595743a9b45d4e88f7628aea4b7eadcfa',
};
assert.equal(allFonts.length, FACE_CATALOG.length);
FACE_CATALOG.forEach((e, i) => {
  const b = allFonts[i];
  assert.equal(b.id, e.id, `allFonts[${i}] is ${e.id}`);
  const d = decodeFace(b, e), json = JSON.stringify(d);
  assert.equal(createHash('sha256').update(json).digest('hex'), BAKED_SHA256[e.module], `${e.module}: decodes to the baked data`);
  assert.deepEqual(encodeFace(d, e), b, `${e.module}: re-encodes to the committed module`);
  // the tables getFace loads (Maps, glyphs decoded on first use) hold exactly decodeFace's data
  const t = decodeTables(b);
  assert.deepEqual(new Map(Object.entries(d.cmap)), t.cmap, `${e.module}: cmap`);
  assert.deepEqual(d.cover, t.cover, `${e.module}: cover`);
  assert.deepEqual(new Map(Object.entries(d.glyphs).map(([k, v]) => [Number(k), v])), t.glyphs, `${e.module}: glyphs`);
  assert.deepEqual(new Map(Object.entries(d.kern).map(([k, v]) => { const [l, r] = k.split(','); return [Number(l) * 65536 + Number(r), v]; })), t.kern, `${e.module}: kern`);
  for (const [name, rec, lazy] of [['outlines', d.outlines, t.outlines], ['offsets', d.offsets, t.offsets]] as const) {
    assert.deepEqual(lazy.gids(), Object.keys(rec).map(Number), `${e.module}: ${name} gids`);
    for (const [g, v] of Object.entries(rec)) assert.deepEqual(lazy.get(Number(g)), { kind: 'some', value: v }, `${e.module}: ${name} ${g}`);
    assert.deepEqual(lazy.get(1 << 20), { kind: 'none' }, `${e.module}: ${name} absent gid`);
  }
});
// VLQ: signs, multi-digit values, the 32-bit range, and corrupt input
const vlq = (xs: readonly number[]): string => encodeFace({ ...decodeFace(allFonts[0], FACE_CATALOG[0]), cover: [], kern: {}, cmap: {}, glyphs: {}, outlines: {}, offsets: { 1: [xs] } }, FACE_CATALOG[0]).offsets;
const edge = [0, 1, -1, 15, -16, 16, 511, -512, 1023, 65535, -65536, 2 ** 31 - 1, -(2 ** 31 - 1)];
assert.deepEqual([...decodeVlq(vlq(edge))].slice(3), edge, 'VLQ round-trips edge values');
assert.throws(() => decodeVlq('A!'), /bad VLQ character/);
assert.throws(() => decodeVlq('g'), /truncated VLQ/);

// 2. the registry starts empty; DejaVu Sans must be registered for a default figure
assert.deepEqual(registeredFonts(), []);
const draw = (rc: Readonly<Record<string, unknown>>, title: string, kw: Readonly<Record<string, unknown>>): string => {
  const [fig, ax] = subplots({ rc });
  ax.plot([1, 2, 3], [1, 4, 9]); ax.set_title(title, kw);
  return fig.toSVG();
};
const err = (f: () => unknown): FontNotLoadedError => {
  try { f(); } catch (e) { if (e instanceof FontNotLoadedError) return e; throw e; }
  assert.fail('expected FontNotLoadedError');
};
assert.equal(err(() => draw({}, 'default', {})).face, 'DejaVu Sans:400', 'default figure needs dejavuSans registered');
registerFonts(dejavuSans);
assert.ok(draw({}, 'default', {}).includes('<svg'), 'a default figure renders once dejavuSans is registered');
assert.deepEqual(FACE_LOADS.map((l) => l.id), ['DejaVu Sans:400'], 'and decodes only DejaVu Sans');

// a face that is not registered fails, typed and with the import to add; nothing is drawn instead
const bold = err(() => draw({}, 'bold', { fontweight: 'bold' }));
assert.equal(bold.face, 'DejaVu Sans:700'); assert.equal(bold.module, 'mpl/fonts/dejavu-sans-bold'); assert.equal(bold.binding, 'dejavuSansBold');
assert.match(bold.message, /import \{ dejavuSansBold \} from 'mpl\/fonts\/dejavu-sans-bold';/);
assert.equal(err(() => draw({ 'font.family': 'serif' }, 'serif', {})).face, 'DejaVu Serif:400', 'generic serif resolves to DejaVu Serif, never back to sans');
// selection runs over every shipped face: with only Inter Regular registered, weight 500 still selects
// Inter Medium (as matplotlib would) and fails, rather than drawing the nearest registered weight
registerFonts(interRegular);
assert.ok(draw({ 'font.family': 'Inter' }, 'inter', {}).includes('<svg'));
assert.equal(err(() => draw({ 'font.family': 'Inter' }, 'medium', { fontweight: 500 })).face, 'Inter:500');
registerFonts(interMedium, dejavuSansBold, interMedium);
assert.ok(draw({ 'font.family': 'Inter' }, 'medium', { fontweight: 500 }).includes('<svg'));
assert.ok(draw({}, 'bold', { fontweight: 'bold' }).includes('<svg'));
assert.deepEqual(registeredFonts(), ['DejaVu Sans:400', 'DejaVu Sans:700', 'Inter:400', 'Inter:500'], 'registered once each, catalog order');
// families mpl does not ship fall through the list exactly as before (matplotlib's fallback)
assert.ok(draw({ 'font.family': ['Comic Sans MS', 'sans-serif'] }, 'fallback', {}).includes('<svg'));
console.log(`font modules: ${FACE_CATALOG.length} faces decode to the baked data exactly; unregistered faces fail with FontNotLoadedError`);
