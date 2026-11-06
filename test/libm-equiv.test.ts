// src/core/libm.ts's log10 (table + Ziv fast path, series fallback) and exp (register-form series) must return
// exactly what the tuple-form implementation they replaced returns (test/libm-reference.ts), bit for bit
// (Object.is), on random and adversarial inputs. LIBM_EQUIV_N sets the count per function (default 100000;
// the PR proof ran 10^7). One deliberate exception: just below DBL_MAX, Math.log2 rounds up to 1024 and
// the tuple form's 2^1024 overflowed (log10(DBL_MAX) came out 306.02…); there the reference is the tuple form's
// own series at x/2, plus log10 2, both double-double, rounded once.
import { exp, log10 } from '../src/core/libm.ts';
import { expRef, log10Ref, log10RefParts } from './libm-reference.ts';

const N = Number(process.env['LIBM_EQUIV_N'] || 100_000);
// xorshift128 over two 32-bit words per draw, seeded: reproducible
let s0 = 0x9e3779b9, s1 = 0x243f6a88, s2 = 0xb7e15162, s3 = 0x7f4a7c15;
const u32 = (): number => { const t = s0 ^ (s0 << 11); s0 = s1; s1 = s2; s2 = s3; s3 = (s3 ^ (s3 >>> 19) ^ t ^ (t >>> 8)) >>> 0; return s3; };
const unit = (): number => u32() / 4294967296;
const int = (lo: number, hi: number): number => lo + Math.floor(unit() * (hi - lo + 1));
const buf = new DataView(new ArrayBuffer(8));
const fromBits = (hi: number, lo: number): number => { buf.setUint32(0, hi >>> 0); buf.setUint32(4, lo >>> 0); return buf.getFloat64(0); };
const hiBits = (x: number): number => { buf.setFloat64(0, x); return buf.getUint32(0); };
const loBits = (x: number): number => { buf.setFloat64(0, x); return buf.getUint32(4); };
/** x moved by d ulps (x > 0, finite), through the bit pattern */
const ulps = (x: number, d: number): number => {
  const big = (BigInt(hiBits(x)) << 32n) | BigInt(loBits(x)), n = big + BigInt(d);
  return n <= 0n ? Number.MIN_VALUE : fromBits(Number(n >> 32n), Number(n & 0xffffffffn));
};
const ulpOf = (x: number): number => { const a = Math.abs(x); return ulps(a, 1) - a; };
/** The tuple form, with its DBL_MAX overflow side-stepped: log10 x = log10(x/2) + log10 2 (x/2 is exact). */
const log10Fixed = (x: number): number => {
  if (!(x > 0) || x === Infinity || Math.log2(x) < 1024) return log10Ref(x);
  const [a0, a1] = log10RefParts(x / 2), [b0, b1] = log10RefParts(2);
  const sum = a0 + b0, bb = sum - a0, e = (a0 - (sum - bb)) + (b0 - bb);
  return sum + (e + a1 + b1);
};
const POW10 = Array.from({ length: 632 }, (_, i) => Number(`1e${i - 323}`)).filter((v) => v > 0 && Number.isFinite(v));

/** Positive inputs for log10, by family; each family's share of N. */
const LOG_FAMILIES: readonly (readonly [string, number, () => number])[] = [
  ['random bit patterns (all positive finite)', 0.25, () => fromBits(int(0, 0x7fefffff), u32())],
  ['subnormals', 0.08, () => fromBits(int(0, 0x000fffff), u32()) || Number.MIN_VALUE],
  ['near 1 (1 ± k ulp, k < 2^20)', 0.10, () => ulps(1, int(-(2 ** 20), 2 ** 20))],
  ['[0.5, 2) uniform', 0.10, () => 0.5 + 1.5 * unit()],
  ['powers of 10 ± 0..64 ulp', 0.10, () => ulps(POW10[int(0, POW10.length - 1)], int(-64, 64))],
  ['DBL_MAX − 0..2^13 ulp', 0.01, () => ulps(Number.MAX_VALUE, -int(0, 2 ** 13))],
  ['powers of 2 ± 0..64 ulp', 0.06, () => ulps(2 ** int(-1074, 1023), int(-64, 64))],
  ['10^U(-6, 9) (chart data)', 0.12, () => 10 ** (unit() * 15 - 6)],
  ['short decimals and integers', 0.08, () => int(1, 10 ** int(1, 7)) / 10 ** int(0, 4)],
  ['near ties (|lo| within 10% of ½ ulp before rounding)', 0.10, () => {
    for (;;) {
      const x = 10 ** (unit() * 40 - 20) * (1 + unit());
      const [h, l] = log10RefParts(x);
      if (Math.abs(Math.abs(l) / ulpOf(h) - 0.5) < 0.05) return x;
    }
  }],
];
const LOG_SPECIAL = [0, -0, -1, NaN, Infinity, -Infinity, 1, Number.MIN_VALUE, 2.2250738585072014e-308, 2.225073858507201e-308,
  Number.MAX_VALUE, Number.EPSILON, 1 - Number.EPSILON / 2, 1 + Number.EPSILON, Math.SQRT2, Math.SQRT1_2, ulps(Math.SQRT2, 1), ulps(Math.SQRT2, -1),
  ...Array.from({ length: 93 }, (_, j) => 1 / (1 + (j - 38) / 128)), ...Array.from({ length: 93 }, (_, j) => 1 + (j - 38) / 128 + 1 / 256)];

/** Inputs for exp: its domain, where it scales and subnormal results, and v·ln10 as InvertedLogTransform calls it. */
const EXP_FAMILIES: readonly (readonly [string, number, () => number])[] = [
  ['uniform over [-745.2, 709.8]', 0.30, () => -745.2 + 1455 * unit()],
  ['random bit patterns (any sign, any exponent)', 0.15, () => fromBits(u32(), u32())],
  ['|x| < 1e-5', 0.15, () => (unit() < 0.5 ? -1 : 1) * 10 ** (-5 - 300 * unit())],
  ['v·ln10, v a short decimal in [-20, 20]', 0.20, () => (int(-20000, 20000) / 1000) * Math.log(10)],
  ['near k = ±1000, -1021, and the domain ends', 0.20, () => ulps(Math.abs([1000, 1021, 1022, 745.2, 709.8][int(0, 4)] * (int(0, 1) ? Math.LN2 : 1)), int(-(2 ** 20), 2 ** 20)) * (int(0, 1) ? -1 : 1)],
];
const EXP_SPECIAL = [0, -0, NaN, Infinity, -Infinity, 709.8, -745.2, 709.78, -745.13, 1, -1, Math.LN2, -Math.LN2 * 1022, -Math.LN2 * 1021.5, -0.20000000000000007 * Math.log(10)];

let failed = 0;
const check = (name: string, f: (x: number) => number, ref: (x: number) => number, special: readonly number[], families: typeof LOG_FAMILIES): void => {
  let bad = 0, total = 0;
  const one = (x: number): void => {
    total++;
    const a = f(x), b = ref(x);
    if (!Object.is(a, b)) { if (bad++ < 5) console.log(`  ${name}(${x}) = ${a}, reference ${b}`); }
  };
  special.forEach(one);
  for (const [fam, share, gen] of families) {
    const n = Math.round(share * N);
    const before = bad;
    for (let i = 0; i < n; i++) one(gen());
    if (bad > before) console.log(`  ${name} ${fam}: ${bad - before} differ`);
  }
  console.log(`libm equiv ${name}: ${total - bad}/${total} bit-identical to the tuple form`);
  failed += bad;
};
if (log10(Number.MAX_VALUE) !== 308.25471555991675) { console.log(`  log10(DBL_MAX) = ${log10(Number.MAX_VALUE)}`); failed++; }
check('log10', log10, log10Fixed, LOG_SPECIAL, LOG_FAMILIES);
check('exp', exp, expRef, EXP_SPECIAL, EXP_FAMILIES);
if (failed > 0) process.exit(1);
