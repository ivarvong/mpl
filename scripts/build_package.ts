// Build the publishable package into dist/browser: plain ES modules (types stripped by Node itself)
// plus .d.ts declarations. Run by `npm run build`.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = join(ROOT, 'dist/browser');
rmSync(OUT, { recursive: true, force: true });
execFileSync(process.execPath, [join(ROOT, 'scripts/build_browser.ts'), OUT + '/'], { stdio: 'inherit' });
execFileSync(join(ROOT, 'node_modules/.bin/tsc'), ['-p', join(ROOT, 'tsconfig.build.json')], { stdio: 'inherit', cwd: ROOT });

// tsc keeps '.ts' specifiers in declarations; point them at the emitted '.js' so consumers resolve them.
let n = 0;
const walk = (d: string): void => {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.d.ts')) continue;
    const s = readFileSync(p, 'utf8');
    const t = s.replace(/(from\s+['"]|import\(\s*['"])(\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1$2.js$3');
    if (t !== s) { writeFileSync(p, t); n++; }
  }
};
walk(OUT);
console.log(`declarations rewritten in ${n} files`);
