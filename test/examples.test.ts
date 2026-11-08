// Every example runs on a clean checkout, and the two pictures shown in the README are exactly what
// the examples produce today (the PNG path is deterministic: own Agg port, no native code).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { compare, readPNG } from './png-oracle.ts';
import { readmeImages } from '../scripts/readme_images.ts';

const ROOT = new URL('../', import.meta.url);
const examples = readdirSync(new URL('examples/', ROOT)).filter((f) => /^[a-z].*\.ts$/.test(f));
for (const f of examples) execFileSync(process.execPath, [`examples/${f}`], { cwd: ROOT, stdio: 'pipe' });
execFileSync(process.execPath, ['examples/themes/dashboard.ts'], { cwd: ROOT, stdio: 'pipe' });

let bad = 0;
// docs/images/*.png are shown in the README and docs exactly as the examples write them (fig.toPNGSync()); PNG, not SVG,
// because GitHub renders an SVG's <text> in whatever fonts the viewer has, not DejaVu Sans
for (const name of ['quickstart', 'twinx_theme', 'scatter_cmap', 'small_multiples', 'histogram_errorbar']) {
  const made = readFileSync(new URL(`examples/out/${name}.png`, ROOT)), shown = readFileSync(new URL(`docs/images/${name}.png`, ROOT));
  if (!made.equals(shown)) { bad++; console.log(`docs/images/${name}.png differs from examples/${name}.ts output; refresh it`); }
}
// the README's proof: examples/trace.ts and matplotlib's own render of the same calls (the oracle case) are the same
// pixels, at the 200 dpi the README shows; the README's mpljs images are the example's output
for (const style of ['pro-slate', 'pro-dark']) {
  const made = readFileSync(new URL(`examples/out/trace-${style}.png`, ROOT));
  const px = compare(readPNG(readFileSync(new URL(`fixtures/ref/example_trace_${style.replace('-', '_')}.png`, ROOT))), readPNG(made));
  if (px.diff > 0) { bad++; console.log(`examples/trace.ts ${style}: ${px.diff} px differ from matplotlib's render (the README's side-by-side)`); }
  if (!made.equals(readFileSync(new URL(`docs/images/readme/trace-${style}.png`, ROOT)))) {
    bad++; console.log(`docs/images/readme/trace-${style}.png differs from examples/trace.ts output; refresh it`);
  }
}
// the README hero, scripts/readme_images.ts
for (const [name, png] of readmeImages()) {
  if (!Buffer.from(png).equals(readFileSync(new URL(`docs/images/readme/${name}`, ROOT)))) {
    bad++; console.log(`docs/images/readme/${name} is stale; run node scripts/readme_images.ts`);
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
