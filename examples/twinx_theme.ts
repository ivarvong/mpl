// Two y axes (twinx) in a bundled matplotlib style: examples/out/twinx_theme.{svg,png}
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const revenue = [12, 15, 14, 19, 24, 27];
const growth = [0, 25, -6.7, 35.7, 26.3, 12.5];

const [fig, ax] = subplots({ style: 'dark_background' });
ax.bar(months, revenue, { label: 'revenue ($k)' });
ax.set_ylabel('revenue ($k)');
const right = ax.twinx();
right.plot([0, 1, 2, 3, 4, 5], growth, 'o-', { color: 'C1', label: 'growth (%)' });
right.set_ylabel('growth (%)');
ax.set_title('Revenue and growth');

save('twinx_theme', fig);
