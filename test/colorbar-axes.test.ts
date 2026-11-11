// Figure.colorbar with a list of Axes (issue #70) against fixtures/colorbar_axes_oracle.json (matplotlib 3.11.2,
// Colorbar.make_axes): every Axes' get_position(original=True) exactly, its drawn box, which ones keep a
// SubplotSpec, the column alignment of a joint plot, and the typed errors.
import { readFileSync } from 'node:fs';
import { Axes, Figure, registerColormaps, subplots } from '../src/index.ts';
import { allColormaps } from '../src/colormaps/all.ts';
registerColormaps(...allColormaps);

type Rec = { pos: number[]; bbox: number[]; subplotspec: boolean };
const oracle: Record<string, Rec[]> = JSON.parse(readFileSync(new URL('../fixtures/colorbar_axes_oracle.json', import.meta.url), 'utf8'));
let fails = 0, checks = 0;
const check = (ok: boolean, msg: string): void => { checks++; if (!ok) { fails++; console.log(`FAIL ${msg}`); } };
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

const IM = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
const HEAT = Array.from({ length: 8 }, (_r, i) => Array.from({ length: 12 }, (_c, j) => (i * 7 + j * 3) % 11));
const grid = (r: number, c: number, kw: Record<string, unknown> = {}): [Figure, Axes[][]] => subplots(r, c, { squeeze: false, ...kw }) as unknown as [Figure, Axes[][]];

const joint = (kw: Record<string, unknown>): Figure => {
  const [fig, axs] = grid(2, 2, { gridspec_kw: { height_ratios: [1, 3], width_ratios: [3, 1] } });
  const top = axs[0][0], heat = axs[1][0];
  top.plot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [3, 5, 4, 6, 8, 7, 5, 6, 9, 8, 6, 7]);
  const im = heat.imshow(HEAT, { aspect: 'auto' });
  fig.colorbar(im, { ax: [heat, top], ...kw });
  return fig;
};
const row = (n: number, kw: Record<string, unknown>, aspect = 'equal'): Figure => {
  const [fig, axs] = grid(1, n);
  let im: unknown;
  for (const a of axs[0]) im = a.imshow(IM, { aspect });
  fig.colorbar(im, { ax: axs[0], ...kw });
  return fig;
};
const CASES: Record<string, () => Figure> = {
  joint: () => joint({}),
  joint_pad_shrink: () => joint({ pad: 0.02, shrink: 0.8, aspect: 30 }),
  joint_left: () => joint({ location: 'left' }),
  joint_top: () => joint({ location: 'top', fraction: 0.1 }),
  joint_bottom_anchor: () => joint({ location: 'bottom', shrink: 0.5, anchor: [0.0, 1.0], panchor: [0.5, 0.5] }),
  row3_bottom: () => row(3, { location: 'bottom', shrink: 0.6, aspect: 30 }),
  row2_right: () => row(2, {}),
  row2_auto: () => row(2, { fraction: 0.2, pad: 0.1 }, 'auto'),
  one_top: () => row(1, { location: 'top' }),
  // subplots' nested rows flatten like an ndarray's .flat
  nested_right: () => { const [fig, axs] = grid(2, 2); fig.colorbar(axs[1][1].imshow(IM), { ax: axs }); return fig; },
  twice: () => {
    const [fig, g] = grid(2, 2); const axs = g.flat();
    fig.colorbar(axs[0].imshow(IM), { ax: [axs[0], axs[1]] });
    fig.colorbar(axs[3].imshow(IM), { ax: [axs[0], axs[2], axs[3]], location: 'bottom' });
    return fig;
  },
  twinx: () => {
    const [fig, g] = grid(1, 2); const axs = g[0];
    axs[0].plot([0, 1, 2], [0, 1, 0]); axs[0].twinx().plot([0, 1, 2], [5, 3, 4]);
    fig.colorbar(axs[1].imshow(IM), { ax: [axs[0], axs[1]], location: 'top', shrink: 0.5 });
    return fig;
  },
  subplots_adjust: () => {
    const [fig, g] = grid(1, 2);
    fig.colorbar(g[0][0].imshow(IM), { ax: g[0] });
    fig.subplots_adjust({ left: 0.05, wspace: 0.3 });
    return fig;
  },
};

for (const [name, want] of Object.entries(oracle)) {
  const make = CASES[name];
  if (!make) { check(false, `${name}: no TS case`); continue; }
  const fig = make();
  fig.toSVG();
  check(fig.axes.length === want.length, `${name}: ${fig.axes.length} Axes, want ${want.length}`);
  const H = fig.heightIn * fig.dpi;
  fig.axes.forEach((ax, i) => {
    const w = want[i];
    check(same(ax.position, w.pos), `${name}[${i}]: position ${JSON.stringify(ax.position)} want ${JSON.stringify(w.pos)}`);
    check((ax.subplotspec.kind === 'some') === w.subplotspec, `${name}[${i}]: subplotspec ${ax.subplotspec.kind}, want ${w.subplotspec}`);
    // the drawn box (after apply_aspect and the anchors) in device px, y down: matplotlib's display box, flipped
    const b = fig.meta[i].frame.box;
    const got = [b.x0, b.yBot, b.x1, b.yTop], exp = [w.bbox[0], H - w.bbox[1], w.bbox[2], H - w.bbox[3]];
    check(same(got, exp), `${name}[${i}]: box ${JSON.stringify(got)} want ${JSON.stringify(exp)}`);
  });
}

// issue #70: in the joint plot the heat map and its top marginal still share their column, and the cax spans both
{
  const fig = joint({});
  const [top, , heat, , cax] = fig.axes;
  check(top.position[0] === heat.position[0] && top.position[2] === heat.position[2], 'joint: heat and top marginal columns differ');
  check(cax.position[1] === heat.position[1] && cax.position[3] === top.position[3], 'joint: the cax does not span heat and top');
}

// typed errors: a bad keyword value is an Error naming it (KwReader, as everywhere); a location/orientation clash a TypeError
const throws = (f: () => unknown, kind: ErrorConstructor, what: string): void => {
  try { f(); check(false, `${what}: did not throw`); } catch (e) { check(e instanceof kind, `${what}: threw ${(e as Error).name}: ${(e as Error).message}`); }
};
throws(() => { const [fig, ax] = subplots(); fig.colorbar(ax.imshow(IM), { ax: [] }); }, Error, 'ax=[]');
throws(() => { const [fig, ax] = subplots(); fig.colorbar(ax.imshow(IM), { ax: [ax, 3] }); }, Error, 'ax=[ax, 3]');
throws(() => { const [fig, ax] = subplots(); fig.colorbar(ax.imshow(IM), { ax: 'ax' }); }, Error, "ax='ax'");
throws(() => { const [fig, ax] = subplots(); const [, other] = subplots(); fig.colorbar(ax.imshow(IM), { ax: [ax, other] }); }, Error, 'ax from another figure');
throws(() => { const [fig, ax] = subplots(); fig.colorbar(ax.imshow(IM), { location: 'top', orientation: 'vertical' }); }, TypeError, 'location/orientation clash');
throws(() => { const [fig, ax] = subplots(); fig.colorbar(ax.imshow(IM), { ax: [ax], anchor: [0] }); }, Error, 'anchor=[0]');

if (fails > 0) { console.log(`colorbar-axes: ${fails} of ${checks} checks failed`); process.exit(1); }
console.log(`colorbar-axes: ${Object.keys(oracle).length} make_axes cases exact vs matplotlib 3.11.2 (positions, boxes, SubplotSpecs), joint column alignment, typed errors; ${checks} checks ok`);
