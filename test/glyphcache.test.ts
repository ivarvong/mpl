// The glyph cache reuses a mask rendered at a canonical origin, shifted by whole pixels. That is
// only correct if ftgrays is translation-invariant for the inputs we feed it, so check it: every
// glyph of every face, several sizes, both rotations, random 26.6 origins (including ones that
// hang off the canvas edges), cached vs direct, byte for byte.
import { FACE_CATALOG } from '../src/core/fontcodec.ts';
import { getFace, registerFonts } from '../src/core/fonts.ts';
import { allFonts } from '../src/fonts/all.ts';
import { ftScale } from '../src/core/fonts.ts';
import { newCanvas } from '../src/render/agg/canvas.ts';
import { clearGlyphCache, drawGlyph, drawGlyphDirect } from '../src/render/ft.ts';

let seed = 99;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const color = { r: 20, g: 120, b: 220, a: 230 };
let glyphs = 0, bad = 0;
registerFonts(...allFonts);
for (const face of FACE_CATALOG.map(getFace)) {
  const gids = [...face.outlines.keys()];
  for (const [pt, dpi] of [[7.5, 100], [10, 72], [14.5, 240]]) {
    const scale = ftScale(face, pt, dpi);
    clearGlyphCache();
    for (const rot of [false, true]) {
      // one canvas per batch: each glyph drawn twice (once to warm the cache) at the same origin
      const W = 160, H = 120, a = newCanvas(W, H, dpi), b = newCanvas(W, H, dpi);
      for (let k = 0; k < gids.length; k++) {
        const gid = gids[k];
        const warm = [Math.floor((rnd() * 2 - 0.25) * W * 64), Math.floor((rnd() * 2 - 0.25) * H * 64)];
        const ox = Math.floor((rnd() * 1.4 - 0.2) * W * 64), oy = Math.floor((rnd() * 1.4 - 0.2) * H * 64);
        drawGlyph(newCanvas(W, H, dpi), face, gid, scale, rot, (warm[0] & ~63) | (ox & 63), (warm[1] & ~63) | (oy & 63), color);
        drawGlyph(a, face, gid, scale, rot, ox, oy, color);
        drawGlyphDirect(b, face, gid, scale, rot, ox, oy, color);
        glyphs++;
        if (k % 64 === 63 || k === gids.length - 1) {
          if (a.px.some((v, i) => v !== b.px[i])) { bad++; console.log(`${face.id} ${pt}pt rot=${rot}: mismatch near gid ${gid}`); }
          a.u32.fill(0); b.u32.fill(0);
        }
      }
    }
  }
}
console.log(`glyph cache: ${glyphs} placements, cached == direct — ${bad === 0 ? 'ok' : `${bad} FAILED`}`);
if (bad) process.exitCode = 1;
