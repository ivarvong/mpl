// MissingColormapRgbaError for rgba-stage without float32 sidecar; nearest stays fine without it.
import assert from 'node:assert/strict';
import {
  ColormapNotLoadedError, MissingColormapRgbaError, getColormap, registerColormapRgba, registerColormaps, registeredColormaps, requireColormap, requireColormapRgba,
} from '../src/core/colormap.ts';
import { plasma } from '../src/colormaps/plasma.ts';
import { plasma_rgba, plasma_r_rgba } from '../src/colormaps/plasma.rgba.ts';
import { subplots } from '../src/index.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

registerColormaps(plasma);

const Z = (() => {
  const n = 200, out: number[][] = [];
  for (let r = 0; r < n; r++) {
    const row: number[] = [];
    for (let c = 0; c < n; c++) row.push((r * n + c) / (n * n - 1));
    out.push(row);
  }
  return out;
})();

{
  const cmap = getColormap('plasma');
  assert.ok(cmap.ok);
  assert.equal(cmap.value.rgba.kind, 'none');
  assert.throws(() => requireColormapRgba(cmap.value), (e: unknown) => {
    assert.ok(e instanceof MissingColormapRgbaError);
    assert.match(e.message, /mpl\/colormaps\/plasma\.rgba/);
    assert.match(e.message, /import \{ plasma_rgba \} from 'mpl\/colormaps\/plasma\.rgba'/);
    assert.match(e.message, /registerColormapRgba\(plasma_rgba\)/);
    assert.equal(e.binding, 'plasma_rgba');
    assert.equal(e.module, 'mpl/colormaps/plasma.rgba');
    return true;
  });
}

// nearest does not need the float LUT
{
  const [fig, ax] = subplots({ figsize: [1.2, 1.2] });
  ax.imshow(Z, { cmap: 'plasma', interpolation: 'nearest' });
  assert.ok(fig.toPNGSync().byteLength > 100);
}

// rgba-stage hanning without sidecar must throw (not silently diverge from matplotlib)
{
  const [fig, ax] = subplots({ figsize: [1.2, 1.2] });
  ax.imshow(Z, { cmap: 'plasma', interpolation: 'hanning' });
  assert.throws(() => fig.toPNGSync(), (e: unknown) => e instanceof MissingColormapRgbaError);
}

// register both rgba packs while only plasma (not plasma_r) is registered — skip plasma_r
registerColormapRgba(plasma_rgba, plasma_r_rgba);
{
  const cmap = getColormap('plasma');
  assert.ok(cmap.ok && cmap.value.rgba.kind === 'some');
  const [fig, ax] = subplots({ figsize: [1.2, 1.2] });
  ax.imshow(Z, { cmap: 'plasma', interpolation: 'hanning' });
  assert.ok(fig.toPNGSync().byteLength > 100);
}

// registration is lazy (decode on first getColormap) but still rejects bad packs when registered
assert.throws(() => registerColormaps({ name: 'bad', N: 1, b64: 'AAAA' }), /colormap bad: packed length 3, want 32/);
assert.throws(() => registerColormaps({ name: 'bad', N: 1, b64: '!!!!' }));
assert.throws(() => registerColormapRgba({ name: 'plasma', N: 256, b64: 'AAAA' }), /registerColormapRgba plasma: length 3, want 4144/);
assert.ok(!registeredColormaps().includes('bad'));
// registering a name again replaces it, sidecar included (as an eager registry did)
{
  const before = getColormap('plasma');
  assert.ok(before.ok && before.value.rgba.kind === 'some');
  registerColormaps(plasma);
  const after = getColormap('plasma');
  assert.ok(after.ok && after.value.rgba.kind === 'none');
  assert.deepEqual(after.value.trunc, before.value.trunc);
  assert.deepEqual(after.value.round, before.value.round);
  const again = getColormap('plasma');
  assert.ok(again.ok && again.value === after.value, 'decoded once, then cached');
}


// unregistered shipped name throws ColormapNotLoadedError (typed; never falls back)
{
  try { requireColormap('inferno'); assert.fail('expected ColormapNotLoadedError'); }
  catch (e) {
    assert.ok(e instanceof ColormapNotLoadedError);
    assert.equal((e as ColormapNotLoadedError).cmap, 'inferno');
    assert.equal((e as ColormapNotLoadedError).binding, 'inferno');
    assert.match((e as ColormapNotLoadedError).message, /mpl\/colormaps\/inferno/);
  }
}

console.log('colormap-rgba: MissingColormapRgbaError + nearest-without-sidecar + hanning-with-sidecar ok');
