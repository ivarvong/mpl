import { writeFileSync } from 'node:fs';
import { subplots } from '../src/index.ts';

const Z = [
  [0.0, 0.2, 0.4, 0.6, 0.8],
  [0.1, 0.3, 0.5, 0.7, 0.9],
  [0.2, 0.4, 0.6, 0.8, 1.0],
  [0.3, 0.5, 0.7, 0.9, 0.8],
  [0.4, 0.6, 0.8, 1.0, 0.7],
];
const [fig, ax] = subplots({ figsize: [6.4, 4.8] });
const im = ax.imshow(Z, { cmap: 'viridis', origin: 'lower' });
ax.set_title('viridis heatmap');
fig.colorbar(im, { label: 'intensity' });
writeFileSync(new URL('../docs/images/imshow_colorbar.png', import.meta.url), fig.toPNGSync());
writeFileSync(new URL('../docs/images/imshow_colorbar.svg', import.meta.url), fig.toSVG());
console.log('wrote docs/images/imshow_colorbar.{png,svg}');
