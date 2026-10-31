// Modern product charts: six chart forms written once against roles (C0…C7 for series, the
// preset's axes.labelcolor for secondary text) and rendered with the `modern` and `modernDark`
// presets. Every chart is recorded so tools/showcase_mpl.py can replay it in matplotlib.
//   node tools/modern_gallery.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modern, modernDark } from '../src/index.ts';
import { canvasOf } from '../src/render/agg/canvas.ts';
import { encodePNGSync } from '../src/render/png.ts';
import { recorder } from './recorder.mjs';

const OUT = process.argv[2] || join(tmpdir(), 'modern');
mkdirSync(OUT, { recursive: true });
let seed = 3;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());

/** Title (preset: left, semibold) with a one-line subtitle in the secondary ink under it. */
function heading(ax, rc, title, subtitle) {
  ax.set_title(title);
  ax.text(0, 1.035, subtitle, { transform: ax.transAxes, color: rc['axes.labelcolor'], fontsize: 9, va: 'bottom' });
}

const charts = {
  // 1 · change over time, ≤ 4 series: legend + direct end labels in ink
  wau: (make, rc) => {
    seed = 3;
    const t0 = Date.UTC(2026, 3, 6);
    const weeks = Array.from({ length: 28 }, (_, i) => new Date(t0 + i * 7 * 86400e3));
    const series = [['iOS', 41, 0.9], ['Android', 36, 1.25], ['Web', 24, 0.45], ['Desktop', 9, 0.2]];
    const [fig, ax] = make({ rc });
    const ends = [];
    series.forEach(([name, base, slope], k) => {
      const y = weeks.map((_, i) => base + slope * i + 1.2 * Math.sin(i / 2.3 + k) + 0.5 * gauss());
      ax.plot(weeks, y, { label: name, color: `C${k}` });
      ends.push([name, y[y.length - 1]]);
    });
    for (const [, v] of ends) ax.text(weeks[weeks.length - 1], v, `  ${v.toFixed(0)}K`, { fontsize: 8.5, va: 'center', color: rc['axes.labelcolor'] });
    const months = [4, 5, 6, 7, 8, 9].map((m) => new Date(Date.UTC(2026, m, 1)));
    ax.set_xticks(months);
    ax.set_xticklabels(['May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']);
    ax.set_ylim(0, 80);
    ax.legend({ loc: 'upper left', ncols: 4 });
    heading(ax, rc, 'Weekly active users', 'Thousands, by platform · last 28 weeks');
    return fig;
  },

  // 2 · one series over time: 10 % wash, 2 px line, emphasised end point with its value
  rps: (make, rc) => {
    seed = 5;
    const t0 = Date.UTC(2026, 9, 18);
    const ts = Array.from({ length: 96 }, (_, i) => new Date(t0 + i * 15 * 60e3));
    const y = ts.map((_, i) => 3.1 + 1.6 * Math.sin(((i / 96) * 24 - 8) / 24 * 2 * Math.PI) + 0.12 * gauss());
    const [fig, ax] = make({ rc });
    ax.fill_between(ts, y, 0, { facecolor: 'C0', alpha: 0.1, linewidth: 0 });
    ax.plot(ts, y, { color: 'C0' });
    const n = ts.length - 1;
    ax.plot([ts[n]], [y[n]], { marker: 'o', color: 'C0', linestyle: 'none', markersize: 7 });
    ax.text(ts[n], y[n] - 0.55, `${y[n].toFixed(2)}M now`, { ha: 'right', fontsize: 9, fontweight: 'semibold' });
    const hours = [0, 6, 12, 18, 24].map((h) => new Date(t0 + h * 3600e3));
    ax.set_xticks(hours);
    ax.set_xticklabels(['00:00', '06:00', '12:00', '18:00', '24:00']);
    ax.set_ylim(0, 6);
    heading(ax, rc, 'Requests per second', 'Millions · today, 15-minute buckets');
    return fig;
  },

  // 3 · magnitude by category, grouped: surface gap between touching columns, legend
  revenue: (make, rc) => {
    const q = ['Q1 25', 'Q2 25', 'Q3 25', 'Q4 25', 'Q1 26', 'Q2 26'];
    const data = [[4.1, 4.6, 5.0, 5.9, 6.2, 6.8], [3.2, 3.4, 3.9, 4.1, 4.6, 5.3], [1.4, 1.7, 2.1, 2.6, 3.1, 3.8]];
    const names = ['Americas', 'EMEA', 'APAC'];
    const [fig, ax] = make({ rc: { ...rc, 'axes.xmargin': 0.04 } });
    const w = 0.24, x = q.map((_, i) => i);
    data.forEach((v, k) => ax.bar(x.map((i) => i + (k - 1) * w), v, { width: w, color: `C${k}`, label: names[k] }));
    ax.set_xticks(x);
    ax.set_xticklabels(q);
    ax.set_ylim(0, 8);
    ax.legend({ loc: 'upper left', ncols: 3 });
    heading(ax, rc, 'Revenue by region', 'USD millions per quarter');
    return fig;
  },

  // 4 · part-to-whole per row: stacked bars with surface gaps, legend across the top
  waterfall: (make, rc) => {
    const svc = ['checkout', 'search', 'feed', 'auth', 'media'];
    const phases = [['DNS', [4, 3, 5, 2, 6]], ['TLS', [11, 9, 12, 8, 14]], ['Server', [38, 22, 61, 12, 30]], ['Transfer', [9, 6, 18, 3, 41]]];
    const [fig, ax] = make({ rc: { ...rc, 'axes.grid.axis': 'x', 'figure.subplot.left': 0.14, 'axes.ymargin': 0.04 } });
    const left = svc.map(() => 0);
    phases.forEach(([name, v], k) => {
      ax.barh(svc, v, { left: [...left], height: 0.56, color: `C${k}`, label: name });
      v.forEach((d, i) => { left[i] += d; });
    });
    left.forEach((tot, i) => ax.text(tot + 1.2, i, `${tot} ms`, { va: 'center', fontsize: 8.5, color: rc['axes.labelcolor'] }));
    ax.set_xlim(0, 110);
    ax.legend({ loc: 'lower right', ncols: 2 });
    heading(ax, rc, 'Where request time goes', 'Median per phase, milliseconds');
    return fig;
  },

  // 5 · relationship, ≤ 3 series (the palette's all-pairs cap): ringed markers on a log axis
  scatter: (make, rc) => {
    seed = 11;
    const [fig, ax] = make({ rc: { ...rc, 'axes.grid.axis': 'both' } });
    [['Workers', 0.06, 0.38], ['Containers', 0.6, 0.3], ['VMs', 3.1, 0.2]].forEach(([name, a, b], k) => {
      const x = Array.from({ length: 42 }, () => 10 ** (1 + 3 * rnd()));
      ax.plot(x, x.map((v) => a * v ** b * Math.exp(0.18 * gauss())), { linestyle: 'none', marker: 'o', markersize: 6.5, color: `C${k}`, label: name });
    });
    ax.set_xscale('log');
    ax.set_xlabel('payload (KB)');
    ax.set_ylabel('CPU time (ms)');
    ax.legend({ loc: 'upper left', ncols: 3 });
    heading(ax, rc, 'Cost of a request', 'CPU time against payload, by runtime');
    return fig;
  },

  // 6 · a distribution, one series: bars with surface gaps, percentile rules in secondary ink
  histogram: (make, rc) => {
    seed = 17;
    const v = Array.from({ length: 4000 }, () => Math.exp(3.1 + 0.42 * gauss()));
    const edges = Array.from({ length: 31 }, (_, i) => i * 4);
    const counts = edges.slice(0, -1).map((e) => v.filter((x) => x >= e && x < e + 4).length);
    const s = v.toSorted((p, q) => p - q), p50 = s[2000], p95 = s[3800];
    const [fig, ax] = make({ rc: { ...rc, 'axes.xmargin': 0 } });
    ax.bar(edges.slice(0, -1), counts, { width: 4, align: 'edge', color: 'C0' });
    const top = Math.max(...counts) * 1.12;
    for (const [p, name] of [[p50, 'p50'], [p95, 'p95']]) {
      ax.plot([p, p], [0, top], { color: rc['axes.labelcolor'], linewidth: 1, linestyle: '--' });
      ax.text(p + 1, top, `${name} ${p.toFixed(0)} ms`, { va: 'top', fontsize: 8.5, color: rc['axes.labelcolor'] });
    }
    ax.set_ylim(0, top * 1.04);
    ax.set_xlabel('response time (ms)');
    heading(ax, rc, 'Response time distribution', '4,000 requests, 4 ms bins');
    return fig;
  },
};

const sheets = {};
for (const [theme, rc] of [['light', modern], ['dark', modernDark]]) {
  const canv = [];
  for (const [name, build] of Object.entries(charts)) {
    const r = recorder();
    const fig = build(r.make, rc);
    writeFileSync(`${OUT}/${name}_${theme}.spec.json`, JSON.stringify(r.rec));
    writeFileSync(`${OUT}/${name}_${theme}.png`, fig.toPNGSync());
    canv.push(fig.toRGBA());
  }
  // 3 × 2 sheet, gutters in the page colour around the chart surfaces
  const G = 24, cw = canv[0].w, ch = canv[0].h, W = 3 * cw + 4 * G, H = 2 * ch + 3 * G;
  const px = new Uint8Array(W * H * 4), page = theme === 'light' ? [0xF1, 0xF0, 0xEC, 0xFF] : [0x0D, 0x0D, 0x0D, 0xFF];
  for (let i = 0; i < W * H; i++) px.set(page, i * 4);
  canv.forEach((c, i) => {
    const x0 = G + (i % 3) * (cw + G), y0 = G + Math.floor(i / 3) * (ch + G);
    for (let y = 0; y < c.h; y++) px.set(c.px.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((y0 + y) * W + x0) * 4);
  });
  sheets[theme] = encodePNGSync(canvasOf(W, H, 200, px));
  writeFileSync(`${OUT}/_sheet_${theme}.png`, sheets[theme]);
  console.log(`${theme}: ${W}×${H}, ${(sheets[theme].length / 1024).toFixed(0)} KiB`);
}
