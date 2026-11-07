import { writeFileSync, mkdirSync } from 'node:fs';
import { registerColormaps, registerFonts, subplots } from '../src/index.ts';
import { dejavuSans } from '../src/fonts/dejavu-sans.ts';
import { viridis } from '../src/colormaps/viridis.ts';

registerFonts(dejavuSans);
registerColormaps(viridis);

mkdirSync('examples/out', { recursive: true });
const x = Array.from({ length: 40 }, (_, i) => (i / 39) * 4 * Math.PI);
const y = x.map((v) => Math.sin(v));
const c = x.map((v) => (v / (4 * Math.PI)));
const [fig, ax] = subplots({ figsize: [6, 3.5] });
ax.scatter(x, y, { c, cmap: 'viridis', s: 40, edgecolors: 'none' });
ax.set_title('scatter(c, cmap=viridis)');
ax.set_xlabel('x'); ax.set_ylabel('sin(x)');
fig.tight_layout();
writeFileSync('examples/out/scatter_cmap.svg', fig.toSVG());
writeFileSync('examples/out/scatter_cmap.png', fig.toPNGSync());
writeFileSync('docs/images/scatter_cmap.png', fig.toPNGSync());
console.log('wrote examples/out/scatter_cmap.{svg,png} and docs/images/scatter_cmap.png');
