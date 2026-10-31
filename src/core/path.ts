// Polyline simplification in device space, after matplotlib's PathSimplifier
// (path.simplify, threshold in px): vertices within `thr` px of the current
// run's direction collapse to the run's backward/forward extremes. Output size
// is bounded by direction changes at pixel scale, not by input length.

export type XY = { readonly xs: Float64Array; readonly ys: Float64Array };

const finite = (x: number, y: number): boolean => Number.isFinite(x) && Number.isFinite(y);

export function simplifyPolyline(xs: Float64Array, ys: Float64Array, thr: number): XY {
  const n = xs.length;
  if (n <= 2) return { xs, ys };
  const ox = new Float64Array(n), oy = new Float64Array(n);
  let m = 0;
  const thr2 = thr * thr;
  let i = 0;
  while (i < n && !finite(xs[i], ys[i])) i++;
  if (i === n) return { xs: ox.subarray(0, 0), ys: oy.subarray(0, 0) };
  let origX = xs[i], origY = ys[i];
  ox[m] = origX; oy[m] = origY; m++;
  let haveDir = false, dx = 0, dy = 0;
  let fwdX = origX, fwdY = origY, fwdPara = 0, backX = origX, backY = origY, backPara = 0;
  for (i += 1; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!finite(x, y)) continue;
    if (!haveDir) {
      dx = x - origX; dy = y - origY;
      const dn = Math.hypot(dx, dy);
      if (dn === 0) continue;
      dx /= dn; dy /= dn; haveDir = true;
      fwdX = x; fwdY = y; fwdPara = dn; backX = origX; backY = origY; backPara = 0;
      continue;
    }
    const vx = x - origX, vy = y - origY;
    const para = vx * dx + vy * dy, perp = vx * dy - vy * dx;
    if (perp * perp < thr2) {
      if (para > fwdPara) { fwdPara = para; fwdX = x; fwdY = y; }
      else if (para < backPara) { backPara = para; backX = x; backY = y; }
      continue;
    }
    if (backPara < 0) { ox[m] = backX; oy[m] = backY; m++; }
    ox[m] = fwdX; oy[m] = fwdY; m++;
    origX = fwdX; origY = fwdY;
    dx = x - origX; dy = y - origY;
    const dn = Math.hypot(dx, dy);
    if (dn === 0) { haveDir = false; continue; }
    dx /= dn; dy /= dn;
    fwdX = x; fwdY = y; fwdPara = dn; backX = origX; backY = origY; backPara = 0;
  }
  if (haveDir) {
    if (backPara < 0) { ox[m] = backX; oy[m] = backY; m++; }
    ox[m] = fwdX; oy[m] = fwdY; m++;
  }
  return { xs: ox.subarray(0, m), ys: oy.subarray(0, m) };
}

/** Every segment axis-aligned (Agg snaps such paths). */
export function isRectilinear(xs: Float64Array, ys: Float64Array): boolean {
  if (xs.length < 2) return false;
  for (let i = 1; i < xs.length; i++) if (xs[i] !== xs[i - 1] && ys[i] !== ys[i - 1]) return false;
  return true;
}
