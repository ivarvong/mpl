// mpl/core: no built-in face or colormap; unregistered defaults throw typed errors.
import assert from 'node:assert/strict';
import {
  ColormapNotLoadedError, FontNotLoadedError, registerColormaps, registerFonts, registeredColormaps,
  registeredFonts, subplots,
} from '../src/core.ts';
import { dejavuSans } from '../src/fonts/dejavu-sans.ts';
import { viridis } from '../src/colormaps/viridis.ts';

assert.deepEqual(registeredFonts(), []);
assert.deepEqual(registeredColormaps(), []);

const errFont = (f: () => unknown): FontNotLoadedError => {
  try { f(); } catch (e) { if (e instanceof FontNotLoadedError) return e; throw e; }
  assert.fail('expected FontNotLoadedError');
};
{
  const [fig, ax] = subplots();
  ax.plot([1, 2], [1, 2]);
  assert.equal(errFont(() => fig.toSVG()).face, 'DejaVu Sans:400');
}
registerFonts(dejavuSans);
{
  const [fig, ax] = subplots();
  ax.plot([1, 2], [1, 2]);
  assert.ok(fig.toSVG().startsWith('<svg'));
}

const errCmap = (f: () => unknown): ColormapNotLoadedError => {
  try { f(); } catch (e) { if (e instanceof ColormapNotLoadedError) return e; throw e; }
  assert.fail('expected ColormapNotLoadedError');
};
{
  const [, ax] = subplots();
  // scatter defaults cmap to 'viridis' even without a numeric c — must not fall back
  const e = errCmap(() => ax.scatter([1, 2], [1, 2], { c: [0, 1] }));
  assert.equal(e.cmap, 'viridis');
  assert.equal(e.binding, 'viridis');
  assert.match(e.message, /mpl\/colormaps\/viridis/);
}
{
  const [, ax] = subplots();
  const e = errCmap(() => ax.imshow([[0, 1], [2, 3]]));
  assert.equal(e.cmap, 'viridis');
}
registerColormaps(viridis);
{
  const [fig, ax] = subplots();
  ax.scatter([1, 2], [1, 2], { c: [0, 1], cmap: 'viridis' });
  assert.ok(fig.toSVG().includes('<svg') || fig.toSVG().startsWith('<svg'));
}
console.log('lean-core: empty registry throws FontNotLoadedError / ColormapNotLoadedError; register then renders');
