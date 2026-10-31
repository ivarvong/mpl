// Shared by the examples: write a figure as SVG (glyph outlines) and PNG
// into examples/out/ (gitignored) and say where.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Figure } from '../src/index.ts';
import { toSVG } from '../src/render/svg.ts';
import { tracer } from '../src/trace.ts';

const OUT = new URL('./out/', import.meta.url);

export function save(name: string, fig: Figure): void {
  mkdirSync(OUT, { recursive: true });
  // Render text as glyph outlines so the SVG is self-contained on GitHub.
  const scene = fig.toScene();
  writeFileSync(new URL(`${name}.svg`, OUT), toSVG(scene, tracer, 'glyphs'));
  // PNG (Agg) for local viewing; not committed in docs/images when SVG suffices.
  writeFileSync(new URL(`${name}.png`, OUT), fig.toPNGSync());
  console.log(`wrote examples/out/${name}.svg and examples/out/${name}.png`);
}
