// A request trace as a waterfall: one bar per span at its start offset, the span's name and duration written
// above its bar (no tick labels), an x grid only, in the pro-slate and pro-dark sheets at 200 dpi.
// The same calls are oracle cases (fixtures/ref/example_trace_pro_{slate,dark}, fixtures/generate_additions.py),
// and test/examples.test.ts checks these renders against matplotlib's pixel for pixel. The README shows both.
// Writes examples/out/trace-{pro-slate,pro-dark}.{svg,png}; docs/images/readme/trace-*.png are these PNGs.
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerFonts, subplots } from '../src/index.ts';
import type { Figure } from '../src/index.ts';
import { interRegular } from '../src/fonts/inter-regular.ts';
import { interSemibold } from '../src/fonts/inter-semibold.ts';

registerFonts(interRegular, interSemibold);   // the pro sheets set font.family: Inter

export const SPANS = [
  ['GET /api/checkout', 0, 120, 'C0'],
  ['auth.verify', 2, 14, 'C1'],
  ['db.query orders', 15, 55, 'C2'],
  ['pool.acquire', 15, 19, 'C2'],
  ['inventory.reserve', 56, 92, 'C4'],
  ['render.json', 93, 118, 'C3'],
] as const;

export function trace(style: string): Figure {
  const [fig, ax] = subplots({ style, rc: { 'figure.figsize': [6.4, 3.8], 'figure.dpi': 200 } });
  const rows = SPANS.map((_, i) => i);
  ax.barh(rows, SPANS.map(([, s, e]) => e - s), { left: SPANS.map(([, s]) => s), color: SPANS.map(([, , , c]) => c), height: 0.38 });
  SPANS.forEach(([name, s, e], i) => {
    const late = s > 80;   // spans near the right edge: label right-aligned to the bar's end
    ax.text(late ? e : s, i - 0.27, `${name}  ${e - s} ms`, { ha: late ? 'right' : 'left', va: 'bottom', fontsize: 8.5, fontweight: i === 0 ? 'semibold' : 'normal' });
  });
  ax.set_yticks([]);
  ax.set_ylim(SPANS.length - 0.5, -0.85);
  ax.set_xlim(0, 122);
  ax.grid(false, { axis: 'y' });
  ax.grid(true, { axis: 'x' });
  ax.set_xlabel('ms since request start');
  ax.set_title('Checkout request trace');
  fig.tight_layout();
  return fig;
}

if (import.meta.main) {
  const OUT = new URL('./out/', import.meta.url);
  mkdirSync(OUT, { recursive: true });
  for (const style of ['pro-slate', 'pro-dark']) {
    const fig = trace(style);
    writeFileSync(new URL(`trace-${style}.svg`, OUT), fig.toSVG());
    writeFileSync(new URL(`trace-${style}.png`, OUT), fig.toPNGSync());
    console.log(`wrote examples/out/trace-${style}.{svg,png}`);
  }
}
