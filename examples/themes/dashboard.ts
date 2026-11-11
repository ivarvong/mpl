// One service-health dashboard per bundled pro theme: latency percentiles with bands, stacked request
// counts by status, a latency heatmap with a colorbar, per-service error rates, and a value-coloured scatter. Each figure is
// also an oracle case (fixtures/ref/theme_<name>_dashboard), and test/examples.test.ts checks these
// renders against matplotlib's pixel for pixel. Writes examples/out/themes/<name>.{svg,png};
// docs/images/themes/ holds the same files for the README.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerColormapRgba, registerColormaps, registerFonts, subplots } from '../../src/index.ts';
import type { Figure } from '../../src/index.ts';
import { interBold } from '../../src/fonts/inter-bold.ts';
import { interMedium } from '../../src/fonts/inter-medium.ts';
import { interRegular } from '../../src/fonts/inter-regular.ts';
import { interSemibold } from '../../src/fonts/inter-semibold.ts';
import { allColormaps } from '../../src/colormaps/all.ts';
import { allColormapRgba } from '../../src/colormaps/all.rgba.ts';

registerFonts(interRegular, interMedium, interSemibold, interBold);  // pro sheets: font.family Inter
registerColormaps(...allColormaps);
registerColormapRgba(...allColormapRgba);

type Data = {
  readonly hours: readonly number[]; readonly p50: readonly number[]; readonly p95: readonly number[]; readonly p99: readonly number[];
  readonly bucket: readonly string[]; readonly ok: readonly number[]; readonly e4: readonly number[]; readonly e5: readonly number[];
  readonly size: readonly number[]; readonly dur: readonly number[]; readonly cache: readonly number[];
  readonly heat: readonly (readonly number[])[];
  readonly errors: Readonly<Record<'api' | 'web' | 'worker', readonly number[]>>;
};
const D: Data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url), 'utf8'));

/** Each theme with the colormap that reads best on its background (vmin pulls the dark end off a dark face). */
export const THEMES = [
  { name: 'pro-dark', cmap: 'viridis', vmin: -20, heat: 'magma' },
  { name: 'pro-mono', cmap: 'Blues', vmin: -40, heat: 'Greys' },
  { name: 'pro-ember', cmap: 'inferno', vmin: -40, heat: 'inferno' },
  { name: 'pro-slate', cmap: 'plasma', vmin: -10, heat: 'Blues' },
] as const;

export function dashboard(style: string, cmap: string, vmin: number, heat: string): Figure {
  const [fig, ax] = subplots(2, 3, { figsize: [13, 7], style });
  const ticks = [0, 6, 12, 18, 24], tickLabels = ['00:00', '06:00', '12:00', '18:00', '24:00'];

  const lat = ax[0][0];
  lat.fill_between(D.hours, D.p50, D.p99, { color: 'C0', alpha: 0.12, linewidth: 0 });
  lat.fill_between(D.hours, D.p50, D.p95, { color: 'C0', alpha: 0.22, linewidth: 0 });
  lat.plot(D.hours, D.p50, { color: 'C0', label: 'p50' });
  lat.plot(D.hours, D.p95, { color: 'C1', label: 'p95' });
  lat.plot(D.hours, D.p99, { color: 'C3', label: 'p99', linestyle: '--' });
  lat.axhline(150, { color: 'C5', linewidth: 0.8, linestyle: ':' });
  lat.set_xticks(ticks); lat.set_xticklabels(tickLabels);
  lat.set_ylim(0, 220);
  lat.legend({ loc: 'upper left', ncols: 3 });
  lat.set_title('Latency (ms)');

  const req = ax[0][1];
  const bottom5 = D.ok.map((v, i) => v + D.e4[i]);
  req.bar(D.bucket, D.ok, { color: 'C0', width: 0.72, label: '2xx' });
  req.bar(D.bucket, D.e4, { bottom: D.ok, color: 'C1', width: 0.72, label: '4xx' });
  req.bar(D.bucket, D.e5, { bottom: bottom5, color: 'C3', width: 0.72, label: '5xx' });
  req.legend({ loc: 'upper left', ncols: 3 });
  req.set_ylim(0, 1900);
  req.set_title('Requests / 2 h');

  // latency heatmap: requests per (30-min bucket, 20 ms bin), with a themed colorbar
  const hm = ax[0][2];
  const im = hm.imshow(D.heat, { cmap: heat, origin: 'lower', aspect: 'auto', interpolation: 'nearest', extent: [0, 24, 0, 320] });
  hm.set_xticks(ticks); hm.set_xticklabels(tickLabels);
  hm.set_title('Latency heatmap (ms)');
  fig.colorbar(im, { ax: hm, label: 'requests' });

  (['api', 'web'] as const).forEach((svc, i) => {
    const e = ax[1][i];
    e.fill_between(D.hours, 0, D.errors[svc], { color: `C${i}`, alpha: 0.18, linewidth: 0 });
    e.plot(D.hours, D.errors[svc], { color: `C${i}`, linewidth: 1.2 });
    e.axhline(1.5, { color: 'C5', linewidth: 0.8, linestyle: '--' });
    e.set_ylim(0, 2.6);
    e.set_xticks(ticks); e.set_xticklabels(tickLabels);
    e.set_title(`${svc} error rate (%)`);
  });

  const sc = ax[1][2];
  sc.scatter(D.size, D.dur, { c: D.cache, cmap, vmin, vmax: 100, s: 14, alpha: 0.9 });
  sc.set_title('Duration vs payload (colour: cache hit %)');
  sc.set_xscale('log');
  sc.set_xlabel('payload (kB)');


  fig.suptitle(`checkout service · last 24 h · ${style}`);
  // tight_layout takes the heatmap's colorbar with its cell (the cax shares the heatmap's topmost SubplotSpec)
  fig.tight_layout();
  return fig;
}

const OUT = new URL('../out/themes/', import.meta.url);
mkdirSync(OUT, { recursive: true });
for (const t of THEMES) {
  const fig = dashboard(t.name, t.cmap, t.vmin, t.heat);
  writeFileSync(new URL(`${t.name}.svg`, OUT), fig.toSVG());
  writeFileSync(new URL(`${t.name}.png`, OUT), fig.toPNGSync());
  console.log(`wrote examples/out/themes/${t.name}.{svg,png}`);
}
