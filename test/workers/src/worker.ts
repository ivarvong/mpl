// Renders the runtime cases with the published build (dist/browser) inside workerd: GET /render returns
// [{ name, svg, png64, ms }]. cases.gen.json is written by ../../workers.test.ts from fixtures/ref.
import { subplots } from '../../../dist/browser/index.js';
import { buildWith, type Fixture, type Subplots } from '../../../tools/replay-core.ts';
import cases from './cases.gen.json' with { type: 'json' };

const b64 = (u: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};

export default {
  fetch(req: Request): Response {
    if (new URL(req.url).pathname !== '/render') return new Response('GET /render', { status: 404 });
    const out = Object.entries(cases).map(([name, spec]) => {
      const t0 = performance.now();
      // dist's declarations describe the same classes as src's, but private fields make them nominally distinct
      const fig = buildWith(spec as Fixture, subplots as unknown as Subplots);
      const svg = fig.toSVG(), png = fig.toPNGSync();
      return { name, svg, png64: b64(png), ms: performance.now() - t0 };
    });
    return Response.json({ runtime: navigator.userAgent, out });
  },
};
