// Properties of the live chart's view model (tools/live/view.js), over random gesture sequences:
//  - a zoom keeps the anchor's data x at the same screen fraction (unless an edge clamp shifts it)
//  - a burst of n wheel events equals one event with n× the delta (inputs accumulate)
//  - zoom in then out by the same delta returns the interval
//  - the interval never leaves home and its width stays within [minW, home width]
//  - easing preserves the anchor fraction at every step and converges exactly
import { ease, inside, nearest, pan, wheelFactor, zoomAbout } from '../tools/live/view.js';

let seed = 7;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
let fail = 0, checks = 0;
const ok = (c, msg) => { checks++; if (!c) { fail++; if (fail < 10) console.error('FAIL', msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const home = [19650, 20745], minW = 3, HW = home[1] - home[0];
for (let trial = 0; trial < 2000; trial++) {
  let v = [home[0], home[1]];
  for (let s = 0; s < 30; s++) {
    const r = rnd();
    if (r < 0.6) {
      const frac = rnd(), x = v[0] + frac * (v[1] - v[0]);
      const f = wheelFactor((rnd() - 0.5) * 400, 0, rnd() < 0.2);
      const w = (v[1] - v[0]) * f, n = zoomAbout(v, x, f, home, minW);
      const clampedW = w < minW || w > HW;
      const shifted = !clampedW && (x + (v[0] - x) * f < home[0] || x + (v[1] - x) * f > home[1]);
      if (!clampedW && !shifted) ok(near((x - n[0]) / (n[1] - n[0]), frac, 1e-9), `anchor ${frac}`);
      v = n;
    } else {
      v = pan(v, (rnd() - 0.5) * (v[1] - v[0]), home);
    }
    ok(v[0] >= home[0] - 1e-9 && v[1] <= home[1] + 1e-9, `inside ${v}`);
    ok(v[1] - v[0] >= minW - 1e-9 && v[1] - v[0] <= HW + 1e-9, `width ${v[1] - v[0]}`);
  }
}

// burst accumulation, round trip, easing
for (let trial = 0; trial < 500; trial++) {
  const v = [20000 + rnd() * 100, 20300 + rnd() * 100], x = v[0] + rnd() * (v[1] - v[0]), d = (rnd() - 0.5) * 30, n = 1 + Math.floor(rnd() * 12);
  let a = v;
  for (let i = 0; i < n; i++) a = zoomAbout(a, x, wheelFactor(d, 0, false), [0, 1e6], 1e-6);
  const b = zoomAbout(v, x, wheelFactor(d * n, 0, false), [0, 1e6], 1e-6);
  ok(near(a[0], b[0], 1e-6) && near(a[1], b[1], 1e-6), `burst ${a} vs ${b}`);
  const back = zoomAbout(zoomAbout(v, x, wheelFactor(d, 0, true), [0, 1e6], 1e-6), x, wheelFactor(-d, 0, true), [0, 1e6], 1e-6);
  ok(near(back[0], v[0], 1e-6) && near(back[1], v[1], 1e-6), 'round trip');
  const t = zoomAbout(v, x, 0.3, [0, 1e6], 1e-6), frac = (x - v[0]) / (v[1] - v[0]);
  let s = v, steps = 0;
  while ((s[0] !== t[0] || s[1] !== t[1]) && steps < 1000) { s = ease(s, t, 16.7, 60); steps++; ok(near((x - s[0]) / (s[1] - s[0]), frac, 1e-9), 'ease anchor'); }
  ok(steps < 60, `ease converges (${steps} frames)`);
}
ok(inside([5, 50], [0, 10])[0] === 0 && inside([5, 50], [0, 10])[1] === 10, 'inside caps width');
const X = Float64Array.from({ length: 100 }, (_, i) => i * 2);
ok(nearest(X, -5) === 0 && nearest(X, 500) === 99 && nearest(X, 3.1) === 2 && nearest(X, 2.9) === 1 && nearest(X, 3) === 1, 'nearest');
console.log(`view model: ${checks - fail}/${checks} checks`);
process.exit(fail ? 1 : 0);
