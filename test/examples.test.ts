// Every example runs on a clean checkout, and the two pictures shown in the README are exactly what
// the examples produce today (the PNG path is deterministic: own Agg port, no native code).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { compare, readPNG } from './png-oracle.ts';

const ROOT = new URL('../', import.meta.url);
const examples = readdirSync(new URL('examples/', ROOT)).filter((f) => /^[a-z].*\.ts$/.test(f));
for (const f of examples) execFileSync(process.execPath, [`examples/${f}`], { cwd: ROOT, stdio: 'pipe' });
execFileSync(process.execPath, ['examples/themes/dashboard.ts'], { cwd: ROOT, stdio: 'pipe' });

let bad = 0;
for (const name of ['quickstart', 'twinx_theme', 'scatter_cmap']) {
  const made = readFileSync(new URL(`examples/out/${name}.png`, ROOT)), shown = readFileSync(new URL(`docs/images/${name}.png`, ROOT));
  if (!made.equals(shown)) { bad++; console.log(`docs/images/${name}.png differs from examples/${name}.ts output; refresh it`); }
}
// docs/images/{gantt,small_multiples,histogram_errorbar}.svg are shown in the README exactly as the examples write them (fig.toSVG())
for (const name of ['gantt', 'small_multiples', 'histogram_errorbar']) {
  if (!readFileSync(new URL(`examples/out/${name}.svg`, ROOT)).equals(readFileSync(new URL(`docs/images/${name}.svg`, ROOT)))) {
    bad++; console.log(`docs/images/${name}.svg differs from examples/${name}.ts output; refresh it`);
  }
}
// the pro theme dashboards: README files are the example's output, and its pixels are matplotlib's (the oracle case)
for (const t of ['pro-dark', 'pro-mono', 'pro-ember', 'pro-slate']) {
  for (const ext of ['svg', 'png']) {
    if (!readFileSync(new URL(`examples/out/themes/${t}.${ext}`, ROOT)).equals(readFileSync(new URL(`docs/images/themes/${t}.${ext}`, ROOT)))) {
      bad++; console.log(`docs/images/themes/${t}.${ext} differs from examples/themes/dashboard.ts output; refresh it`);
    }
  }
  const px = compare(readPNG(readFileSync(new URL(`fixtures/ref/theme_${t.replace('-', '_')}_dashboard.png`, ROOT))), readPNG(readFileSync(new URL(`examples/out/themes/${t}.png`, ROOT))));
  if (px.diff > 0) { bad++; console.log(`examples/themes/dashboard.ts ${t}: ${px.diff} px differ from matplotlib's render (fixtures/ref/theme_${t.replace('-', '_')}_dashboard.png)`); }
}
console.log(`examples: ${examples.length + 1} ran, README images ${bad === 0 ? 'match' : 'STALE'}`);
if (bad) process.exitCode = 1;
