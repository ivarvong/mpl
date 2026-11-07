// matplotlib.gridspec: SubplotParams, GridSpec geometry and SubplotSpec positions, with the same
// float operations (get_grid_positions builds the cells by a running np.cumsum).
import type { Option, Position } from './types.ts';
import { none, some } from './types.ts';

/** Figure.subplotpars: margins as figure fractions, spacing as fractions of the mean cell size. */
export type SubplotParams = {
  readonly left: number; readonly bottom: number; readonly right: number; readonly top: number;
  readonly wspace: number; readonly hspace: number;
};

/** A GridSpec: geometry, ratios, and the subplot parameters it overrides (gridspec_kw).
 *  `parent` is set for GridSpecFromSubplotSpec (colorbar make_axes_gridspec): positions nest
 *  inside the parent's cell bbox instead of the figure margins. */
export type GridSpec = {
  readonly nrows: number; readonly ncols: number;
  readonly widthRatios: readonly number[]; readonly heightRatios: readonly number[];
  readonly overrides: {
    readonly left: Option<number>; readonly bottom: Option<number>; readonly right: Option<number>; readonly top: Option<number>;
    readonly wspace: Option<number>; readonly hspace: Option<number>;
  };
  readonly parent: Option<SubplotSpec>;
};

/** A SubplotSpec: the half-open row and column spans of one cell group in a GridSpec. */
export type SubplotSpec = { readonly grid: GridSpec; readonly rows: readonly [number, number]; readonly cols: readonly [number, number] };

const pick = (o: Option<number>, d: number): number => (o.kind === 'some' ? o.value : d);

/** GridSpec.get_subplot_params: non-None GridSpec attributes win over the figure's.
 *  Nested specs (parent set) replace left/bottom/right/top with the parent's cell bbox. */
export function subplotParams(gs: GridSpec, fig: SubplotParams): SubplotParams {
  const o = gs.overrides;
  if (gs.parent.kind === 'some') {
    const [L, B, R, T] = cellPosition(gs.parent.value, fig);
    return { left: L, bottom: B, right: R, top: T,
             wspace: pick(o.wspace, fig.wspace), hspace: pick(o.hspace, fig.hspace) };
  }
  return { left: pick(o.left, fig.left), bottom: pick(o.bottom, fig.bottom), right: pick(o.right, fig.right), top: pick(o.top, fig.top),
           wspace: pick(o.wspace, fig.wspace), hspace: pick(o.hspace, fig.hspace) };
}

/** np.cumsum(np.column_stack([seps, cells]).flat): running sums, sep then cell, in order. */
function cumsumPairs(cells: readonly number[], sep: number): readonly number[] {
  const out: number[] = [];
  let acc = 0;
  cells.forEach((c, i) => {
    acc += i === 0 ? 0 : sep; out.push(acc);   // [0] + [sep] * (n - 1); the int 0 adds exactly
    acc += c; out.push(acc);
  });
  return out;
}

/** Python's sum() over the ratios: left to right from int 0. */
const pySum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export type GridPositions = { readonly bottoms: readonly number[]; readonly tops: readonly number[]; readonly lefts: readonly number[]; readonly rights: readonly number[] };

/** Every other entry, from `odd` (the reshape((-1, 2)).T columns). */
const even = <T>(a: readonly T[], odd: 0 | 1): readonly T[] => a.filter((_, i) => i % 2 === odd);

/** GridSpecBase.get_grid_positions. */
export function gridPositions(gs: GridSpec, fig: SubplotParams): GridPositions {
  const p = subplotParams(gs, fig);
  const { nrows, ncols } = gs;
  const totW = p.right - p.left, totH = p.top - p.bottom;
  const cellH = totH / (nrows + p.hspace * (nrows - 1));
  const sepH = p.hspace * cellH;
  const normH = cellH * nrows / pySum(gs.heightRatios);
  const hs = cumsumPairs(gs.heightRatios.map((r) => r * normH), sepH);
  const cellW = totW / (ncols + p.wspace * (ncols - 1));
  const sepW = p.wspace * cellW;
  const normW = cellW * ncols / pySum(gs.widthRatios);
  const ws = cumsumPairs(gs.widthRatios.map((r) => r * normW), sepW);
  return {
    tops: even(hs, 0).map((v) => p.top - v), bottoms: even(hs, 1).map((v) => p.top - v),
    lefts: even(ws, 0).map((v) => p.left + v), rights: even(ws, 1).map((v) => p.left + v),
  };
}

/** SubplotSpec.get_position: the cell group's [left, bottom, right, top] (Bbox.from_extents). */
export function cellPosition(ss: SubplotSpec, fig: SubplotParams): Position {
  const g = gridPositions(ss.grid, fig);
  const [r0, r1] = ss.rows, [c0, c1] = ss.cols;
  // np.unravel_index([num1, num2]): only the first and last row/column of the span count
  const rows = [r0, r1 - 1], cols = [c0, c1 - 1];
  return [Math.min(...cols.map((c) => g.lefts[c])), Math.min(...rows.map((r) => g.bottoms[r])),
          Math.max(...cols.map((c) => g.rights[c])), Math.max(...rows.map((r) => g.tops[r]))];
}

/** Bbox.from_extents keeps its corners; SubplotParams.update rejects inverted margins. */
export function validParams(p: SubplotParams): Option<string> {
  if (p.left >= p.right) return some('left cannot be >= right');
  if (p.bottom >= p.top) return some('bottom cannot be >= top');
  return none;
}

/** Build a top-level GridSpec (no parent). */
export function gridSpec(nrows: number, ncols: number,
  widthRatios: readonly number[], heightRatios: readonly number[],
  overrides: GridSpec['overrides']): GridSpec {
  return { nrows, ncols, widthRatios, heightRatios, overrides, parent: none };
}

/** SubplotSpec.subgridspec: a GridSpecFromSubplotSpec nested in this cell. */
export function subgridspec(parent: SubplotSpec, nrows: number, ncols: number, opts: {
  readonly widthRatios: readonly number[]; readonly heightRatios: readonly number[];
  readonly wspace: number; readonly hspace: number;
}): GridSpec {
  return {
    nrows, ncols,
    widthRatios: opts.widthRatios, heightRatios: opts.heightRatios,
    overrides: { left: none, bottom: none, right: none, top: none, wspace: some(opts.wspace), hspace: some(opts.hspace) },
    parent: some(parent),
  };
}

/** A SubplotSpec covering rows [r0,r1) × cols [c0,c1). */
export function subplotSpec(grid: GridSpec, r0: number, r1: number, c0: number, c1: number): SubplotSpec {
  return { grid, rows: [r0, r1], cols: [c0, c1] };
}
