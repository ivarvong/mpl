// Shared by the runtime tests (browser, Workers): the cases every runtime renders, and the check that a
// runtime's output is exactly mpljs-on-Node's and pixel-exact against matplotlib's Agg PNG.
import { readFileSync } from 'node:fs';
import { build, loadFixture } from '../../tools/replay.ts';
import { compare, readPNG } from '../png-oracle.ts';

/** Fonts (DejaVu + box drawing, Inter), log axes, a styled sheet, grids, hist, errorbar, dates, annotate. */
export const RUNTIME_CASES: readonly string[] = [
  'api_glyphs_box_drawing', 'log_dpi240_inter', 'loglog', 'style_ggplot_bars', 'grid_suptitle_suplabels',
  'hist_stepfilled_stacked', 'errorbar_lims_every', 'dates_months', 'annotate_coords_mixed',
];
/** The fixture specs, as the runtime receives them. */
export const fixtures = (): Record<string, unknown> => Object.fromEntries(RUNTIME_CASES.map((n) => [n, loadFixture(n)]));

export type RuntimeOutput = { readonly name: string; readonly svg: string; readonly png: Uint8Array; readonly ms: number };
const REF = new URL('../../fixtures/ref/', import.meta.url).pathname;

/** One line per case; returns the number of failures. */
export function check(runtime: string, outs: readonly RuntimeOutput[]): number {
  let fails = 0;
  for (const name of RUNTIME_CASES) {
    const o = outs.find((x) => x.name === name);
    if (o === undefined) { fails++; console.log(`FAIL ${runtime} ${name}: no output`); continue; }
    const fig = build(loadFixture(name));
    const nodeSvg = fig.toSVG(), nodePng = fig.toPNGSync();
    const problems: string[] = [];
    if (o.svg !== nodeSvg) problems.push(`SVG differs from Node's (${o.svg.length} vs ${nodeSvg.length} chars)`);
    if (Buffer.compare(Buffer.from(o.png), Buffer.from(nodePng)) !== 0) problems.push(`PNG bytes differ from Node's (${o.png.length} vs ${nodePng.length})`);
    const ref = readPNG(readFileSync(REF + name + '.png')), got = readPNG(Buffer.from(o.png));
    const px = compare(ref, got);
    if (ref.w !== got.w || ref.h !== got.h) problems.push(`size ${got.w}x${got.h}, want ${ref.w}x${ref.h}`);
    else if (px.diff > 0) problems.push(`${px.diff} px differ from matplotlib (max |Δ| ${px.maxd})`);
    if (problems.length > 0) { fails++; console.log(`FAIL ${runtime} ${name.padEnd(26)} ${problems.join('; ')}`); }
    else console.log(`PASS ${runtime} ${name.padEnd(26)} pixel-exact vs Agg, SVG + PNG bytes == Node (${o.ms.toFixed(0)} ms)`);
  }
  return fails;
}
