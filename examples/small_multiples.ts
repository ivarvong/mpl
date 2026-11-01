// Small multiples: one panel per series on a shared-axis 2x3 grid. Tick labels stay on the outer
// panels only (label_outer), and the figure carries a suptitle and shared axis labels; tight_layout
// does the spacing. The same calls are an oracle case (fixtures/ref/example_small_multiples), checked
// pixel for pixel against matplotlib. Writes examples/out/small_multiples.{svg,png};
// docs/images/small_multiples.svg is this SVG.
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

const months = Array.from({ length: 12 }, (_, i) => i + 1);
// monthly means, rounded to 0.1 °C (illustrative seasonal curves)
const cities: readonly { readonly name: string; readonly temps: readonly number[] }[] = [
  { name: 'Oslo', temps: [-4.0, -2.7, 1.0, 6.0, 11.0, 14.7, 16.0, 14.7, 11.0, 6.0, 1.0, -2.7] },
  { name: 'Lisbon', temps: [11.0, 11.8, 14.0, 17.0, 20.0, 22.2, 23.0, 22.2, 20.0, 17.0, 14.0, 11.8] },
  { name: 'Cairo', temps: [15.0, 15.9, 18.5, 22.0, 25.5, 28.1, 29.0, 28.1, 25.5, 22.0, 18.5, 15.9] },
  { name: 'Sydney', temps: [23.0, 22.3, 20.5, 18.0, 15.5, 13.7, 13.0, 13.7, 15.5, 18.0, 20.5, 22.3] },
  { name: 'Quito', temps: [13.5, 13.6, 13.8, 14.0, 14.2, 14.4, 14.5, 14.4, 14.2, 14.0, 13.8, 13.6] },
  { name: 'Montreal', temps: [-8.0, -6.0, -0.5, 7.0, 14.5, 20.0, 22.0, 20.0, 14.5, 7.0, -0.5, -6.0] },
];

const [fig, axes] = subplots(2, 3, { sharex: true, sharey: true, figsize: [9, 5] });   // axes: Axes[][] (2 rows of 3)
cities.forEach((c, i) => {
  const ax = axes[Math.floor(i / 3)][i % 3];
  ax.plot(months, c.temps, 'o-', { color: `C${i}`, markersize: 4 });
  ax.set_title(c.name);
  ax.grid(true, { color: '0.9' });
});
fig.suptitle('Monthly mean temperature');
fig.supxlabel('month');
fig.supylabel('°C');
fig.tight_layout();

save('small_multiples', fig);
