// docs/api.md is generated from src/api.ts; it must be current, and every public Axes/Figure
// method (checked at runtime, independently of the generator's parser) must appear in it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { kwargKeys, render } from '../scripts/gen_api_docs.ts';
import { Axes, Figure } from '../src/index.ts';

const md = readFileSync(new URL('../docs/api.md', import.meta.url), 'utf8');
assert.equal(md, render(), 'docs/api.md is stale: run node scripts/gen_api_docs.ts');
const SRC = readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8');
const isPrivate = (name: string): boolean => new RegExp(`^ {2}private (readonly )?(get )?${name}\\b`, 'm').test(SRC);
let missing = 0;
for (const [cls, proto] of [['Axes', Axes.prototype], ['Figure', Figure.prototype]] as const) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor' || isPrivate(name)) continue;
    if (!md.includes(`\`${cls}.${name}(`) && !md.includes(`\`${cls}.get ${name}(`)) { console.log(`undocumented: ${cls}.${name}`); missing++; }
  }
}
assert.equal(missing, 0, `${missing} public method(s) missing from docs/api.md`);
// The keyword parser takes string literals only; anything else would print source text as a keyword (issue #14)
assert.deepEqual(kwargKeys('m', "kw.read(['color', 'c'], f, d); kw.get(['xytext'])"), ['color | c', 'xytext']);
for (const body of ["kw.read([o === 'vertical' ? 'width' : 'height'], f, d)", 'kw.read([n0], f, d)', 'kw.read(KEYS, f, d)', "kw.get([...names, 'x'])"]) {
  assert.throws(() => kwargKeys('m', body), /string literals/, body);
}
for (const m of md.matchAll(/^Keyword arguments \(unknown keys throw\): (.*)$/gm)) {
  for (const k of m[1].split(', ')) assert.match(k, /^`[A-Za-z_]\w*( \| [A-Za-z_]\w*)*`$/, `docs/api.md keyword ${k}`);
}
console.log('api docs: current, every public method documented, every keyword a plain name');
