// The tuple-form double-double log10 and exp exactly as src/core/libm.ts had them at 5635fd0, before the
// register form. Reference for test/libm-equiv.test.ts only: the two must agree bit for bit. Do not edit.
type DD = readonly [number, number];

const twoSum = (a: number, b: number): DD => {
  const s = a + b, bb = s - a;
  return [s, (a - (s - bb)) + (b - bb)];
};
const SPLIT = 134217729;  // 2^27 + 1, Veltkamp
const twoProd = (a: number, b: number): DD => {
  const p = a * b;
  const ca = SPLIT * a, ah = ca - (ca - a), al = a - ah;
  const cb = SPLIT * b, bh = cb - (cb - b), bl = b - bh;
  return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
};
const add = (a: DD, b: DD): DD => {
  const [s, e] = twoSum(a[0], b[0]);
  return twoSum(s, e + a[1] + b[1]);
};
const mul = (a: DD, b: DD): DD => {
  const [p, e] = twoProd(a[0], b[0]);
  return twoSum(p, e + a[0] * b[1] + a[1] * b[0]);
};
const div = (a: DD, b: DD): DD => {
  const q = a[0] / b[0];
  const r = add(a, mul([-q, 0], b));
  const q2 = r[0] / b[0];
  return twoSum(q, q2);
};

const LN2: DD = [0.6931471805599453, 2.3190468138462996e-17];
const LN10: DD = [2.302585092994046, -2.1707562233822494e-16];

function lnDD(x: number): DD {
  let v = x, e = 0;
  if (v < 2.2250738585072014e-308) { v *= 2 ** 54; e -= 54; }
  const k = Math.floor(Math.log2(v));
  let m = v / 2 ** k; e += k;
  if (m > Math.SQRT2) { m /= 2; e += 1; }
  const s = div([m - 1, 0], twoSum(m, 1));
  const s2 = mul(s, s);
  let term: DD = [1, 0], sum: DD = [0, 0];
  for (let i = 0; i < 24; i++) {
    sum = add(sum, div(term, [2 * i + 1, 0]));
    term = mul(term, s2);
  }
  const lnm = mul([2 * s[0], 2 * s[1]], sum);
  return add(mul([e, 0], LN2), lnm);
}

export function log10Ref(x: number): number {
  if (!(x > 0) || x === Infinity) return Math.log10(x);
  if (x === 1) return 0;
  const l = div(lnDD(x), LN10);
  return l[0] + l[1];
}
/** log10Ref's double-double before the final rounding (x finite, > 0, not 1): where a tie would be. */
export const log10RefParts = (x: number): DD => div(lnDD(x), LN10);

export function expRef(x: number): number {
  if (!Number.isFinite(x) || x > 709.8 || x < -745.2) return Math.exp(x);
  if (x === 0) return 1;
  const k = Math.round(x / LN2[0]);
  const r = add([x, 0], mul([-k, 0], LN2));
  let term: DD = [1, 0], sum: DD = [1, 0];
  for (let i = 1; i < 28; i++) {
    term = div(mul(term, r), [i, 0]);
    sum = add(sum, term);
  }
  const s = sum[0] + sum[1];
  if (k > 1000 || k < -1000) {
    const h = Math.trunc(k / 2);
    return s * 2 ** h * 2 ** (k - h);
  }
  if (k < -1021) {
    return (sum[0] * 2 ** (k + 54) + sum[1] * 2 ** (k + 54)) * 2 ** -54;
  }
  return s * 2 ** k;
}
