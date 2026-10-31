// Side-by-side: matplotlib Agg | mpljs | difference (white = identical, red = |Δ|·32).
//   node tools/png_showcase.mjs <outdir> <fixture...>
import { readFileSync, writeFileSync } from 'node:fs';
import { build, loadFixture } from './replay.mjs';
import { renderRGBA } from '../src/render/agg.ts';
import { encodePNGSync } from '../src/render/png.ts';
import { Tracer } from '../src/trace.ts';
import { compare, readPNG } from '../test/png-oracle.mjs';

const [out, ...names] = process.argv.slice(2);
for (const name of names) {
  const ref = readPNG(readFileSync(new URL(`../fixtures/ref/${name}.png`, import.meta.url)));
  const ours = renderRGBA(build(loadFixture(name)).toScene(), new Tracer());
  const W = ref.w, H = ref.h, G = 12, px = new Uint8Array((W * 3 + G * 2) * H * 4).fill(255), S = W * 3 + G * 2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    for (let k = 0; k < 4; k++) { px[(y * S + x) * 4 + k] = ref.px[i + k]; px[(y * S + W + G + x) * 4 + k] = ours.px[i + k]; }
    const d = Math.max(...[0, 1, 2, 3].map((k) => Math.abs(ref.px[i + k] - ours.px[i + k])));
    const o = (y * S + 2 * (W + G) + x) * 4, v = d === 0 ? 255 : Math.max(0, 255 - 32 * d);
    px[o] = 255; px[o + 1] = v; px[o + 2] = v; px[o + 3] = 255;
  }
  writeFileSync(`${out}/${name}.sxs.png`, encodePNGSync({ w: S, h: H, px, u32: new Uint32Array(px.buffer) }));
  writeFileSync(`${out}/${name}.mpljs.png`, encodePNGSync(ours));
  const r = compare(ref, ours);
  console.log(`${name}: ${r.diff === 0 ? 'byte-identical' : `${r.diff} px differ, max |Δ| ${r.maxd}`}`);
}
