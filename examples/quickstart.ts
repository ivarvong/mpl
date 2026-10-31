// Lines: `npm run example`  ->  examples/out/quickstart.{svg,png}
// In your own project the import is `from 'mpljs'`; inside this repo it is the TypeScript source.
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

const x = Array.from({ length: 200 }, (_, i) => (i / 199) * 4 * Math.PI);

const [fig, ax] = subplots();
ax.plot(x, x.map(Math.sin), { label: 'sin(x)' });
ax.plot(x, x.map(Math.cos), '--', { label: 'cos(x)' });
ax.set_title('Sine and cosine');
ax.set_xlabel('x (radians)');
ax.set_ylabel('amplitude');
ax.grid(true);
ax.legend();

save('quickstart', fig);
