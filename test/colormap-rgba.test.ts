// MissingColormapRgbaError for rgba-stage without float32 sidecar; nearest stays fine without it.
import assert from 'node:assert/strict';
import {
  MissingColormapRgbaError, getColormap, registerColormapRgba, registerColormaps, requireColormapRgba,
} from '../src/core/colormap.ts';
import { plasma } from '../src/colormaps/plasma.ts';
import { plasma_rgba, plasma_r_rgba } from '../src/colormaps/plasma.rgba.ts';
import { subplots } from '../src/index.ts';

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
    assert.match(e.message, /mpljs\/colormaps\/plasma\.rgba/);
    assert.match(e.message, /import \{ plasma_rgba \} from 'mpljs\/colormaps\/plasma\.rgba'/);
    assert.match(e.message, /registerColormapRgba\(plasma_rgba\)/);
    assert.equal(e.binding, 'plasma_rgba');
    assert.equal(e.module, 'mpljs/colormaps/plasma.rgba');
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

console.log('colormap-rgba: MissingColormapRgbaError + nearest-without-sidecar + hanning-with-sidecar ok');
