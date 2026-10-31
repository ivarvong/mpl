import assert from 'node:assert/strict';
import { subplots } from '../src/index.ts';

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
console.log('rc/svg.fonttype: ok');

