// Four starter, publication-ready charts using mpljs.
// Writes PNG + SVG into examples/out/ via the shared save() helper.
import { subplots } from '../src/index.ts';
import { save } from './_save.ts';

// 1) Grouped bars: quarterly revenue by region
{
  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
  const regions: ReadonlyArray<[string, number[]]> = [
    ['North America', [42, 48, 55, 61]],
    ['Europe',        [31, 34, 33, 40]],
    ['Asia-Pacific',  [18, 24, 31, 37]],
  ];
  const width = 0.27;
  const [fig, ax] = subplots({ style: 'ggplot' });
  regions.forEach(([label, values], i) => {
    ax.bar(quarters.map((_, j) => j + (i - 1) * width), values, { width, label });
  });
  ax.set_xticks([0, 1, 2, 3]);
  ax.set_xticklabels(quarters);
  ax.set_title('Revenue by region, 2026');
  ax.set_ylabel('revenue ($M)');
  ax.legend();
  save('starter_grouped_bars', fig);
}

// 2) Stacked horizontal bars: where the workday went
{
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const coding = [4.5, 5.0, 3.0, 5.5, 4.0];
  const meetings = [2.0, 1.5, 3.5, 1.0, 2.5];
  const email = [1.0, 1.0, 1.5, 0.5, 1.0];
  const [fig, ax] = subplots({ style: 'seaborn-v0_8-whitegrid' });
  ax.barh(days, coding, { label: 'coding' });
  ax.barh(days, meetings, { left: coding, label: 'meetings' });
  ax.barh(days, email, { left: coding.map((c, i) => c + meetings[i]), label: 'email' });
  ax.set_xlim(0, 10.5);
  ax.set_title('Where the workday went');
  ax.set_xlabel('hours');
  ax.legend({ loc: 'lower right' });
  save('starter_stacked_barh', fig);
}

// 3) Lines with a band: monthly temperatures
{
  const m = Array.from({ length: 12 }, (_, i) => i + 1);
  const nyHi = [39, 42, 50, 62, 72, 80, 85, 84, 76, 65, 54, 44];
  const nyLo = [26, 28, 35, 45, 55, 64, 70, 69, 61, 50, 41, 32];
  const sfAvg = [51, 53, 55, 56, 58, 60, 61, 62, 63, 61, 56, 51];
  const nyAvg = nyHi.map((h, i) => (h + nyLo[i]) / 2);
  const [fig, ax] = subplots({ style: 'fivethirtyeight' });
  ax.fill_between(m, nyLo, nyHi, { color: 'C0', alpha: 0.20, label: 'NYC low–high' });
  ax.plot(m, nyAvg, 'o-', { color: 'C0', label: 'NYC average' });
  ax.plot(m, sfAvg, 's--', { color: 'C1', label: 'SF average' });
  ax.set_xticks(m);
  ax.set_xticklabels(['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']);
  ax.set_title('Monthly temperatures (°F)');
  ax.legend();
  save('starter_temps_line', fig);
}

// 4) Date axis + twinx: daily signups with 7‑day avg and cumulative
{
  const dayMs = 24 * 3600 * 1000;
  const start = Date.UTC(2026, 6, 1); // July 1, 2026
  const n = 92;
  const dates = Array.from({ length: n }, (_, i) => new Date(start + i * dayMs));
  const daily = dates.map((_, i) =>
    Math.round(120 + i * 1.6 + 25 * Math.sin(i / 3.5) + 15 * Math.sin(i * 1.7)));
  const avg = daily.map((_, i) => {
    const window = daily.slice(Math.max(0, i - 6), i + 1);
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
  let acc = 0; const cumulativeK = daily.map((d) => (acc += d) / 1000);

  const [fig, ax] = subplots({ style: 'seaborn-v0_8-darkgrid' });
  ax.plot(dates, daily, { color: 'C0', alpha: 0.40, label: 'daily signups' });
  ax.plot(dates, avg, { color: 'C0', linewidth: 2.5, label: '7-day average' });
  ax.set_ylabel('signups / day');
  const r = ax.twinx();
  r.plot(dates, cumulativeK, '--', { color: 'C2', label: 'cumulative (k)' });
  r.set_ylabel('cumulative signups (k)');
  const xticks = [6, 7, 8, 9].map((mo) => new Date(Date.UTC(2026, mo, 1)));
  ax.set_xticks(xticks);
  ax.set_xticklabels(['Jul 1', 'Aug 1', 'Sep 1', 'Oct 1']);
  r.legend({ loc: 'lower right' });
  ax.set_title('Signups, Q3 2026');
  ax.legend({ loc: 'upper left' });
  save('starter_signups_dates', fig);
}

