import { readFileSync } from 'node:fs';
import { resampleBilinearFloat, resampleHanningFloat } from '../src/core/image-resample.ts';

type Case = { src: number[][]; out: number[][]; sx: number; sy: number };
const oracle = JSON.parse(readFileSync(new URL('../fixtures/resample_oracle.json', import.meta.url), 'utf8')) as Record<string, Case>;

let fails = 0;
const fail = (m: string): void => { fails++; console.log(`FAIL ${m}`); };

for (const [name, c] of Object.entries(oracle)) {
  const srcH = c.src.length, srcW = c.src[0].length;
  const outH = c.out.length, outW = c.out[0].length;
  const src = new Float64Array(srcH * srcW);
  for (let r = 0; r < srcH; r++) for (let col = 0; col < srcW; col++) src[r * srcW + col] = c.src[r][col];
  const out = new Float64Array(outH * outW);
  if (name.startsWith('bilinear')) resampleBilinearFloat(src, srcW, srcH, out, outW, outH, c.sx, c.sy);
  else resampleHanningFloat(src, srcW, srcH, out, outW, outH, c.sx, c.sy);
  let maxAbs = 0, nDiff = 0;
  for (let r = 0; r < outH; r++) for (let col = 0; col < outW; col++) {
    const g = out[r * outW + col], w = c.out[r][col];
    const d = Math.abs(g - w);
    if (d > maxAbs) maxAbs = d;
    if (d > 1e-10) nDiff++;
  }
  if (maxAbs > 1e-10) fail(`${name}: max|Δ|=${maxAbs} nDiff=${nDiff} (first got ${out[0]} want ${c.out[0][0]})`);
  else console.log(`PASS ${name} max|Δ|=${maxAbs}`);
}
if (fails) { console.log(`${fails} failure(s)`); process.exit(1); }
console.log('resample: all oracle cases exact');
