// Zoom and pan: five charts rendered on the server (annotated SVG), made zoomable in the browser by mpl/zoom, with the
// mpl/interactive hover client on top. Nothing loads until the first gesture: then the page imports its chart chunk
// (mpljs + examples/_zoom-charts.ts, bundled), builds the same figure, and renders every frame for real with set_xlim /
// set_ylim. The page is self-contained (the chunk is inlined and imported from a blob: URL). examples/out/zoom.html
//   window.mplZoomConfig (set before load) overrides zoom() options for every chart, e.g. { renderer: 'svg' };
//   window.mplZoom[id] is each chart's controller; window.mplZoomFrame(id, frame, svg), if set, sees every frame.
//   node examples/zoom.ts [out.html id…] writes another set of charts (ids as _zoom-charts.ts build() takes them).
import { mkdirSync, writeFileSync } from 'node:fs';
import { build as esbuild } from 'esbuild';
import { build, CHARTS } from './_zoom-charts.ts';

const [outArg = '', ...idArgs] = process.argv.slice(2);
const ids = idArgs.length > 0 ? idArgs : Object.keys(CHARTS);

/** The figure as SVG for inlining: ids prefixed, sized by CSS, marked as a chart. */
const inline = (id: string): string =>
  build(id).toSVG({ interactive: true, idPrefix: `${id}-` }).replace(/^<svg([^>]*) width="[^"]*" height="[^"]*"/, `<svg$1 id="${id}" data-chart="${id}" role="img"`);

const bundle = async (contents: string, name: string): Promise<string> => {
  const r = await esbuild({
    stdin: { contents, resolveDir: new URL('.', import.meta.url).pathname, sourcefile: name, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', minify: true, write: false, target: 'es2022', legalComments: 'none', external: ['node:*'],
  });
  const js = r.outputFiles[0].text;
  // the chunk sits in a <script type="text/plain">: it must not end it early
  return js.replace(/<\/(script)/gi, '<\\/$1');
};

// what the page runs at load: the hover client and the zoom wiring (no mpljs; that is the lazy chunk)
const PAGE = `
import { attach } from '../src/interactive/client.ts';
import { zoom } from '../src/interactive/zoom.ts';
const w = window;
let chunk = null;
const load = () => (chunk ||= (async () => {
  w.mplChunkLoads = (w.mplChunkLoads || 0) + 1;
  const src = document.getElementById('mpl-chunk').textContent;
  return import(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
})());
attach(document);
w.mplZoom = {};
for (const svg of document.querySelectorAll('svg[data-chart]')) {
  const id = svg.id, status = document.getElementById(id + '-status');
  const ctl = zoom(svg, {
    idPrefix: id + '-',
    load: async () => (await load()).build(id),
    onFrame: (f) => {
      status.textContent = f.svg === '' && f.kind === 'svg' ? 'first paint (server render)'
        : \`\${f.kind}\${f.kind === 'canvas' ? ' ' + f.scale + 'x' : ''} frame: \${(f.renderMs + f.domMs).toFixed(1)} ms (render \${f.renderMs.toFixed(1)} + DOM \${f.domMs.toFixed(1)})\`;
      if (typeof w.mplZoomFrame === 'function') w.mplZoomFrame(id, f, svg);
    },
    ...(w.mplZoomConfig || {}),
  });
  w.mplZoom[id] = ctl;
  document.getElementById(id + '-reset').addEventListener('click', () => ctl.reset());
}
`;

const [pageJs, chunkJs] = await Promise.all([bundle(PAGE, 'zoom-page.ts'), bundle("export { build } from './_zoom-charts.ts';", 'zoom-chunk.ts')]);
const titles: Readonly<Record<string, string>> = {
  lines: 'Linear axes, a legend to toggle', logy: 'Log y', dates: 'Date x', shared: 'sharex and twinx', dense: '2000 points and a colorbar',
};
const charts = ids.map((id) => `<section>
<h2>${Object.hasOwn(titles, id) ? titles[id] : id}</h2>
${inline(id)}
<p class="bar"><button type="button" id="${id}-reset">Reset</button> <span class="status" id="${id}-status" aria-live="off">first paint (server render)</span></p>
</section>`).join('\n');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zoom and pan</title>
<style>
  :root { color-scheme: light dark; --bg: #fff; --fg: #222; --muted: #666; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16181d; --fg: #e8e8e8; --muted: #9aa0a6; } }
  body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
  main { max-width: 760px; margin: 0 auto; }
  h2 { font-size: 16px; margin: 24px 0 8px; }
  svg { display: block; width: 100%; height: auto; background: #fff; border-radius: 6px; color: #333; color-scheme: light; }
  .bar { display: flex; gap: 12px; align-items: center; margin: 6px 0 0; font-size: 13px; color: var(--muted); }
  .bar button { font: inherit; padding: 2px 10px; }
  .status { font-variant-numeric: tabular-nums; }
  kbd { font: 12px ui-monospace, monospace; border: 1px solid var(--muted); border-radius: 3px; padding: 0 4px; }
</style></head>
<body><main>
<h1>Zoom and pan</h1>
<p>Server-rendered by mpljs. The first gesture loads mpljs and the chart code, and from then on every frame is a real
mpljs render (<code>set_xlim</code>/<code>set_ylim</code> + <code>toSVG</code>, or <code>toRGBA</code> on a canvas while a
dense chart moves). Scroll or pinch to zoom about the pointer, drag to pan, <kbd>Shift</kbd>+drag to zoom to a box, scroll
over an axis to zoom only that axis, double-click or <kbd>Esc</kbd> to reset. With a chart focused: <kbd>+</kbd>
<kbd>-</kbd> zoom, arrow keys pan, <kbd>0</kbd> resets.</p>
${charts}
</main>
<script type="text/plain" id="mpl-chunk">${chunkJs}</script>
<script type="module">${pageJs}</script>
</body></html>
`;
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
writeFileSync(outArg !== '' ? outArg : new URL('./out/zoom.html', import.meta.url), page);
console.log(`wrote ${outArg !== '' ? outArg : 'examples/out/zoom.html'} (${page.length} bytes; page script ${pageJs.length} B, lazy chunk ${chunkJs.length} B)`);
