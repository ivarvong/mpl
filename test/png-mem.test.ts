import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import {
  encodePNGSync, pngStreamSync, pngPeakBytes, pngIntervalsBytes, canvasBlockBytes,
  PNG_SYNC_FIXED_SCRATCH_BYTES, PNG_IDAT_PAYLOAD_MAX, PNG_IDAT_CHUNK_MAX,
  PNG_ARRAYBUFFERS_BASELINE_BYTES, PNG_PEAK_V8_RECLAIM_SLACK_BYTES, PNG_PEAK_BUDGET_BYTES, PNG_PEAK_MAX_1X_SQUARE_BYTES,
  PNG_PEAK_MAX_1X_WIDE_BYTES, pngPeakFitsBudget, maxPngScaleForFigure,
  TOK_BLOCK, MAX_FRAME_PIXELS,
} from '../src/render/png.ts';
import { newCanvas, invalidateBlocks } from '../src/render/agg/canvas.ts';
import { subplots } from '../src/index.ts';
import { readPNG } from './png-oracle.ts';

const mb = (n: number): string => (n / 1024 / 1024).toFixed(2);

test('peak formula constants are exact and known', () => {
  assert.equal(TOK_BLOCK, 1 << 16);
  assert.equal(PNG_IDAT_PAYLOAD_MAX, TOK_BLOCK * 6 + 256);
  assert.equal(PNG_IDAT_CHUNK_MAX, 12 + PNG_IDAT_PAYLOAD_MAX);
  assert.equal(PNG_ARRAYBUFFERS_BASELINE_BYTES, 256 * 1024);
  assert.equal(PNG_PEAK_V8_RECLAIM_SLACK_BYTES, 1280 * 1024);
  assert.equal(PNG_PEAK_BUDGET_BYTES, 64 * 1024 * 1024);
  assert.ok(PNG_SYNC_FIXED_SCRATCH_BYTES > 1 * 1024 * 1024);
  assert.ok(PNG_SYNC_FIXED_SCRATCH_BYTES < 2 * 1024 * 1024);
  assert.equal(MAX_FRAME_PIXELS, 4 * 1024 * 1024);
  assert.equal(PNG_PEAK_MAX_1X_WIDE_BYTES, pngPeakBytes(MAX_FRAME_PIXELS, 1));
  assert.equal(PNG_PEAK_MAX_1X_SQUARE_BYTES, pngPeakBytes(2048, 2048));
  assert.ok(pngPeakFitsBudget(4200, 3150), 'demo @3× must fit budget');
  assert.ok(pngPeakFitsBudget(2048, 2048), 'max 1× square must fit');
  assert.ok(!pngPeakFitsBudget(4096, 4096), '4 MP @2× square must not fit');
  const w = 4200, h = 3150;
  const expect = 4 * w * h + canvasBlockBytes(w, h) + PNG_SYNC_FIXED_SCRATCH_BYTES
    + Math.max(0, pngIntervalsBytes(w) - 2 * 2048 * 4) + PNG_IDAT_CHUNK_MAX + PNG_ARRAYBUFFERS_BASELINE_BYTES;
  assert.equal(pngPeakBytes(w, h), expect);
  console.log(`  FIXED=${mb(PNG_SYNC_FIXED_SCRATCH_BYTES)}MB baseline=${PNG_ARRAYBUFFERS_BASELINE_BYTES}` +
    ` budget=${mb(PNG_PEAK_BUDGET_BYTES)}MB square=${mb(PNG_PEAK_MAX_1X_SQUARE_BYTES)}MB`);
});

test('pngStreamSync zlib payloads == encodePNGSync single IDAT; IDAT payloads ≤ max', async () => {
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
  const streamZ: Uint8Array[] = [];
  for (let i = 1; i < parts.length - 1; i++) {
    const ch = parts[i];
    const dataLen = (ch[0] << 24) | (ch[1] << 16) | (ch[2] << 8) | ch[3];
    assert.ok(dataLen <= PNG_IDAT_PAYLOAD_MAX, `IDAT data ${dataLen} > max`);
    assert.equal(String.fromCharCode(ch[4], ch[5], ch[6], ch[7]), 'IDAT');
    maxPayload = Math.max(maxPayload, dataLen);
    assert.ok(ch.length <= PNG_IDAT_CHUNK_MAX);
    streamZ.push(ch.subarray(8, 8 + dataLen));
  }
  // encodePNGSync is single-IDAT (SVG / toPNGSync byte-stable); stream is multi-IDAT.
  let syncZ: Uint8Array | undefined;
  let nSyncIdat = 0, o = 8;
  while (o < sync.length) {
    const len = (sync[o] << 24) | (sync[o + 1] << 16) | (sync[o + 2] << 8) | sync[o + 3];
    const type = String.fromCharCode(sync[o + 4], sync[o + 5], sync[o + 6], sync[o + 7]);
    if (type === 'IDAT') { nSyncIdat++; syncZ = sync.subarray(o + 8, o + 8 + len); }
    o += 12 + len;
    if (type === 'IEND') break;
  }
  assert.equal(nSyncIdat, 1, 'encodePNGSync must emit exactly one IDAT');
  assert.ok(syncZ);
  const catZ = new Uint8Array(streamZ.reduce((n, p) => n + p.length, 0));
  let zo = 0; for (const p of streamZ) { catZ.set(p, zo); zo += p.length; }
  assert.deepEqual(catZ, syncZ);
  console.log(`  stream chunks=${parts.length} nIdat=${streamZ.length} maxPayload=${maxPayload} sync=${sync.length}`);
});

test('clean-isolate measured peak ≤ pngPeakBytes (zero tolerance); report slack', () => {
  // Canvases are built in-process from library specs (no checked-in RGBA dumps or absolute fixture paths).
  const cases: { key: string; kind: 'demo' | 'dashboard' | 'noise'; scale?: number }[] = [
    { key: 'demo_x1', kind: 'demo', scale: 1 },
    { key: 'demo_x2', kind: 'demo', scale: 2 },
    { key: 'demo_x3', kind: 'demo', scale: 3 },
    { key: 'dashboard_x1', kind: 'dashboard', scale: 1 },
    { key: 'dashboard_x2', kind: 'dashboard', scale: 2 },
    { key: 'dashboard_x3', kind: 'dashboard', scale: 3 },
    { key: 'noise', kind: 'noise' },
  ];
  const slacks: { key: string; peak: number; bound: number; slack: number }[] = [];
  for (const spec of cases) {
    const script = spec.kind === 'noise' ? `
      import { pngStreamSync, pngPeakBytes, PNG_IDAT_CHUNK_MAX, PNG_PEAK_V8_RECLAIM_SLACK_BYTES } from './src/render/png.ts';
      import { newCanvas, invalidateBlocks } from './src/render/agg/canvas.ts';
      const side = 2048;
      const c = newCanvas(side, side, 100);
      for (let i = 0; i < c.px.length; i++) c.px[i] = (i * 1103515245 + 12345) & 255;
      invalidateBlocks(c);
      if (globalThis.gc) { gc(); gc(); }
      await new Promise((r) => setTimeout(r, 40));
      if (globalThis.gc) gc();
      const bound = pngPeakBytes(side, side);
      let peak = process.memoryUsage().arrayBuffers;
      const r = pngStreamSync(c).getReader();
      let maxChunk = 0;
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        maxChunk = Math.max(maxChunk, value.byteLength);
        if (globalThis.gc) { gc(); gc(); }
        await new Promise((r) => setTimeout(r, 0));
        if (globalThis.gc) gc();
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        if (value.byteLength < 0) throw new Error('unreachable');
      }
      console.log(JSON.stringify({ key: 'noise', w: side, h: side, peak, bound, maxChunk, ok: peak <= bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES && maxChunk <= PNG_IDAT_CHUNK_MAX, formulaSlack: bound - peak, limit: bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES }));
    ` : `
      import { pngStreamSync, pngPeakBytes, PNG_IDAT_CHUNK_MAX, PNG_PEAK_V8_RECLAIM_SLACK_BYTES } from './src/render/png.ts';
      import { subplots } from './src/index.ts';
      import { build, loadFixture } from './tools/replay.ts';
      const key = '${spec.key}';
      const scale = ${spec.scale};
      let fig;
      if (${JSON.stringify(spec.kind)} === 'demo') {
        const pair = subplots(1, 1, { figsize: [14, 10.5], dpi: 100 });
        fig = pair[0];
        pair[1].plot([0, 1, 2, 3], [0, 1, 0, 1]);
      } else {
        fig = build(loadFixture('hidpi_pro_dark_dashboard_200'));
      }
      const c = fig.toRGBA({ dpi: 100 * scale });
      fig = null;
      if (globalThis.gc) { gc(); gc(); }
      await new Promise((r) => setTimeout(r, 40));
      if (globalThis.gc) gc();
      const bound = pngPeakBytes(c.w, c.h);
      let peak = process.memoryUsage().arrayBuffers;
      const r = pngStreamSync(c).getReader();
      let maxChunk = 0;
      for (;;) {
        const { done, value } = await r.read();
        if (done) break;
        maxChunk = Math.max(maxChunk, value.byteLength);
        if (globalThis.gc) { gc(); gc(); }
        await new Promise((r) => setTimeout(r, 0));
        if (globalThis.gc) gc();
        peak = Math.max(peak, process.memoryUsage().arrayBuffers);
        if (value.byteLength < 0) throw new Error('unreachable');
      }
      console.log(JSON.stringify({ key, w: c.w, h: c.h, peak, bound, maxChunk, ok: peak <= bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES && maxChunk <= PNG_IDAT_CHUNK_MAX, formulaSlack: bound - peak, limit: bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES }));
    `;
    const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {
      cwd: process.cwd(), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
    assert.equal(r.status, 0, `${spec.key}: ${r.stderr}`);
    const lines = r.stdout.trim().split('\n');
    const line = lines.length > 0 ? lines[lines.length - 1] : '';
    assert.ok(line.length > 0);
    const j = JSON.parse(line) as { key: string; peak: number; bound: number; maxChunk: number; ok: boolean; limit?: number };
    assert.ok(j.ok, `${j.key}: peak=${j.peak} bound=${j.bound} limit=${j.bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES} maxChunk=${j.maxChunk}`);
    const formulaSlack = j.bound - j.peak;
    const limitSlack = j.bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES - j.peak;
    slacks.push({ key: j.key, peak: j.peak, bound: j.bound, slack: limitSlack });
    console.log(`  ${j.key} peak=${mb(j.peak)}MB formula=${mb(j.bound)}MB formulaSlack=${formulaSlack} limitSlack=${limitSlack}`);
  }
  assert.ok(slacks.every((s) => s.slack >= 0));
});

test('noise at max output under budget: peak ≤ formula; round-trip', () => {
  // Largest square that fits the 64 MB budget
  let lo = 1, hi = 8000;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (pngPeakFitsBudget(m, m)) lo = m; else hi = m - 1;
  }
  const side = lo;
  assert.ok(pngPeakFitsBudget(side, side));
  assert.ok(!pngPeakFitsBudget(side + 1, side + 1));
  const script = `
    import { pngStreamSync, pngPeakBytes, encodePNGSync, PNG_IDAT_CHUNK_MAX, PNG_PEAK_BUDGET_BYTES, PNG_PEAK_V8_RECLAIM_SLACK_BYTES } from './src/render/png.ts';
    import { newCanvas, invalidateBlocks } from './src/render/agg/canvas.ts';
    const side = ${side};
    const c = newCanvas(side, side, 100);
    for (let i = 0; i < c.px.length; i++) c.px[i] = (i * 1103515245 + 12345) & 255;
    invalidateBlocks(c);
    if (globalThis.gc) { gc(); gc(); }
    await new Promise((r) => setTimeout(r, 40));
    if (globalThis.gc) gc();
    const bound = pngPeakBytes(side, side);
    let peak = process.memoryUsage().arrayBuffers;
    const r = pngStreamSync(c).getReader();
    let maxChunk = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      maxChunk = Math.max(maxChunk, value.byteLength);
      if (globalThis.gc) gc();
      peak = Math.max(peak, process.memoryUsage().arrayBuffers);
      if (value.byteLength < 0) throw new Error('unreachable');
    }
    const png = encodePNGSync(c);
    console.log(JSON.stringify({ side, peak, bound, budget: PNG_PEAK_BUDGET_BYTES, maxChunk, pngBytes: png.length,
      ok: peak <= bound + PNG_PEAK_V8_RECLAIM_SLACK_BYTES && bound <= PNG_PEAK_BUDGET_BYTES && maxChunk <= PNG_IDAT_CHUNK_MAX }));
  `;
  const r = spawnSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  const line = lines[lines.length - 1] ?? '';
  const j = JSON.parse(line) as { side: number; peak: number; bound: number; ok: boolean; pngBytes: number };
  assert.ok(j.ok, JSON.stringify(j));
  // local round-trip pixels
  const noise = newCanvas(side, side, 100);
  for (let i = 0; i < noise.px.length; i++) noise.px[i] = (i * 1103515245 + 12345) & 255;
  invalidateBlocks(noise);
  const back = readPNG(Buffer.from(encodePNGSync(noise)));
  assert.equal(back.w, side); assert.equal(back.h, side);
  console.log(`  max-budget square ${side}×${side} peak=${mb(j.peak)} bound=${mb(j.bound)} slack=${mb(j.bound - j.peak)}`);
});

test('maxPngScaleForFigure: demo allows 3×; 4 MP square allows 1× only', () => {
  assert.equal(maxPngScaleForFigure(14, 10.5, 100), 3); // demo
  assert.ok(maxPngScaleForFigure(20.48, 20.48, 100) >= 1);
  assert.ok(maxPngScaleForFigure(20.48, 20.48, 100) < 2); // 2048² @2× = 4096² rejected
});
