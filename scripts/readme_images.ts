// The README's hero gallery: six panels drawn by mpljs in the pro-slate (light) and pro-dark (dark) sheets,
// rendered at 2× (retina) as palette PNGs so GitHub shows them crisp, with no font fallback (text is rasterized).
// `node scripts/readme_images.ts` writes docs/images/readme/hero-{light,dark}.png; test/examples.test.ts
// re-renders them and fails if the committed files are stale.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerColormaps, registerFonts, subplots } from '../src/index.ts';
import type { Figure } from '../src/index.ts';
import { interMedium } from '../src/fonts/inter-medium.ts';
import { interRegular } from '../src/fonts/inter-regular.ts';
import { interSemibold } from '../src/fonts/inter-semibold.ts';
import { allColormaps } from '../src/colormaps/all.ts';

registerFonts(interRegular, interMedium, interSemibold);
registerColormaps(...allColormaps);

type Data = {
  readonly hours: readonly number[]; readonly p50: readonly number[]; readonly p95: readonly number[]; readonly p99: readonly number[];
  readonly bucket: readonly string[]; readonly ok: readonly number[]; readonly e4: readonly number[]; readonly e5: readonly number[];
  readonly size: readonly number[]; readonly dur: readonly number[]; readonly cache: readonly number[];
  readonly heat: readonly (readonly number[])[];
};
const D: Data = JSON.parse(readFileSync(new URL('../examples/themes/data.json', import.meta.url), 'utf8'));

/** Deterministic log-normal samples (LCG + Box-Muller), so the histogram is the same on every run. */
function lognormal(n: number, mu: number, sigma: number, seed: number): number[] {
  let s = seed >>> 0;
  const u = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return Array.from({ length: n }, () => Math.exp(mu + sigma * Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u())));
}

const SPANS = [
  { label: 'GET /checkout', start: 0, end: 120, color: 'C0' },
  { label: 'auth.verify', start: 2, end: 14, color: 'C1' },
  { label: 'db.query', start: 15, end: 55, color: 'C2' },
  { label: 'pool.acquire', start: 15, end: 19, color: 'C2' },
  { label: 'inventory', start: 56, end: 92, color: 'C4' },
  { label: 'render.json', start: 93, end: 118, color: 'C1' },
];

export const HERO = [
  { name: 'hero-light', style: 'pro-slate', heat: 'Blues', cmap: 'plasma', vmin: -10 },
  { name: 'hero-dark', style: 'pro-dark', heat: 'magma', cmap: 'viridis', vmin: -20 },
] as const;

export function hero(style: string, heat: string, cmap: string, vmin: number): Figure {
  // larger type than the sheets' dashboard sizes: the gallery is read on a phone, about 360 px wide
  const rc = { 'font.size': 10, 'axes.titlesize': 13, 'axes.labelsize': 10, 'xtick.labelsize': 9.5, 'ytick.labelsize': 9.5, 'legend.fontsize': 9.5 };
  const [fig, ax] = subplots(3, 2, { figsize: [5.8, 7.8], style: [style, rc] });
  const ticks = [0, 8, 16, 24], tickLabels = ['00:00', '08:00', '16:00', '24:00'];

  const lat = ax[0][0];
  lat.fill_between(D.hours, D.p50, D.p99, { color: 'C0', alpha: 0.12, linewidth: 0 });
  lat.fill_between(D.hours, D.p50, D.p95, { color: 'C0', alpha: 0.22, linewidth: 0 });
  lat.plot(D.hours, D.p50, { color: 'C0', label: 'p50' });
  lat.plot(D.hours, D.p95, { color: 'C1', label: 'p95' });
  lat.plot(D.hours, D.p99, { color: 'C3', label: 'p99', linestyle: '--' });
  lat.set_xticks(ticks); lat.set_xticklabels(tickLabels);
  lat.set_ylim(0, 265);
  lat.legend({ loc: 'upper left', ncols: 3 });
  lat.set_title('Latency (ms)');

  const hm = ax[0][1];
  const im = hm.imshow(D.heat, { cmap: heat, origin: 'lower', aspect: 'auto', interpolation: 'nearest', extent: [0, 24, 0, 320] });
  hm.set_xticks([0, 12, 24]); hm.set_xticklabels(['00:00', '12:00', '24:00']);
  hm.set_title('Latency heatmap');
  hm.grid(false);
  fig.colorbar(im, { ax: hm });

  const tr = ax[1][0];
  const rows = SPANS.map((_, i) => i);
  tr.barh(rows, SPANS.map((s) => s.end - s.start), { left: SPANS.map((s) => s.start), color: SPANS.map((s) => s.color), height: 0.62 });
  tr.set_yticks(rows); tr.set_yticklabels(SPANS.map((s) => s.label));
  tr.set_ylim(SPANS.length - 0.4, -0.6);
  tr.grid(false, { axis: 'y' }); tr.grid(true, { axis: 'x' });
  tr.set_xlabel('ms since request start');
  tr.set_title('Request trace');

  const sc = ax[1][1];
  sc.scatter(D.size, D.dur, { c: D.cache, cmap, vmin, vmax: 100, s: 12, alpha: 0.9 });
  sc.set_xscale('log');
  sc.set_xlabel('payload (kB)');
  sc.set_title('Duration vs payload');

  const req = ax[2][0], hrs = D.bucket.map((_, i) => 2 * i);
  req.bar(hrs, D.ok, { color: 'C0', width: 1.44, label: '2xx' });
  req.bar(hrs, D.e4, { bottom: D.ok, color: 'C1', width: 1.44, label: '4xx' });
  req.bar(hrs, D.e5, { bottom: D.ok.map((v, i) => v + D.e4[i]), color: 'C3', width: 1.44, label: '5xx' });
  req.legend({ loc: 'upper left', ncols: 3 });
  req.set_xticks([0, 8, 16]); req.set_xticklabels(['00:00', '08:00', '16:00']);
  req.set_ylim(0, 1950);
  req.set_title('Requests / 2 h');

  const hs = ax[2][1];
  hs.hist(lognormal(4000, 3.55, 0.3, 11), { bins: 40, range: [0, 160], histtype: 'stepfilled', alpha: 0.5, color: 'C2', label: 'after' });
  hs.hist(lognormal(4000, 3.9, 0.35, 7), { bins: 40, range: [0, 160], histtype: 'step', linewidth: 1.4, color: 'C3', label: 'before' });
  hs.legend({ loc: 'upper right' });
  hs.set_xlabel('latency (ms)');
  hs.set_title('Before / after deploy');

  fig.subplots_adjust({ left: 0.19, right: 0.955, bottom: 0.07, top: 0.955, wspace: 0.42, hspace: 0.62 });
  return fig;
}

/** Every README image this script owns: path under docs/images/readme/ → PNG bytes. */
export function readmeImages(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const h of HERO) out.set(`${h.name}.png`, hero(h.style, h.heat, h.cmap, h.vmin).toPNGSync({ scale: 2, colors: 256, level: 9 }));
  return out;
}

if (import.meta.main) {
  const dir = new URL('../docs/images/readme/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  for (const [name, png] of readmeImages()) {
    writeFileSync(new URL(name, dir), png);
    console.log(`wrote docs/images/readme/${name} (${png.length.toLocaleString('en-US')} B)`);
  }
}
