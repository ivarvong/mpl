// Categorical bars, themed: examples/out/bars.{svg,png}
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

const [fig, ax] = subplots({ style: 'ggplot' });
ax.bar(['apples', 'bananas', 'cherries', 'dates', 'elderberries'], [23, 17, 35, 29, 12], { label: 'sold' });
ax.set_title('Fruit sold this week');
ax.set_ylabel('crates');
ax.legend();

save('bars', fig);
