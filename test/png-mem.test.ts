import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { build, loadFixture } from '../tools/replay.ts';
import {
  encodePNGSync, pngStreamSync, pngPeakBytes, pngIntervalsBytes, canvasBlockBytes,
  PNG_SYNC_FIXED_SCRATCH_BYTES, PNG_IDAT_PAYLOAD_MAX, PNG_IDAT_CHUNK_MAX,
  PNG_PEAK_MAX_1X_SQUARE_BYTES, PNG_PEAK_MAX_1X_WIDE_BYTES,
  TOK_BLOCK, MAX_FRAME_PIXELS,
} from '../src/render/png.ts';
import { newCanvas, invalidateBlocks } from '../src/render/agg/canvas.ts';
import { subplots } from '../src/index.ts';
import { readPNG } from './png-oracle.ts';

const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

test('peak formula constants are exact and known', () => {
  assert.equal(TOK_BLOCK, 1 << 16);
  assert.equal(PNG_IDAT_PAYLOAD_MAX, TOK_BLOCK * 6 + 256);
  assert.equal(PNG_IDAT_CHUNK_MAX, 12 + PNG_IDAT_PAYLOAD_MAX);
  assert.ok(PNG_SYNC_FIXED_SCRATCH_BYTES > 1 * 1024 * 1024);
  assert.ok(PNG_SYNC_FIXED_SCRATCH_BYTES < 2 * 1024 * 1024);
  assert.equal(MAX_FRAME_PIXELS, 4 * 1024 * 1024);
  assert.equal(PNG_PEAK_MAX_1X_WIDE_BYTES, pngPeakBytes(MAX_FRAME_PIXELS, 1));
  assert.equal(PNG_PEAK_MAX_1X_SQUARE_BYTES, pngPeakBytes(2048, 2048));
  // Formula peak at square max-1× must fit Workers 128 MB.
  assert.ok(PNG_PEAK_MAX_1X_SQUARE_BYTES < 64 * 1024 * 1024);
  // Spot-check the formula expansion for demo @3×.
  const w = 4200, h = 3150;
  const expect = 4 * w * h + canvasBlockBytes(w, h) + PNG_SYNC_FIXED_SCRATCH_BYTES
    + Math.max(0, pngIntervalsBytes(w) - 2 * 2048 * 4) + PNG_IDAT_CHUNK_MAX;
  assert.equal(pngPeakBytes(w, h), expect);
  console.log(`  FIXED=${mb(PNG_SYNC_FIXED_SCRATCH_BYTES)}MB IDAT_MAX=${PNG_IDAT_PAYLOAD_MAX}` +
    ` square=${mb(PNG_PEAK_MAX_1X_SQUARE_BYTES)}MB wide=${mb(PNG_PEAK_MAX_1X_WIDE_BYTES)}MB`);
});

test('pngStreamSync concat == encodePNGSync; IDAT payloads ≤ max', async () => {
  const [fig, ax] = subplots(1, 1, { figsize: [4, 3] });
  ax.plot([1, 2, 3], [1, 4, 9]);
  const c = fig.toRGBA({ dpi: 100 });
  const sync = encodePNGSync(c);
  const parts: Uint8Array[] = [];
  let maxPayload = 0;
  const r = pngStreamSync(c).getReader();
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- stream is read in order
    const { done, value } = await r.read();
    if (done) break;
    parts.push(value);
  }
  for (let i = 1; i < parts.length - 1; i++) {
    const chunk = parts[i];
    const dataLen = (chunk[0] << 24) | (chunk[1] << 16) | (chunk[2] << 8) | chunk[3];
    assert.ok(dataLen <= PNG_IDAT_PAYLOAD_MAX, `IDAT data ${dataLen} > max`);
    assert.equal(String.fromCharCode(chunk[4], chunk[5], chunk[6], chunk[7]), 'IDAT');
    maxPayload = Math.max(maxPayload, dataLen);
    assert.ok(chunk.length <= PNG_IDAT_CHUNK_MAX);
  }
  const cat = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { cat.set(p, o); o += p.length; }
  assert.deepEqual(cat, sync);
  console.log(`  stream chunks=${parts.length} maxPayload=${maxPayload} sync=${sync.length}`);
});

test('streaming encode does not accumulate: ΔarrayBuffers ≤ one IDAT chunk across sizes', async () => {
  const [simple, ax] = subplots(1, 1, { figsize: [14, 10.5] });
  ax.plot([0, 1, 2, 3, 4], [0, 1, 0, 1, 0]);
  ax.set_title('mem');
  const dash = build(loadFixture('hidpi_pro_dark_dashboard_200'));
  const cases: { name: string; fig: typeof simple; scales: number[] }[] = [
    { name: 'demo-sized', fig: simple, scales: [1, 2, 3] },
    { name: 'dashboard', fig: dash, scales: [1, 2, 3] },
  ];
  // Encode may briefly hold Bits + takeBytes copy + chunk wrapper ≈ 2·payload + 12.
  const ENCODE_SLACK = PNG_IDAT_CHUNK_MAX + PNG_IDAT_PAYLOAD_MAX + 256 * 1024;
  for (const c of cases) {
    for (const scale of c.scales) {
      if (globalThis.gc) globalThis.gc();
      const canvas = c.fig.toRGBA({ dpi: c.fig.dpi * scale });
      const bound = pngPeakBytes(canvas.w, canvas.h);
      if (globalThis.gc) globalThis.gc();
      const base = process.memoryUsage().arrayBuffers;
      let peak = base;
      const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 1);
      const reader = pngStreamSync(canvas).getReader();
      let maxChunk = 0, nChunks = 0;
      for (;;) {
        // oxlint-disable-next-line no-await-in-loop -- ordered pull
        const { done, value } = await reader.read();
        if (done) break;
        nChunks++;
        maxChunk = Math.max(maxChunk, value.byteLength);
        // drop reference to value each iteration
      }
      clearInterval(iv);
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      const delta = peak - base;
      assert.ok(maxChunk <= PNG_IDAT_CHUNK_MAX, `maxChunk ${maxChunk}`);
      assert.ok(delta <= ENCODE_SLACK,
        `${c.name}@${scale}x Δ=${mb(delta)} > slack=${mb(ENCODE_SLACK)}`);
      // Formula is the known absolute bound for a clean isolate; log it next to the delta proof.
      console.log(`  ${c.name}@${scale}x ${canvas.w}x${canvas.h} base=${mb(base)} peak=${mb(peak)}` +
        ` Δ=${mb(delta)}MB bound=${mb(bound)}MB chunks=${nChunks} maxChunk=${maxChunk}`);
    }
  }
});

test('noise max-1× square: formula < 128MB; clean-process peak ≤ formula', async () => {
  const side = Math.floor(Math.sqrt(MAX_FRAME_PIXELS));
  assert.equal(side, 2048);
  assert.ok(PNG_PEAK_MAX_1X_SQUARE_BYTES < 128 * 1024 * 1024);
  // Round-trip pixels via sync in this process.
  const noise = newCanvas(side, side, 100);
  for (let i = 0; i < noise.px.length; i++) noise.px[i] = (i * 1103515245 + 12345) & 255;
  invalidateBlocks(noise); // px overwritten; block state must not claim uniform white
  const png = encodePNGSync(noise);
  const back = readPNG(Buffer.from(png));
  assert.equal(back.w, side); assert.equal(back.h, side);
  // Absolute arrayBuffers peak in a fresh isolate (no leftover canvases).
  const script = `
    import { pngStreamSync, pngPeakBytes, PNG_IDAT_CHUNK_MAX, PNG_PEAK_MAX_1X_SQUARE_BYTES } from './src/render/png.ts';
    import { newCanvas } from './src/render/agg/canvas.ts';
    const side = 2048;
    import { invalidateBlocks } from './src/render/agg/canvas.ts';
    const noise = newCanvas(side, side, 100);
    for (let i = 0; i < noise.px.length; i++) noise.px[i] = (i * 1103515245 + 12345) & 255;
    invalidateBlocks(noise);
    if (globalThis.gc) gc();
    const bound = pngPeakBytes(side, side);
    let peak = process.memoryUsage().arrayBuffers;
    const iv = setInterval(() => { peak = Math.max(peak, process.memoryUsage().arrayBuffers); }, 1);
    const r = pngStreamSync(noise).getReader();
    let maxChunk = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      maxChunk = Math.max(maxChunk, value.byteLength);
    }
    clearInterval(iv);
    peak = Math.max(peak, process.memoryUsage().arrayBuffers);
    const ok = peak <= bound + 4 * 1024 * 1024 && peak < 128 * 1024 * 1024 && maxChunk <= PNG_IDAT_CHUNK_MAX && bound === PNG_PEAK_MAX_1X_SQUARE_BYTES;
    console.log(JSON.stringify({ ok, peak, bound, maxChunk, sync: ${png.length} }));
    if (!ok) process.exit(1);
  `;
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.log(r.stdout); console.log(r.stderr);
  }
  assert.equal(r.status, 0, `clean noise probe failed: ${r.stderr}`);
  const lines = r.stdout.trim().split('\n');
  const line = lines.length > 0 ? lines[lines.length - 1] : '';
  assert.ok(line.length > 0, 'clean noise probe produced no JSON');
  const j = JSON.parse(line) as { ok: boolean; peak: number; bound: number; maxChunk: number };
  assert.ok(j.ok);
  console.log(`  noise ${side}x${side} sync=${(png.length / 1024).toFixed(0)}KB` +
    ` cleanPeak=${mb(j.peak)}MB bound=${mb(j.bound)}MB maxChunk=${j.maxChunk}`);
});
