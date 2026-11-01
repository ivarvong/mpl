// Histograms and error bars: request latency before and after a (hypothetical) cache rollout, as two
// overlaid stepfilled histograms with their medians, and the daily median with its p10–p90 spread as
// asymmetric error bars. ALL DATA HERE IS ILLUSTRATIVE: synthetic gamma-distributed samples rounded to
// whole milliseconds, not measurements. The same calls are an oracle case
// (fixtures/ref/example_histogram_errorbar), checked pixel for pixel against matplotlib.
// Writes examples/out/histogram_errorbar.{svg,png}; docs/images/histogram_errorbar.svg is this SVG.
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

// illustrative latency samples (ms), 120 requests each
const before = [144, 166, 61, 136, 129, 173, 133, 152, 147, 173, 122, 192, 112, 155, 149, 249, 109, 159, 125, 97, 166, 85, 103, 135, 172, 162, 143, 76, 110, 118,
  95, 69, 137, 164, 115, 172, 81, 93, 136, 112, 160, 151, 115, 84, 110, 152, 162, 112, 69, 80, 148, 114, 115, 93, 92, 171, 150, 105, 133, 141,
  214, 90, 140, 170, 206, 104, 114, 160, 75, 144, 240, 149, 57, 97, 105, 183, 123, 69, 128, 136, 109, 92, 248, 171, 176, 123, 103, 111, 81, 213,
  125, 197, 113, 150, 138, 78, 222, 114, 87, 161, 130, 145, 134, 59, 96, 95, 175, 131, 153, 116, 155, 123, 120, 138, 134, 276, 96, 75, 144, 100];
const after = [45, 71, 203, 76, 53, 199, 70, 244, 92, 178, 96, 120, 99, 96, 112, 122, 110, 106, 81, 101, 170, 79, 114, 152, 122, 140, 69, 114, 94, 95,
  165, 96, 115, 53, 178, 138, 102, 93, 126, 151, 179, 136, 106, 143, 134, 107, 133, 132, 102, 87, 128, 72, 67, 115, 127, 115, 119, 47, 126, 165,
  137, 135, 112, 114, 99, 118, 71, 166, 78, 137, 158, 137, 210, 48, 89, 157, 66, 78, 124, 106, 121, 109, 112, 81, 111, 91, 95, 136, 65, 41,
  133, 111, 158, 79, 101, 107, 84, 76, 135, 62, 71, 99, 140, 86, 83, 97, 117, 92, 146, 149, 99, 189, 106, 147, 116, 115, 57, 69, 94, 148];
// illustrative daily p50 latency (ms) and its distance down to p10 and up to p90
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const p50 = [131, 128, 125, 112, 109, 104, 102];
const below = [38, 35, 36, 30, 29, 27, 28];
const above = [52, 61, 49, 44, 47, 39, 41];

const [fig, [left, right]] = subplots(1, 2, { figsize: [10, 4] });   // a 1x2 grid squeezes to Axes[]
// n holds the counts, bins the shared edges (numpy's 'auto' estimator over both samples)
const [n, bins] = left.hist([before, after], { bins: 'auto', histtype: 'stepfilled', alpha: 0.5, label: ['before', 'after'] });
console.log(`hist: ${bins.length - 1} bins, peak counts ${n.map((row) => Math.max(...row)).join(' / ')}`);
left.axvline(130.5, { color: 'C0', linestyle: '--', label: 'median before' });
left.axvline(111, { color: 'C1', linestyle: '--', label: 'median after' });
left.set_xlabel('latency (ms)');
left.set_ylabel('requests');
left.set_title('Latency distribution (illustrative)');
left.legend();

right.errorbar(days, p50, { yerr: [below, above], fmt: 'o-', capsize: 4, label: 'p50 with p10–p90' });
right.axhline(100, { color: '0.5', linewidth: 0.8, linestyle: ':' });
right.set_ylabel('latency (ms)');
right.set_title('Daily median (illustrative)');
right.legend({ loc: 'upper right' });
fig.tight_layout();

save('histogram_errorbar', fig);
