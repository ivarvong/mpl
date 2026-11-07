// Cold and low-tier benchmark: what a short-lived isolate (Cloudflare Workers, a serverless cold start) actually pays.
// Each sample is a fresh `node` process that renders the chart once (the cold first render: lazy compile, font decode,
// unoptimized code) and then WARM more times (warm p50). Configs:
//   default              V8 as Node ships it (TurboFan + concurrent compiler and GC threads)
//   --max-opt=2          Maglev at most (no TurboFan)
//   --max-opt=1          Sparkplug at most (baseline code only)
//   --single-threaded    no background compile/GC threads, so optimization and GC run on the request's thread. This is
//                        the closest Node model of workerd found so far (mpl-web, 2026-11-07: same profile shape, GC share ~7 %).
//
//   node bench/tiers.ts                          this checkout, P=10 processes per config
//   node bench/tiers.ts <base>/src/index.ts      A/B: base vs this checkout, alternating processes; Δ median with a 95 % bootstrap CI
// env: P (processes per config and side, default 10), WARM (warm renders per process, default 20), CHART (line|dash, default dash)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

type Sample = { readonly first: number; readonly warm: number };

const CONFIGS: readonly (readonly string[])[] = [[], ['--max-opt=2'], ['--max-opt=1'], ['--single-threaded']];
const self = fileURLToPath(import.meta.url);
const here = fileURLToPath(new URL('../src/index.ts', import.meta.url));

async function child(src: string, warm: number, chart: string): Promise<void> {
  const m = await import(src) as typeof import('../src/index.ts');
  const x = Array.from({ length: 200 }, (_, i) => i / 20);
  const build = (): ReturnType<typeof m.subplots>[0] => {
    if (chart === 'line') {
      const [fig, ax] = m.subplots();
      ax.plot(x, x.map((v) => Math.sin(v)), { label: 'sin' });
      ax.set_title('one line'); ax.legend();
      return fig;
    }
    const [fig, axs] = m.subplots(2, 2, { figsize: [12, 9] });
    const t = Array.from({ length: 2000 }, (_, i) => i / 100);
    for (let i = 0; i < 4; i++) {
      const ax = axs[i >> 1][i & 1];
      ax.plot(t, t.map((v) => Math.sin(v * (i + 1)) * Math.exp(-v / 10)), { label: `series ${i}` });
      ax.fill_between(t, t.map((v) => Math.sin(v * (i + 1)) * 0.5), 0, { alpha: 0.3 });
      ax.set_title(`panel ${i}`); ax.set_xlabel('t'); ax.set_ylabel('value'); ax.grid(true); ax.legend();
    }
    fig.suptitle('tiers benchmark'); fig.tight_layout();
    return fig;
  };
  let t = performance.now();
  build().toPNGSync();
  const first = performance.now() - t;
  const ws: number[] = [];
  for (let i = 0; i < warm; i++) { t = performance.now(); build().toPNGSync(); ws.push(performance.now() - t); }
  ws.sort((a, b) => a - b);
  const out: Sample = { first, warm: ws.length > 0 ? ws[ws.length >> 1] as number : Number.NaN };
  console.log(JSON.stringify(out));
}

const med = (a: readonly number[]): number => { const s = a.toSorted((u, v) => u - v); return s[s.length >> 1] as number; };
function ci(a: readonly number[], b: readonly number[]): readonly [number, number] {
  let seed = 12345;
  const rnd = (): number => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const pick = (s: readonly number[]): number[] => s.map(() => s[Math.floor(rnd() * s.length)] as number);
  const d: number[] = [];
  for (let i = 0; i < 2000; i++) d.push(med(pick(b)) - med(pick(a)));
  d.sort((u, v) => u - v);
  return [d[50] as number, d[1949] as number];
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === '--child') return child(argv[1] as string, Number(argv[2]), argv[3] as string);
  const P = Number(process.env['P'] || 10), WARM = Number(process.env['WARM'] || 20), CHART = process.env['CHART'] || 'dash';
  const sides: readonly (readonly [string, string])[] = argv[0] !== undefined ? [['base', argv[0]], ['this', here]] : [['this', here]];
  console.log(`chart ${CHART}, ${P} fresh processes per config${sides.length > 1 ? ' and side (alternating)' : ''}, ${WARM} warm renders each; ms`);
  for (const flags of CONFIGS) {
    const got = new Map<string, Sample[]>(sides.map(([k]) => [k, []]));
    for (let i = 0; i < P; i++) for (const [k, src] of i % 2 === 0 ? sides : sides.toReversed()) {
      const out = execFileSync(process.execPath, [...flags, self, '--child', src, String(WARM), CHART], { encoding: 'utf8' });
      got.get(k)?.push(JSON.parse(out.trim().split('\n').at(-1) ?? '{}') as Sample);
    }
    const name = flags.join(' ') || 'default';
    const row = (k: string): string => { const s = got.get(k) ?? []; return `${k} first ${med(s.map((r) => r.first)).toFixed(1)} warm ${med(s.map((r) => r.warm)).toFixed(1)}`; };
    let line = `${name.padEnd(18)} ${sides.map(([k]) => row(k)).join(' | ')}`;
    if (sides.length > 1) {
      const a = got.get('base') ?? [], b = got.get('this') ?? [];
      for (const f of ['first', 'warm'] as const) {
        const [lo, hi] = ci(a.map((r) => r[f]), b.map((r) => r[f]));
        line += ` | Δ${f} ${(med(b.map((r) => r[f])) - med(a.map((r) => r[f]))).toFixed(1)} [${lo.toFixed(1)}, ${hi.toFixed(1)}]`;
      }
    }
    console.log(line);
  }
}
await main();
