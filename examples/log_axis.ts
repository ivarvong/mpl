// Log scale with matplotlib's LogLocator and 10^n tick labels: examples/out/log_axis.{svg,png}
import { registerFonts, subplots } from '../src/index.ts';
import { dejavuSans } from '../src/fonts/dejavu-sans.ts';
import { save } from './_save.ts';

registerFonts(dejavuSans);

const x = Array.from({ length: 60 }, (_, i) => i);

const [fig, ax] = subplots();
ax.plot(x, x.map((v) => 10 ** (v / 10)), 'o-', { label: 'exponential' });
ax.plot(x, x.map((v) => 1 + v * v), '-', { label: 'quadratic' });
ax.set_yscale('log');
ax.set_title('Growth on a log axis');
ax.set_xlabel('step');
ax.grid(true);
ax.legend({ loc: 'upper left' });

save('log_axis', fig);
