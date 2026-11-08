// Minified + gzipped size of dist/browser as a bundler sees it (esbuild, ESM, browser platform), for a
// few scenarios (ENTRIES), plus what the bytes are made of. `node scripts/bundle_size.ts` prints; `--update` rewrites size-budget.json.
// test/size.test.ts fails when a bundle grows more than 2% past its budget.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { build, type Metafile } from 'esbuild';

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist/browser');
export const BUDGET_FILE = join(ROOT, 'size-budget.json');

/** What an application imports, and which modules it leaves out. */
export type Scenario = { readonly what: string; readonly entry: string; readonly external: readonly string[] };
const MAIN = `import { subplots } from './index.js';
const [fig, ax] = subplots();
ax.plot([1, 2, 3], [1, 4, 9]);
export const svg = fig.toSVG(), png = fig.toPNGSync();`;
const LEAN = `import { subplots } from './core.js';
const [fig, ax] = subplots();
ax.plot([1, 2, 3], [1, 4, 9]);
export const svg = fig.toSVG(), png = fig.toPNGSync();`;
const LEAN_INTER_2CMAP = `import { registerColormapRgba, registerColormaps, registerFonts, subplots } from './core.js';
import { interRegular } from './fonts/inter-regular.js';
import { interMedium } from './fonts/inter-medium.js';
import { interSemibold } from './fonts/inter-semibold.js';
import { interBold } from './fonts/inter-bold.js';
import { magma } from './colormaps/magma.js';
import { magma_rgba } from './colormaps/magma.rgba.js';
import { viridis } from './colormaps/viridis.js';
import { viridis_rgba } from './colormaps/viridis.rgba.js';
registerFonts(interRegular, interMedium, interSemibold, interBold);
registerColormaps(magma, viridis);
registerColormapRgba(magma_rgba, viridis_rgba);
const [fig, ax] = subplots();
ax.plot([1, 2, 3], [1, 4, 9]);
export const svg = fig.toSVG(), png = fig.toPNGSync();`;
const MAIN_ANNOTATE = `import { registerSidecar, subplots } from './index.js';
import { sidecar } from './annotate.js';
registerSidecar(sidecar);
const [fig, ax] = subplots();
ax.plot([1, 2, 3], [1, 4, 9]);
export const svg = fig.toSVG({ interactive: true }), png = fig.toPNGSync();`;
export const ENTRIES: Readonly<Record<string, Scenario>> = {
  main: { what: 'default entry: subplots → plot → toSVG + toPNGSync (DejaVu Sans + viridis built in)', entry: MAIN, external: [] },
  lean: { what: 'mpl/core with no faces or colormaps registered (code + tables only)', entry: LEAN, external: [] },
  'lean+inter+2cmaps': { what: 'mpl/core + Inter×4 + magma + viridis (+ rgba)', entry: LEAN_INTER_2CMAP, external: [] },
  everything: { what: 'every export of mpl plus every face (mpl/fonts/all)', entry: "export * from './index.js';\nexport * from './fonts/all.js';", external: [] },
  'main+annotate': { what: 'default entry plus the opt-in sidecar writer (mpl/annotate): toSVG({ interactive: true })', entry: MAIN_ANNOTATE, external: [] },
  interactive: { what: 'mpl/interactive: the annotated-SVG client alone (what a page ships)', entry: "export { attach } from './interactive/client.js';", external: [] },
  zoom: { what: 'mpl/zoom + mpl/interactive: what a zoomable page ships up front (mpljs itself loads on the first gesture)', entry: "export { attach } from './interactive/client.js';\nexport { zoom } from './interactive/zoom.js';", external: [] },
};

export type Size = { readonly min: number; readonly gzip: number };
export type Part = { readonly group: string; readonly bytes: number };
export type Measured = { readonly name: string; readonly size: Size; readonly parts: readonly Part[] };

/** Which slice of the library an input file belongs to. */
function groupOf(path: string): string {
  const m = /\/fonts\/([a-z-]+)\.[jt]s$/.exec(path);
  if (m !== null) return m[1] === 'all' ? 'code: api, layout, axes, text, ...' : `font ${m[1]} (glyph outlines + metrics)`;
  const c = /\/colormaps\/([a-zA-Z0-9_.-]+)\.[jt]s$/.exec(path);
  if (c !== null) return c[1].startsWith('all') ? 'code: api, layout, axes, text, ...' : `colormap ${c[1]}`;
  if (path.includes('core/data/')) return 'other data (stylelib, colors, markers)';
  if (path.endsWith('core/fontcodec.js')) return 'font decoder';
  if (path.includes('/render/')) return 'renderers (agg, svg, png)';
  return 'code: api, layout, axes, text, ...';
}

export async function measure(name: string): Promise<Measured> {
  const r = await build({
    stdin: { contents: ENTRIES[name].entry, resolveDir: DIST, sourcefile: `${name}.js`, loader: 'js' },
    bundle: true, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
    external: ['node:*', ...ENTRIES[name].external], write: false, metafile: true, logLevel: 'silent',
  });
  const code = r.outputFiles[0].contents;
  const meta: Metafile = r.metafile;
  const totals = new Map<string, number>();
  for (const out of Object.values(meta.outputs))
    for (const [file, { bytesInOutput }] of Object.entries(out.inputs))
      totals.set(groupOf(file), (totals.get(groupOf(file)) || 0) + bytesInOutput);
  const parts = [...totals].map(([group, bytes]) => ({ group, bytes })).toSorted((a, b) => b.bytes - a.bytes);
  return { name, size: { min: code.length, gzip: gzipSync(code, { level: 9 }).length }, parts };
}

export const kib = (n: number): string => `${(n / 1024).toFixed(1)} KiB`;

export function report(m: Measured): string {
  const lines = [`${m.name.padEnd(16)} min ${kib(m.size.min).padStart(10)}   gzip ${kib(m.size.gzip).padStart(9)}`];
  for (const p of m.parts) lines.push(`    ${(100 * p.bytes / m.size.min).toFixed(1).padStart(5)}%  ${kib(p.bytes).padStart(10)}  ${p.group}`);
  return lines.join('\n');
}

if (import.meta.main) {
  const all = await Promise.all(Object.keys(ENTRIES).map(measure));
  for (const m of all) console.log(report(m));
  if (process.argv.includes('--update')) {
    const budget = Object.fromEntries(all.map((m) => [m.name, m.size]));
    writeFileSync(BUDGET_FILE, JSON.stringify({ tolerance: 0.02, note: 'bytes; esbuild --minify then gzip -9; see scripts/bundle_size.ts', ...budget }, null, 2) + '\n');
    console.log(`wrote ${BUDGET_FILE}`);
  }
}
