# Fixtures and the FreeType caveat

`fixtures/ref/` holds the oracle: JSON (limits, ticks, labels, legend boxes), SVG and PNG written by matplotlib 3.11.2.
`npm test` compares mpljs against it and needs no Python.

## Do not regenerate fixtures from a different FreeType

The PNG comparison is byte for byte, and matplotlib's text rasterization depends on the FreeType build inside its
`ft2font` extension. The committed PNGs were most likely produced with a FreeType 2.6.1 build (unrecorded; matplotlib's
`ft2font.__freetype_version__` tells you which one you have; 2.6.1 is what matplotlib's own test suite pins).

A stock `pip install matplotlib==3.11.2` on macOS arm64 ships FreeType 2.14.3. With it, the regenerated JSON agrees with the
committed JSON to the last float digit, but the PNGs differ in text pixels, so `node test/compare.ts` fails on fixtures that
passed before.

Contributors therefore:

- do not run `npm run fixtures` and commit the result unless matplotlib reports the same FreeType as the committed files;
- when adding a new case to `fixtures/generate.py`, generate only the new fixture files with a FreeType 2.6.1 build of
  matplotlib, and say in the PR which FreeType produced them;
- treat PNGs regenerated with another FreeType as new baselines for that environment only, never as a fix for a failing test.

`npm run tables` (`scripts/gen_tables.py`) and `scripts/gen_fonts.py` produce `src/core/data/` from matplotlib's data files and
are not affected by FreeType.
