// Shared by the examples: write a figure as SVG and PNG into examples/out/ (gitignored) and say where.
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Figure } from '../src/index.ts';

const OUT = new URL('./out/', import.meta.url);

export function save(name: string, fig: Figure): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(new URL(`${name}.svg`, OUT), fig.toSVG());
  writeFileSync(new URL(`${name}.png`, OUT), fig.toPNGSync());
  console.log(`wrote examples/out/${name}.svg and examples/out/${name}.png`);
}
