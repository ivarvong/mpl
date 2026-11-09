// Annotated SVG: four charts rendered on the server with fig.toSVG({ interactive: true, idPrefix }), inlined in one
// page, made interactive by the mpl/interactive client (hover readout, nearest-point tooltip, highlight, legend
// toggles, arrow keys). The SVGs scale with the page (width/height dropped, viewBox kept). examples/out/interactive.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import type { Figure } from '../src/index.ts';
import { AutoDateLocator, ConciseDateFormatter, registerSidecar, subplots } from '../src/index.ts';
import { sidecar } from '../src/annotate.ts';
import { dashboard } from './_zoom-charts.ts';

registerSidecar(sidecar);   // the sidecar writer is opt-in (mpl/annotate), so default bundles do not carry it

/** The figure as SVG for inlining: ids prefixed, sized by CSS. */
const inline = (fig: Figure, id: string): string =>
  fig.toSVG({ interactive: true, idPrefix: `${id}-` }).replace(/^<svg([^>]*) width="[^"]*" height="[^"]*"/, `<svg$1 id="${id}" role="img"`);

// glyph outlines (matplotlib's svg.fonttype 'path'): the page shows the same text whatever fonts the viewer has
const rc = { 'svg.fonttype': 'path' } as const;

// 1. lines and a scatter, with a legend to toggle
const xs = Array.from({ length: 60 }, (_, i) => i / 6);
const [f1, a1] = subplots({ figsize: [6.4, 3.2], rc });
a1.plot(xs, xs.map(Math.sin), { label: 'sin' });
a1.plot(xs, xs.map(Math.cos), { label: 'cos', ls: '--' });
a1.scatter([1, 3, 5, 7, 9], [0.5, -0.4, 0.8, -0.9, 0.2], { label: 'samples', color: 'C3', zorder: 3 });
a1.set_title('Lines and points');
a1.legend({ loc: 'upper right' });

// fixed tick labels: the axis shows day names over hour numbers (set_xticks + set_xticklabels), so a point between days must not print its x
const hours = Array.from({ length: 84 }, (_, i) => i);
const [f0, a0] = subplots({ figsize: [6.4, 3.2], rc });
a0.plot(hours, hours.map((h) => 3000 + 1000 * Math.sin(h / 4)), { label: 'this week' });
a0.set_xticks([6, 18, 30, 42, 54, 66, 78]);
a0.set_xticklabels(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
a0.set_title('Fixed tick labels');

// 2. a date axis, steps
const day = 864e5, t0 = Date.UTC(2026, 9, 1);
const dates = Array.from({ length: 30 }, (_, i) => new Date(t0 + i * day));
const [f2, a2] = subplots({ figsize: [6.4, 3.2], rc });
a2.step(dates, dates.map((_, i) => 20 + ((i * 7) % 11)), { where: 'post', label: 'deploys / day' });
a2.xaxis.set_major_formatter(new ConciseDateFormatter(new AutoDateLocator()));
a2.set_title('Steps on a date axis');
a2.legend();
f2.tight_layout();

// 3. bars on a log axis, with a twin y axis
const [f3, a3] = subplots({ figsize: [6.4, 3.2], rc });
a3.bar([1, 2, 3, 4, 5, 6], [3, 40, 800, 120, 9000, 60], { label: 'requests' });
a3.set_yscale('log');
a3.set_ylabel('requests (log)');
const tw = a3.twinx();
tw.plot([1, 2, 3, 4, 5, 6], [12, 15, 31, 18, 44, 20], 'o-', { color: 'C1', label: 'p99 ms' });
tw.set_ylabel('p99 ms');
a3.set_title('Log bars and a twin axis');

// 4. subplots: categories, and an inverted axis
const [f4, [b1, b2]] = subplots(1, 2, { figsize: [6.4, 3.0], rc });
b1.barh(['alpha', 'beta', 'gamma', 'delta'], [5, 9, 2, 7], { color: 'C2', label: 'score' });
b1.set_title('Categories (barh)');
b2.plot([0, 1, 2, 3, 4], [10, 7, 8, 3, 1], 'o-', { label: 'depth' });
b2.set_ylim(12, 0);
b2.set_title('Inverted y');
f4.tight_layout();

const client = stripTypeScriptTypes(readFileSync(new URL('../src/interactive/client.ts', import.meta.url), 'utf8'), { mode: 'strip' });
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Annotated SVG</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #222; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181d; --fg: #e8e8e8; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; }
  svg { display: block; width: 100%; height: auto; margin: 0 0 24px; background: #fff; border-radius: 6px; color: #333; color-scheme: light; }
</style></head>
<body><main>
<h1>Annotated SVG</h1>
<p>Server-rendered by mpljs with <code>fig.toSVG({ interactive: true })</code>; the browser only reads the sidecar.
Hover a plot, click a legend entry, or focus a plot (Tab) and use the arrow keys.</p>
${inline(f1, 'lines')}
${inline(f2, 'dates')}
${inline(f3, 'logtwin')}
${inline(f4, 'grid')}
${inline(dashboard(), 'dash')}
${inline(f0, 'ticks')}
</main>
<script type="module">
${client}
attach(document);
</script>
</body></html>
`;
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./out/interactive.html', import.meta.url), page);
console.log(`wrote examples/out/interactive.html (${page.length} bytes)`);
