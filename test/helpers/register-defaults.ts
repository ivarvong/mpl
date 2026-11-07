// Unit-test helper: register the faces a default rc figure needs. Production code must import
// and register explicitly; these helpers exist so each unit test does not repeat the same lines.
import { registerColormapRgba, registerColormaps, registerFonts } from '../../src/index.ts';
import { dejavuSans } from '../../src/fonts/dejavu-sans.ts';
import { viridis, viridis_r } from '../../src/colormaps/viridis.ts';
import { viridis_rgba } from '../../src/colormaps/viridis.rgba.ts';

/** Register DejaVu Sans (matplotlib's default face). */
export function registerDefaultFonts(): void {
  registerFonts(dejavuSans);
}

/** Register viridis (+ _r + rgba) for tests that imshow/scatter with the default cmap. */
export function registerDefaultColormaps(): void {
  registerColormaps(viridis, viridis_r);
  registerColormapRgba(viridis_rgba);
}
