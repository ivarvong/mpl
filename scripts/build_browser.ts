// Browser build with no bundler and no dependency: Node's own TypeScript stripper (the source is
// erasable-syntax TypeScript) turns each src/**/*.ts into an ES module, and '.ts' import specifiers
// become '.js'. Browsers load the result as native modules.
//   node scripts/build_browser.ts [outdir]       (default dist/browser)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

const SRC = new URL('../src/', import.meta.url).pathname;
const OUT = process.argv[2] || new URL('../dist/browser/', import.meta.url).pathname;
const files: string[] = [];
const walk = (d: string): void => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p); } };
walk(SRC);
let bytes = 0;
for (const f of files) {
  const js = stripTypeScriptTypes(readFileSync(f, 'utf8'), { mode: 'strip' })
    .replace(/(from\s+['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3')
    .replace(/(import\(\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"]\s*\))/g, '$1$2.js$3');
  const out = join(OUT, relative(SRC, f)).replace(/\.ts$/, '.js');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, js);
  bytes += js.length;
}
// The import graph is 47 modules deep-ish; a browser discovers each level only after fetching the
// one above it. modulepreload.html lists every module so a page can request them all at once.
const rel = files.map((f) => relative(SRC, f).replace(/\.ts$/, '.js').split('\\').join('/'));
writeFileSync(join(OUT, 'modulepreload.html'), rel.map((r) => `<link rel="modulepreload" href="lib/${r}">`).join('\n') + '\n');
console.log(`${files.length} modules, ${(bytes / 1024).toFixed(0)} KiB → ${OUT}`);
