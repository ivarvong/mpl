// Bundle budget: dist/browser minified + gzipped (scripts/bundle_size.ts) must stay within 2% of
// size-budget.json. After an intended change, `node scripts/bundle_size.ts --update` and commit the budget.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUDGET_FILE, ENTRIES, kib, measure, report, type Size } from '../scripts/bundle_size.ts';

const ROOT = new URL('../', import.meta.url).pathname;
execFileSync(process.execPath, [join(ROOT, 'scripts/build_package.ts')], { stdio: 'pipe' });
const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) as { tolerance: number } & Record<string, Size>;

let fails = 0;
for (const m of await Promise.all(Object.keys(ENTRIES).map(measure))) {
  const name = m.name;
  console.log(report(m));
  for (const k of ['min', 'gzip'] as const) {
    const want = budget[name][k], got = m.size[k], limit = Math.floor(want * (1 + budget.tolerance));
    const delta = `${got >= want ? '+' : ''}${(100 * (got - want) / want).toFixed(2)}%`;
    if (got > limit) { fails++; console.log(`FAIL size ${name} ${k}: ${kib(got)} > budget ${kib(want)} +${100 * budget.tolerance}% (${delta})`); }
    else console.log(`PASS size ${name} ${k}: ${kib(got)} (budget ${kib(want)}, ${delta})`);
  }
}
process.exit(fails > 0 ? 1 : 0);
