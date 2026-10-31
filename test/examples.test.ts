// Every example runs on a clean checkout, and the two pictures shown in the README are exactly what
// the examples produce today (the PNG path is deterministic: own Agg port, no native code).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const examples = readdirSync(new URL('examples/', ROOT)).filter((f) => /^[a-z].*\.ts$/.test(f));
for (const f of examples) execFileSync(process.execPath, [`examples/${f}`], { cwd: ROOT, stdio: 'pipe' });

let bad = 0;
for (const name of ['quickstart', 'twinx_theme']) {
  const made = readFileSync(new URL(`examples/out/${name}.png`, ROOT)), shown = readFileSync(new URL(`docs/images/${name}.png`, ROOT));
  if (!made.equals(shown)) { bad++; console.log(`docs/images/${name}.png differs from examples/${name}.ts output; refresh it`); }
}
console.log(`examples: ${examples.length} ran, README images ${bad === 0 ? 'match' : 'STALE'}`);
if (bad) process.exitCode = 1;
