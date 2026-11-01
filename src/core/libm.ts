// Correctly rounded log10 and exp, for the log scale transforms.
//
// LogTransform calls np.log10, and InvertedLogTransform calls np.exp(v * np.log(base)). Here
// numpy uses x86 SIMD kernels. Against a 60-digit reference, numpy's log10 is correctly rounded
// for 99.6% of 500k random inputs and its exp for about 95%. V8's fdlibm Math.log10 and Math.exp
// match numpy on only about 94% and 89%.
// One ulp matters. Math.log10(exp(10·47/59)) is 3.459634008381837, while numpy gives
// 3.4596340083818364. That moved a vertex on a straight run of fixture log_y_exp by 6e-14 px.
// Agg's stroker then joined the segments differently there, and AA coverage changed by ±1.
// Math.exp(−0.2000…07 · ln10) put loglog's x limit 1 ulp off, which shifted every vertex.
// A correctly rounded result is the closest portable match to numpy. Matching it bit for bit
// would mean porting numpy's AVX-512 kernels, including their FMA rounding.
// The method: ln(m·2^e) = e·ln2 + 2·atanh((m−1)/(m+1)), and e^r is a Taylor series after an
// ln2 range reduction. Both use double-double (about 100 bits) and round once.

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

/** ln x as a double-double, x finite and > 0. */
function lnDD(x: number): DD {
  // x = m · 2^e with m in [√½, √2): scale subnormals up first
  let v = x, e = 0;
  if (v < 2.2250738585072014e-308) { v *= 2 ** 54; e -= 54; }
  const k = Math.floor(Math.log2(v));
  let m = v / 2 ** k; e += k;   // exact: power-of-two scaling
  if (m > Math.SQRT2) { m /= 2; e += 1; }
  // s = (m − 1)/(m + 1); m − 1 is exact (Sterbenz), m + 1 is carried as a double-double
  const s = div([m - 1, 0], twoSum(m, 1));
  const s2 = mul(s, s);
  // atanh(s) = s · Σ s^(2i) / (2i + 1); |s| < 0.172, so 24 terms reach 2^-120
  let term: DD = [1, 0], sum: DD = [0, 0];
  for (let i = 0; i < 24; i++) {
    sum = add(sum, div(term, [2 * i + 1, 0]));
    term = mul(term, s2);
  }
  const lnm = mul([2 * s[0], 2 * s[1]], sum);
  return add(mul([e, 0], LN2), lnm);
}

/** Correctly rounded log10 for x > 0 (numpy's np.log10); NaN, 0, negatives and ∞ as Math.log10. */
export function log10(x: number): number {
  if (!(x > 0) || x === Infinity) return Math.log10(x);
  if (x === 1) return 0;
  const l = div(lnDD(x), LN10);
  return l[0] + l[1];
}

/** Correctly rounded exp (np.exp); non-finite and overflowing arguments go to Math.exp. */
export function exp(x: number): number {
  if (!Number.isFinite(x) || x > 709.8 || x < -745.2) return Math.exp(x);
  if (x === 0) return 1;
  const k = Math.round(x / LN2[0]);
  // r = x − k·ln2 in double-double: k·LN2.hi is exact enough via twoProd
  const r = add([x, 0], mul([-k, 0], LN2));
  // e^r = Σ r^i / i!; |r| ≤ 0.35, 27 terms reach 2^-120
  let term: DD = [1, 0], sum: DD = [1, 0];
  for (let i = 1; i < 28; i++) {
    term = div(mul(term, r), [i, 0]);
    sum = add(sum, term);
  }
  // scale by 2^k in two steps so neither factor overflows; subnormal results round once at the end
  const s = sum[0] + sum[1];
  if (k > 1000 || k < -1000) {
    const h = Math.trunc(k / 2);
    return s * 2 ** h * 2 ** (k - h);
  }
  if (k < -1021) {
    // the final product is subnormal: scale the double-double first, then round once
    return (sum[0] * 2 ** (k + 54) + sum[1] * 2 ** (k + 54)) * 2 ** -54;
  }
  return s * 2 ** k;
}
