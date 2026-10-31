// Kitchen sink: one sheet, every feature family, each panel its own figure (one axes per figure),
// tiled into a single canvas and encoded by our PNG encoder. Every panel's calls are recorded so
// tools/showcase_mpl.py can replay them in matplotlib for a pixel diff.
//   node tools/kitchen_sink.mjs <outdir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paperClassic } from '../src/index.ts';
import { canvasOf } from '../src/render/agg/canvas.ts';
import { encodePNGSync } from '../src/render/png.ts';
import { recorder } from './recorder.mjs';

const OUT = process.argv[2] || join(tmpdir(), 'kitchen');
mkdirSync(OUT, { recursive: true });
const PANEL = { 'figure.figsize': [4, 3], 'figure.dpi': 150, 'figure.subplot.left': 0.15, 'figure.subplot.bottom': 0.15, 'figure.subplot.top': 0.88 };   // 600 × 450 px
const lin = (n, a, b) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1));
let seed = 42;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };

const panels = {
  linestyles: (make) => {
    const [fig, ax] = make({ rc: PANEL });
    const x = lin(200, 0, 10);
    [['-', 'solid'], ['--', 'dashed'], [':', 'dotted'], ['-.', 'dashdot']].forEach(([ls, name], k) =>
      ax.plot(x, x.map((v) => Math.sin(v + k * 0.8) + k * 0.35), { linestyle: ls, label: name, linewidth: 1.8 }));
    ax.set_title('Line styles');
    ax.legend({ loc: 'lower left', ncols: 2, fontsize: 8 });
    return fig;
  },
  markers: (make) => {
    const [fig, ax] = make({ rc: { ...PANEL, 'axes.xmargin': 0.12, 'axes.ymargin': 0.2 } });
    'o s ^ v < > D d x + * . p h X P'.split(' ').forEach((m, k) =>
      ax.plot([k % 4], [3 - Math.floor(k / 4)], { marker: m, markersize: 13, linestyle: 'none', markeredgewidth: 1.4 }));
    ax.set_xticks([]); ax.set_yticks([]);
    ax.set_title('16 marker shapes');
    return fig;
  },
  band: (make) => {
    const [fig, ax] = make({ rc: PANEL });
    const x = lin(60, 0, 6), y = x.map((v) => Math.exp(-v / 3) * Math.cos(2 * v));
    ax.fill_between(x, y.map((v, i) => v - 0.15 - 0.03 * x[i]), y.map((v, i) => v + 0.15 + 0.03 * x[i]), { alpha: 0.25 });
    ax.plot(x, y, { label: 'mean' });
    ax.fill_between(x, -1.1, y.map((v) => Math.min(v, -0.6)), { facecolor: 'C3', alpha: 0.5 });
    ax.set_title('fill_between');
    ax.set_xlabel('time (s)'); ax.set_ylabel('response');
    return fig;
  },
  bars: (make) => {
    const [fig, ax] = make({ rc: PANEL });
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], v = [12, 17, 15, 21, 19, 8, 6];
    ax.bar(days, v, { color: v.map((x) => (x >= 15 ? 'C0' : 'C7')) });
    v.forEach((x, i) => ax.text(i, x + 0.4, String(x), { ha: 'center', fontsize: 8 }));
    ax.set_ylim(0, 24);
    ax.set_title('bar, with value labels');
    return fig;
  },
  stacked: (make) => {
    const [fig, ax] = make({ rc: { ...PANEL, 'figure.subplot.left': 0.17 } });
    const teams = ['infra', 'api', 'web', 'data'], a = [5, 7, 3, 6], b = [2, 3, 4, 1], c = [1, 2, 2, 3];
    ax.barh(teams, a, { label: 'done' });
    ax.barh(teams, b, { left: a, label: 'review' });
    ax.barh(teams, c, { left: a.map((x, i) => x + b[i]), label: 'open' });
    ax.set_title('stacked barh');
    ax.legend({ loc: 'lower right', fontsize: 8 });
    return fig;
  },
  loglog: (make) => {
    const [fig, ax] = make({ rc: PANEL });
    const x = Array.from({ length: 80 }, () => 10 ** (rnd() * 4)), y = x.map((v) => 0.5 * v ** 1.5 * Math.exp(0.4 * (rnd() - 0.5)));
    ax.plot(x, y, { linestyle: 'none', marker: 'o', markersize: 4, alpha: 0.7 });
    ax.plot([1, 1e4], [0.5, 0.5 * 1e6], { color: 'k', linestyle: '--', linewidth: 1 });
    ax.set_xscale('log'); ax.set_yscale('log');
    ax.set_title('log–log, mathtext ticks');
    return fig;
  },
  dates: (make) => {
    const [fig, ax] = make({ rc: PANEL });
    const t0 = Date.UTC(2026, 9, 16);
    const ts = Array.from({ length: 72 }, (_, i) => new Date(t0 + i * 3600e3));
    ax.plot(ts, ts.map((_, i) => 50 + 30 * Math.sin((i / 24) * 2 * Math.PI) + 6 * (rnd() - 0.5)));
    const days = [0, 1, 2, 3].map((d) => new Date(t0 + d * 86400e3));
    ax.set_xticks(days);
    ax.set_xticklabels(['Fri 16', 'Sat 17', 'Sun 18', 'Mon 19']);
    ax.set_title('date axis, hourly');
    ax.set_ylabel('req/s');
    return fig;
  },
  twin: (make) => {
    const [fig, ax] = make({ rc: { ...PANEL, 'figure.subplot.right': 0.83 } });
    const m = ['J', 'F', 'M', 'A', 'M ', 'J ', 'J  ', 'A ', 'S', 'O', 'N', 'D'];
    const rain = [78, 62, 70, 61, 58, 45, 38, 41, 55, 79, 88, 90], temp = [3, 4, 7, 10, 14, 17, 19, 19, 16, 12, 7, 4];
    ax.bar(m, rain, { color: 'C0', alpha: 0.6 });
    ax.set_ylabel('rain (mm)');
    const ax2 = ax.twinx();
    ax2.plot(m, temp, { color: 'C3', marker: 'o' });
    ax2.set_ylabel('temperature (°C)');
    ax.set_title('twinx');
    return fig;
  },
  text: (make) => {
    const [fig, ax] = make({ rc: { ...PANEL, 'font.family': 'Inter' } });
    const T = ax.transAxes;
    ax.text(0.05, 0.86, 'Regular 400', { transform: T, fontsize: 11 });
    ax.text(0.05, 0.72, 'Medium 500', { transform: T, fontsize: 11, fontweight: 'medium' });
    ax.text(0.05, 0.58, 'SemiBold 600', { transform: T, fontsize: 11, fontweight: 'semibold' });
    ax.text(0.05, 0.44, 'Bold 700', { transform: T, fontsize: 11, fontweight: 'bold' });
    ax.text(0.05, 0.22, '−3.5 × 10 µs ± 2° → 1/2', { transform: T, fontsize: 10, color: 'C1' });
    ax.text(0.95, 0.86, 'right/top', { transform: T, ha: 'right', va: 'top', fontsize: 9 });
    ax.text(0.95, 0.5, 'right/center', { transform: T, ha: 'right', va: 'center', fontsize: 9 });
    ax.text(0.95, 0.06, 'right/bottom', { transform: T, ha: 'right', va: 'bottom', fontsize: 9 });
    ax.set_xticks([]); ax.set_yticks([]);
    ax.set_title('Inter, weights, text anchors', { loc: 'left' });
    return fig;
  },
  ggplot: (make) => {
    const [fig, ax] = make({ style: 'ggplot', rc: PANEL });
    const x = lin(50, 0, 10);
    for (let k = 0; k < 4; k++) ax.plot(x, x.map((v) => Math.sqrt(v) * (1 + 0.3 * k) + 0.2 * Math.sin(v * (k + 1))), { label: `series ${k + 1}` });
    ax.set_title("style: 'ggplot'");
    ax.legend({ fontsize: 8 });
    return fig;
  },
  dark: (make) => {
    const [fig, ax] = make({ style: 'dark_background', rc: PANEL });
    const x = lin(300, -6, 6);
    ax.plot(x, x.map((v) => Math.sin(3 * v) / (1 + v * v / 4)), { linewidth: 1.5 });
    ax.plot(x, x.map((v) => 1 / (1 + v * v / 4)), { linestyle: '--', linewidth: 1 });
    ax.plot(x, x.map((v) => -1 / (1 + v * v / 4)), { linestyle: '--', linewidth: 1 });
    ax.set_title("style: 'dark_background'");
    return fig;
  },
  paper: (make) => {
    const [fig, ax] = make({ rc: { ...paperClassic, ...PANEL, 'font.size': 10, 'axes.labelsize': 10, 'xtick.labelsize': 9, 'ytick.labelsize': 9, 'legend.fontsize': 9,
      'figure.subplot.left': 0.15, 'figure.subplot.bottom': 0.15, 'figure.subplot.top': 0.88 } });
    const n = [1, 2, 4, 8, 16, 32, 64];
    ax.plot(n, n.map((k) => k), { marker: 'o', label: 'ideal', color: 'C0' });
    ax.plot(n, n.map((k) => k / (1 + 0.012 * k * Math.log2(k))), { marker: 's', label: 'measured', color: 'C2' });
    ax.set_xscale('log'); ax.set_yscale('log');
    ax.set_xlabel('workers'); ax.set_ylabel('speed-up');
    ax.set_title('paperClassic preset');
    ax.legend({ loc: 'upper left' });
    return fig;
  },
};

// header strip, also drawn by the library
const header = (make) => {
  const [fig, ax] = make({ rc: { 'figure.figsize': [16, 0.8], 'figure.dpi': 150, 'font.family': 'Inter',
    'axes.spines.left': false, 'axes.spines.right': false, 'axes.spines.top': false, 'axes.spines.bottom': false,
    'figure.facecolor': '#14161B', 'axes.facecolor': '#14161B', 'savefig.facecolor': '#14161B',
    'figure.subplot.left': 0, 'figure.subplot.right': 1, 'figure.subplot.bottom': 0, 'figure.subplot.top': 1 } });
  ax.set_xticks([]); ax.set_yticks([]);
  ax.text(0.012, 0.5, 'mpljs', { transform: ax.transAxes, fontsize: 20, fontweight: 'bold', color: '#FFFFFF', va: 'center' });
  ax.text(0.075, 0.5, 'kitchen sink · 12 panels + this header, each replayed in matplotlib 3.11.2 and diffed', { transform: ax.transAxes, fontsize: 11, color: '#A2A9B6', va: 'center' });
  return fig;
};

const all = { header, ...panels };
const figs = {};
for (const [name, build] of Object.entries(all)) {
  const r = recorder();
  const fig = build(r.make);
  writeFileSync(`${OUT}/${name}.spec.json`, JSON.stringify(r.rec));
  writeFileSync(`${OUT}/${name}.png`, fig.toPNGSync());
  figs[name] = fig.toRGBA();
}

// tile: header across the top, then 4 × 3 panels with gutters
const G = 16, PW = 600, PH = 450, COLS = 4, ROWS = 3;
const W = COLS * PW + (COLS + 1) * G, Hh = figs.header.h, H = Hh + G + ROWS * PH + ROWS * G;
const px = new Uint8Array(W * H * 4);
const u32 = new Uint32Array(px.buffer);
u32.fill(new Uint32Array(new Uint8Array([0xE6, 0xE8, 0xEC, 0xFF]).buffer)[0]);
const blit = (c, x0, y0) => { for (let y = 0; y < c.h; y++) px.set(c.px.subarray(y * c.w * 4, (y + 1) * c.w * 4), ((y0 + y) * W + x0) * 4); };
blit(figs.header, Math.floor((W - figs.header.w) / 2), 0);
Object.keys(panels).forEach((name, i) => blit(figs[name], G + (i % COLS) * (PW + G), Hh + G + Math.floor(i / COLS) * (PH + G)));
const sheet = encodePNGSync(canvasOf(W, H, 150, px));
writeFileSync(`${OUT}/_sheet.png`, sheet);
console.log(`sheet ${W}×${H}, ${(sheet.length / 1024).toFixed(0)} KiB → ${OUT}/_sheet.png`);
