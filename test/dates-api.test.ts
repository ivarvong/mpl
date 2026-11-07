// Public ConciseDateFormatter kwargs: matplotlib-shaped optionals, 6-tuple formats, Option internal.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AutoDateLocator, ConciseDateFormatter, registerFonts, subplots } from '../src/index.ts';
import { allFonts } from '../src/fonts/all.ts';
import { renderRGBA } from '../src/render/agg.ts';
import { Tracer } from '../src/trace.ts';
import { build, loadFixture } from '../tools/replay.ts';
import { compare, readPNG } from './png-oracle.ts';

registerFonts(...allFonts);

const REF = new URL('../fixtures/ref/', import.meta.url).pathname;

// 1. { show_offset: false } alone matches the concise_show_offset_false oracle fixture.
{
  const name = 'concise_show_offset_false';
  const fx = loadFixture(name);
  const viaReplay = build(fx);

  const [fig, ax] = subplots({ style: fx.style, rc: fx.rc || {} });
  // Same plot call the fixture used (decoded dates + y).
  const plot = fx.spec.find((c: unknown[]) => c[0] === 'plot') as [string, unknown[], object];
  const xs = (plot[1][0] as { $dates: string[] }).$dates.map((s) => new Date(s + 'Z'));
  const ys = plot[1][1] as number[];
  ax.plot(xs, ys);
  const loc = new AutoDateLocator();
  ax.xaxis.set_major_locator(loc);
  ax.xaxis.set_major_formatter(new ConciseDateFormatter(loc, { show_offset: false }));
  ax.set_title('no offset');

  const ref = readPNG(readFileSync(REF + name + '.png'));
  const got = renderRGBA(fig.toScene(), new Tracer());
  const px = compare(ref, got);
  assert.equal(px.diff, 0, `{ show_offset: false } alone: ${px.diff} px differ from fixture (rms ${px.rms})`);
  assert.equal(fig.toSVG(), viaReplay.toSVG(), '{ show_offset: false } SVG must match fixture replay');
  assert.equal(fig.meta[0].x.offset, '', 'offset string empty when show_offset=false');
  console.log('dates-api: { show_offset: false } alone pixel-exact vs concise_show_offset_false');
}

// 2. Runtime RangeError for a wrong-length formats list (JS callers).
{
  const loc = new AutoDateLocator();
  assert.throws(
    () => new ConciseDateFormatter(loc, { formats: ['%Y', '%m', '%d', '%H', '%M'] as unknown as [string, string, string, string, string, string] }),
    (e: Error) => e instanceof RangeError && e.message.includes('formats'),
  );
  console.log('dates-api: formats length ≠ 6 throws RangeError');
}

console.log('dates-api: ok (6-tuple formats enforced in dates-api.types.ts via @ts-expect-error)');
