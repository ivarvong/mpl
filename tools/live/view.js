// The view model behind the live chart: pure functions over x-intervals [lo, hi] in data units.
// Interaction writes a *target* interval; each frame the *shown* interval eases toward it, and only
// the shown interval reaches layout (as set_xlim). Every gesture computes from the target, so a
// burst of input events inside one frame accumulates instead of overwriting itself.

/** Scale an interval about data x by f (f < 1 zooms in), keeping x under the same screen point.
 *  Width is clamped to [minW, home width] by adjusting f, so the anchor stays fixed; then the
 *  interval is shifted inside home. */
export function zoomAbout([lo, hi], x, f, home, minW) {
  const w = hi - lo, hw = home[1] - home[0];
  const g = Math.min(Math.max(w * f, Math.min(minW, hw)), hw) / w;
  return inside([x + (lo - x) * g, x + (hi - x) * g], home);
}

/** Shift an interval by d data units, stopping at home's edges. */
export const pan = ([lo, hi], d, home) => inside([lo + d, hi + d], home);

export function inside([lo, hi], [a, b]) {
  const w = Math.min(hi - lo, b - a);
  if (lo < a) return [a, a + w];
  if (hi > b) return [b - w, b];
  return [lo, hi];
}

/** Exponential approach, frame-rate independent: after dt ms the gap shrinks by exp(-dt/tau).
 *  Linear interpolation of both ends keeps a zoom's anchor at a constant screen fraction. */
export function ease(shown, target, dt, tau) {
  const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
  const lo = shown[0] + (target[0] - shown[0]) * a, hi = shown[1] + (target[1] - shown[1]) * a;
  const eps = (target[1] - target[0]) * 1e-4;
  return Math.abs(lo - target[0]) < eps && Math.abs(hi - target[1]) < eps ? [target[0], target[1]] : [lo, hi];
}

/** Wheel → width factor. d3-zoom's normalisation: pixels × 0.002, lines × 0.05, pages × 1, and ×10
 *  for ctrlKey, which is how browsers report trackpad pinch. 2^x so equal and opposite deltas cancel. */
export function wheelFactor(deltaY, deltaMode, ctrlKey) {
  const k = deltaMode === 1 ? 0.05 : deltaMode === 2 ? 1 : 0.002;
  return 2 ** (deltaY * k * (ctrlKey ? 10 : 1));
}

/** Index of the sample nearest x in ascending X. */
export function nearest(X, x) {
  let lo = 0, hi = X.length - 1;
  if (x <= X[lo]) return lo;
  if (x >= X[hi]) return hi;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] < x) lo = m; else hi = m; }
  return x - X[lo] <= X[hi] - x ? lo : hi;
}

/** Release velocity from recent pointer samples [{t, x}] (data units / ms), over the last `win` ms. */
export function velocity(samples, now, win = 80) {
  const r = samples.filter((s) => now - s.t <= win);
  if (r.length < 2) return 0;
  const a = r[0], b = r[r.length - 1];
  return b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
}

export const same = (a, b) => a[0] === b[0] && a[1] === b[1];
