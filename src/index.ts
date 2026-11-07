// Default entry: same API as mpl/core, plus matplotlib's default face and colormap registered
// so `import { subplots } from 'mpl'` renders with no register calls. For Workers / lean bundles
// that pay only for the assets they use, import from 'mpl/core' instead and register explicitly.
export * from './core.ts';

import { registerColormapRgba, registerColormaps, registerFonts } from './core.ts';
import { dejavuSans } from './fonts/dejavu-sans.ts';
import { viridis, viridis_r } from './colormaps/viridis.ts';
import { viridis_rgba } from './colormaps/viridis.rgba.ts';

registerFonts(dejavuSans);
registerColormaps(viridis, viridis_r);
registerColormapRgba(viridis_rgba);
