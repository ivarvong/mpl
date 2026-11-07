// Peak arrayBuffers for encodePNGSync stays within canvas + PNG_SYNC_FIXED_SCRATCH + O(compressed).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build, loadFixture } from '../tools/replay.ts';
import { encodePNGSync, PNG_SYNC_FIXED_SCRATCH_BYTES, TOK_BLOCK, pngStreamSync } from '../src/render/png.ts';
import { subplots } from '../src/index.ts';

const mb = (n: number): number => n / 1024 / 1024;

test('TOK_BLOCK is 64Ki tokens (same Huffman block size as before)', () => {
  assert.equal(TOK_BLOCK, 1 << 16);
  assert.ok(PNG_SYNC_FIXED_SCRATCH_BYTES < 2 * 1024 * 1024);
});

test('encodePNGSync peak arrayBuffers bounded across 1x/2x/3x', () => {
  const [simple, ax] = subplots(1, 1, { figsize: [14, 10.5] });
  ax.plot([0, 1, 2, 3, 4], [0, 1, 0, 1, 0]);
  ax.set_title('mem');
  const dash = build(loadFixture('hidpi_pro_dark_dashboard_200'));
  const cases: { name: string; fig: typeof simple; scales: number[] }[] = [
    { name: 'demo-sized', fig: simple, scales: [1, 2, 3] },
    { name: 'dashboard', fig: dash, scales: [1, 2, 3] },
  ];
  for (const c of cases) {
    for (const scale of c.scales) {
      if (globalThis.gc) globalThis.gc();
      const canvas = c.fig.toRGBA({ dpi: c.fig.dpi * scale });
      const canvasBytes = canvas.w * canvas.h * 4 + canvas.nb * canvas.h * 4 + canvas.nb * canvas.h;
      const afterRaster = process.memoryUsage().arrayBuffers;
      let peak = afterRaster;
      const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 1);
      const png = encodePNGSync(canvas);
      clearInterval(iv);
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      const encodeExtra = peak - afterRaster;
      // Encode scratch is fixed token pools + bit writer (~z) + output PNG — not another O(w·h) buffer.
      const encodeBound = PNG_SYNC_FIXED_SCRATCH_BYTES + png.length * 3 + 4 * 1024 * 1024;
      assert.ok(encodeExtra < encodeBound,
        `${c.name}@${scale}x encodeExtra=${mb(encodeExtra).toFixed(1)}MB bound=${mb(encodeBound).toFixed(1)}MB`);
      assert.ok(peak < 96 * 1024 * 1024,
        `${c.name}@${scale}x peakAB=${mb(peak).toFixed(1)}MB must stay under 96MB`);
      console.log(`  ${c.name}@${scale}x ${canvas.w}x${canvas.h} peak=${mb(peak).toFixed(1)}MB canvas=${mb(canvasBytes).toFixed(1)}MB encodeExtra=${mb(encodeExtra).toFixed(1)}MB png=${(png.length / 1024).toFixed(0)}KB`);
    }
  }
});

test('pngStreamSync concatenates to encodePNGSync bytes', async () => {
  const [fig, ax] = subplots(1, 1, { figsize: [4, 3] });
  ax.plot([1, 2, 3], [1, 4, 9]);
  const c = fig.toRGBA({ dpi: 100 });
  const sync = encodePNGSync(c);
  const parts: Uint8Array[] = [];
  const r = pngStreamSync(c).getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- stream is read in order
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  const cat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
  assert.deepEqual(cat, sync);
});
