// A date axis: AutoDateLocator / AutoDateFormatter pick ticks for the range: examples/out/dates.{svg,png}
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

const day = 24 * 3600 * 1000;
const start = Date.UTC(2026, 0, 1);
const dates = Array.from({ length: 120 }, (_, i) => new Date(start + i * day));
const price = dates.map((_, i) => 100 + 12 * Math.sin(i / 9) + i * 0.15);

const [fig, ax] = subplots();
ax.plot(dates, price, { label: 'close' });
ax.set_title('A quarter of daily prices');
ax.set_ylabel('USD');
ax.grid(true);
ax.legend();

save('dates', fig);
