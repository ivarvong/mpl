// Every SVG mpljs writes must be well-formed XML with its namespace prefixes bound: an unbound xlink: prefix
// makes browsers' <img> and GitHub refuse the whole file. Checks a fresh imshow render and every shipped image.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { subplots } from '../src/index.ts';

const prefixesBound = (svg: string, where: string): void => {
  const root = svg.slice(0, svg.indexOf('>') + 1);
  const used = new Set([...svg.matchAll(/<[^>]*?\s([a-zA-Z][\w-]*):[\w-]+=/g)].map((m) => m[1]));
  used.delete('xmlns');
  for (const p of used) assert.ok(root.includes(`xmlns:${p}=`), `${where}: prefix ${p}: used but not declared on <svg>`);
};

const [fig, ax] = subplots();
ax.imshow([[0, 1], [2, 3]]);
const svg = fig.toSVG();
assert.ok(svg.includes('xlink:href='), 'imshow should embed its raster with xlink:href');
prefixesBound(svg, 'imshow render');

const [plain] = subplots();
assert.ok(!plain.toSVG().includes('xmlns:xlink'), 'figures without images keep the plain root');

const walk = (d: string): string[] => readdirSync(d).flatMap((e) => { const p = join(d, e); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.svg') ? [p] : []; });
const files = walk('docs/images');
for (const p of files) prefixesBound(readFileSync(p, 'utf8'), p);
console.log(`svg-xml: imshow render + ${files.length} shipped SVGs have every namespace prefix bound`);
