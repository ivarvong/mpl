// src/core/libm.ts: log10 and exp must be correctly rounded (60-digit reference). The test also reports how
// often they and V8's Math.* agree with numpy, which is the actual oracle for LogTransform.
import { readFileSync } from 'node:fs';
import { exp, log10 } from '../src/core/libm.ts';
type Set = { readonly x: number[]; readonly cr: number[]; readonly numpy: number[] };
const ref = JSON.parse(readFileSync(new URL('../fixtures/ref/_libm.json', import.meta.url), 'utf8')) as { log10: Set; exp: Set };
let failed = false;
const run = (name: string, s: Set, f: (x: number) => number, m: (x: number) => number): void => {
  const bad = s.x.filter((x, i) => !Object.is(f(x), s.cr[i]));
  const np = s.x.filter((x, i) => f(x) === s.numpy[i]).length, mnp = s.x.filter((x, i) => m(x) === s.numpy[i]).length;
  console.log(`libm ${name}: ${s.x.length - bad.length}/${s.x.length} correctly rounded; agrees with numpy ${np}/${s.x.length} (Math.${name} ${mnp})`);
  if (bad.length > 0) { failed = true; console.log(`  not correctly rounded: ${bad.slice(0, 5).join(', ')}`); }
};
run('log10', ref.log10, log10, Math.log10);
run('exp', ref.exp, exp, Math.exp);
// the two values behind log_y_exp and loglog
const pin: readonly (readonly [number, number])[] = [[log10(Math.exp(10 * 47 / 59)), 3.4596340083818364], [exp(-0.20000000000000007 * Math.log(10)), 0.6309573444801931]];
for (const [got, want] of pin) if (got !== want) { failed = true; console.log(`  pinned value: got ${got} want ${want}`); }
if (failed) process.exit(1);
