# Fixtures and the FreeType caveat

`fixtures/ref/` holds the oracle: JSON (limits, ticks, labels, legend boxes), SVG and PNG written by matplotlib 3.11.2. `npm test`
compares mpljs against it and needs no Python.

## How to reproduce the oracle PNGs exactly

The PNG comparison is byte for byte, and matplotlib's text rasterization depends on the FreeType build inside its
`ft2font` extension and on the text hinting mode. The oracle PNGs in this repository are produced with:

- the stock `matplotlib==3.11.2` wheel (Linux/macOS), which bundles FreeType 2.14.3; and
- `matplotlib.rcParams['text.hinting'] = 'none'` (no hinting).

You can confirm your environment with:

```py
import matplotlib, matplotlib.ft2font as ft
print(matplotlib.__version__)                 # 3.11.2
print(ft.__freetype_version__)                # 2.14.3
```

Both `fixtures/generate.py` and `fixtures/generate_additions.py` set `font.family = 'DejaVu Sans'` and
`text.hinting = 'none'` to ensure byte-for-byte matches. The Inter font is used only in dedicated Inter fixtures.

## Regeneration rules

- Only regenerate (and commit) fixtures on an environment matching the above (matplotlib 3.11.2, FreeType 2.14.3, hinting none).
- When adding cases, generate just the new files and update `_index.json`. State in your PR which FreeType generated them.
- PNGs produced with a different FreeType or hinting setting are valid for local testing but must not be committed.

`npm run tables` (`scripts/gen_tables.py`) and `scripts/gen_fonts.py` produce `src/core/data/` from matplotlib's data files and
are not affected by FreeType/hinting.

## Writing a case in `fixtures/generate_additions.py`

A case is a list of `(method, args, kwargs)` calls that matplotlib runs on `fig, ax = plt.subplots()` and that
`tools/replay.ts` replays on mpljs, call for call. Besides `Axes` methods, the spec understands:

| call | matplotlib | mpljs |
| --- | --- | --- |
| `("fig.<name>", args, kw)` | `fig.<name>(*args, **kw)` (e.g. `fig.tight_layout`) | `fig.<name>(...args, kw)` |
| `("twinx", [])`, `("sca", [i])` | `ax = ax.twinx()`, pick axes `i` | same |
| `("spine", [side, setter, value])` | `ax.spines[side].setter(value)` | `ax.spines[side].setter(value)` |
| `("ticklabel", [axis, i, setter, value])` | `ax.get_{axis}ticklabels()[i].setter(value)` | same |
| `("$rc", [], {key: value})` | `rcParams.update` before the figure exists (`svg.*` keys only reach SVG output) | `subplots({ rc })` |

Run `python3 fixtures/generate_additions.py` (the guard refuses anything but FreeType 2.14.3); it writes only cases missing
from `_index.json`. `FORCE=1` rewrites every case it defines.
