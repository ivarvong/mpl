// The axes frame in device px and its data -> device transform, through each axis' scale.
import { forward } from './scale.ts';
import type { Position, Scale } from './types.ts';

export type AxesBox = { readonly x0: number; readonly x1: number; readonly yTop: number; readonly yBot: number; readonly w: number; readonly h: number };
export type Frame = {
  readonly box: AxesBox; readonly H: number;
  readonly xlim: readonly [number, number]; readonly ylim: readonly [number, number];
  readonly xscale: Scale; readonly yscale: Scale;
  /** transData's affine part, display (y up) = scaled·a + c, with matplotlib's float operations */
  readonly ax: number; readonly cx: number; readonly ay: number; readonly cy: number;
};

/**
 * The axes bbox as matplotlib holds it: TransformedBbox(position, transFigure), so edges are
 * l·W, r·W, b·H, t·H in display (y-up) coordinates and widths are differences of edges.
 * Top-left y values flip with the canvas height, as Agg does.
 */
export function axesBox(p: Position, W: number, H: number): AxesBox {
  const [l, b, r, t] = p;
  const x0 = l * W, x1 = r * W, y0 = b * H, y1 = t * H;
  return { x0, x1, yTop: H - y1, yBot: H - y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * BboxTransformTo(axes.bbox) ∘ BboxTransformFrom(viewLim), composed by np.dot:
 * From = [1/w, −v0·(1/w)], so a = outw·(1/w), c = outw·(−v0·(1/w)) + outl. Points map as (v·a + 0) + c.
 */
export function frame(box: AxesBox, H: number, xlim: readonly [number, number], ylim: readonly [number, number], xscale: Scale, yscale: Scale): Frame {
  const vx0 = forward(xscale, xlim[0]), vx1 = forward(xscale, xlim[1]), vy0 = forward(yscale, ylim[0]), vy1 = forward(yscale, ylim[1]);
  const kx = 1.0 / (vx1 - vx0), ky = 1.0 / (vy1 - vy0);
  const outb = H - box.yBot;
  return { box, H, xlim, ylim, xscale, yscale,
           ax: box.w * kx, cx: box.w * (-vx0 * kx) + box.x0,
           ay: box.h * ky, cy: box.h * (-vy0 * ky) + outb };
}
/** Data → top-left device px. */
export const tx = (f: Frame, x: number): number => forward(f.xscale, x) * f.ax + f.cx;
export const ty = (f: Frame, y: number): number => f.H - (forward(f.yscale, y) * f.ay + f.cy);
