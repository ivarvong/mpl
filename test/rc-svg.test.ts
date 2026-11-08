import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';
import { registerDefaultFonts } from './helpers/register-defaults.ts';
registerDefaultFonts();

// unknown rc keys raise a clear error; svg.fonttype is a known key
try {
  // oxlint-disable-next-line typescript/no-explicit-any -- intentional bad input for the test
  subplots({ rc: { 'bogus.key': 1 } as any });
  assert.fail('expected unknown rc key to throw');
} catch (e) {
  const msg = (e as Error).message;
  assert.ok(msg.includes("unknown rc key 'bogus.key'"), `message: ${msg}`);
}

// rc 'svg.fonttype' honoured by toSVG(): 'path' -> glyph outlines, 'none' -> <text>
{
  const [fig, ax] = subplots({ rc: { 'svg.fonttype': 'path' } });
  ax.text(0.5, 0.5, 'Hello', { transform: ax.transAxes });
  const svg = fig.toSVG();
  assert.ok(svg.includes('<use href="#'), 'glyph <use> elements present for path mode');
  assert.ok(!svg.includes('<text '), 'no <text> tags when svg.fonttype=path');
}
{
  const [fig, ax] = subplots({ rc: { 'svg.fonttype': 'none' } });
  ax.text(0.5, 0.5, 'Hello', { transform: ax.transAxes });
  const svg = fig.toSVG();
  assert.ok(svg.includes('<text '), '<text> elements present for svg.fonttype=none');
}
// svgChunks() and svgStream() write the same document as toSVG(), svg.fonttype included
for (const fonttype of ['path', 'none'] as const) {
  const [fig, ax] = subplots({ rc: { 'svg.fonttype': fonttype } });
  ax.plot([0, 1, 2], [1, 3, 2]);
  ax.set_title('Hello');
  const whole = fig.toSVG();
  assert.equal([...fig.svgChunks()].join(''), whole, `svgChunks() equals toSVG() with svg.fonttype=${fonttype}`);
  const reader = fig.svgStream().getReader(), parts: Uint8Array[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) parts.push(r.value);
  assert.equal(new TextDecoder().decode(Buffer.concat(parts)), whole, `svgStream() equals toSVG() with svg.fonttype=${fonttype}`);
}
console.log('rc/svg.fonttype: ok');

