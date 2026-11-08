# mpljs internals

How mpljs is built, verified and measured. For using the library, see [guide.md](guide.md) and [api.md](api.md).

- [Verification](#verification)
- [Architecture](#architecture-functional-core-imperative-shell-erasable-typescript)
- [Performance](#performance)
- [Axis model](#axis-model-log-scales-dates-twinx)
- [Measured, not assumed](#measured-not-assumed)
- [Commands and layout](#commands-and-layout)
- [Regenerating the oracle](#regenerating-the-oracle)

## Verification

The oracle is matplotlib 3.11.2 itself. `fixtures/ref/` holds matplotlib's own `savefig` output (PNG and SVG) and a
JSON record (limits, tick locations and labels, offset text, legend extents) for every case, generated from call lists
by `fixtures/generate*.py`. `tools/replay-core.ts` replays the same calls through mpljs, and `node test/compare.ts`
compares the result: mpljs ships its own port of Agg and of FreeType's text layout, so the rasterized output is
compared pixel for pixel, not by RMS. At the time of writing: **374 of 374 fixtures pixel-exact against matplotlib's
Agg PNG**.

How the oracle grew:

| slice | scope | oracle checks | result |
|---|---|---|---|
| 1 | `plot`, title/labels, default style | limits, tick locs, label strings, offset text, pixel RMS | 20/20 exact, RMS ≈ 2.0 |
| 2 | fmt strings, linestyles, markers, named colors, `bar`/`barh` (numeric + categorical, grouped, stacked, negative), `legend` incl. `loc='best'` and `ncols`, `grid`, `set_xlim/xticks/xticklabels`, **themes** (9 bundled matplotlib styles) | + legend window extent (0.05 px) | **77/77 exact, mean RMS 1.93** |
| fuzz | `MaxNLocator` + `ScalarFormatter` over seeded random intervals, 20 orders of magnitude | ticks, labels, offset | **106,000/106,000** across 5 seeds |
| 3 | **log scales** (LogLocator major + minor, LogFormatterSciNotation with sublabels, mathtext `10^{n}` / `2×10^{n}` labels), **dates** (AutoDateLocator + AutoDateFormatter, seconds to centuries), **twinx** (shared x, right axis, log twins) | + minor ticks and minor labels on every axes | **101/101 exact, mean RMS 2.02** |
| date fuzz | AutoDateLocator + AutoDateFormatter over random ranges, ~3 s to ~110 years, every frequency incl. microsecond | ticks, labels | **9,400/9,400** across 4 seeds |
| locator fuzz | `YearLocator`, `MonthLocator`, `DayLocator`, `HourLocator`, `MinuteLocator`, `SecondLocator` (random intervals and by-lists, inverted views) + AutoDateFormatter. An RRuleLocator anchors its rule at vmin − relativedelta(vmax, vmin), so with interval > 1 the tick phase follows the view: `HourLocator(interval=12)` over data from 06:30 ticks at 04:00 and 16:00, and `byhour=[0, 12]` pins midnight and noon | ticks, labels | **2,600/2,600** across 2 seeds |
| Agg port | every fixture after mpljs gained its own Agg and FreeType layout | pixels, byte-compared after decoding | **374/374 pixel-exact** (`node test/compare.ts`) |

Calibration: matplotlib's *own* SVG backend, rasterized by the same rasterizer, scores RMS **14–16** against its Agg PNG
(it works in 72-dpi points and does not pixel-snap). Before the Agg port, mpljs at ~2 was anti-aliasing fringe; the
`*.cmp.png` diff panels are blank.

Python is needed only to regenerate the oracle; see [Regenerating the oracle](#regenerating-the-oracle).

## Architecture: functional core, imperative shell, erasable TypeScript

Strict TypeScript, **erasable syntax only** (`erasableSyntaxOnly`): Node runs `src/*.ts` directly by stripping types,
`tsc --noEmit` is a gate, and development has no build step and no emitted JS. (`npm run build` produces plain JS + `.d.ts`
only for distribution.)

```
src/api.ts                 Figure / Axes: the matplotlib-shaped shell. Every argument is `unknown` until parsed here.
src/core/types.ts          THE MODEL. Every domain type, in one reviewable file.
src/core/theme.ts          RcLayer (raw matplotlib rc keys) -> Theme. The only reader of rc keys.
src/core/style.ts          .mplstyle text -> RcLayer; bundled styles; composition
src/core/colors.ts, fmt.ts parsers: color specs -> Paint/Rgb, 'ro--' -> Fmt, linestyles, markers   (-> Result)
src/core/layout.ts         FigureSpec -> Scene, composing the stages below (pure)
  autoscale.ts             one fused pass for data extents + sticky edges; margins; view limits
  ticks.ts                 AxisSpec -> tick locations/labels (exhaustive over axis kind x ticks x labels)
  ticker.ts                MaxNLocator / ScalarFormatter / nonsingular: line-for-line, made pure
  draw-artists.ts          lines (subslice -> transform -> path.ts cleanup -> polyline, markers) and bars (snap, exact culling)
  draw-axis.ts             grid, ticks, tick labels
  legend.ts, legend-index.ts  offsetbox packing; loc='best' over a grid index
  text.ts, marks.ts, path.ts, scene.ts, frame.ts
src/core/std.ts            quarantine: the only file that observes JS `undefined` (lifts Map/props lookups into Option)
src/core/data/*.ts         generated typed tables (glyph metrics, marker paths, named colors, stylelib)
src/render/svg.ts          Scene -> IOList -> string | chunk generator | ReadableStream
src/trace.ts               OTel-shaped tracer: no-op spans when disabled, OTLP/JSON export
```

### Modeling rules (enforced, not conventions)

- **Absence is a variant.** No `undefined`, `null`, `?.`, `??`, or optional fields. `Paint = none | solid`, `Option<T>`,
  `Label = none | text`, `Limits = auto | fixed`.
- **Exhaustive switching with `never`.** Every `switch` over a union ends in `assertNever(x)`. Adding
  `Scale = linear | log` fails `tsc` at exactly the sites that must learn about log scales (verified: one site today).
- **Parse, don't validate.** Strings like `'None'`, `'C0'`, `'inherit'`, `'projecting'`, `'medium'`, `'_nolegend_'` are parsed once,
  at the boundary, into typed values. The core never sees `unknown` or an rc key. Unknown kwargs are errors, as in matplotlib.
- **No assertions.** No `as T` (except `as const`), no `x!`, no `any`.

`tsc` checks the types; `scripts/check_strict.ts` enforces the rules TypeScript can't express (and is itself tested
by planting one violation of each kind). `npm run check` = typecheck + strict + oxlint.

### The product test

For each composite type, the number of representable states should equal the number of meaningful ones.
Before → after:

| type | before (naive product) | after |
|---|---|---|
| `AxisSpec` | `{scale, units, locator?, formatter?}` = 1·2·4·4 = **32** states, 8 meaningful | `numeric{scale, ticks, labels} \| category{names, ticks, labels}` = **8 of 8** |
| shape paint | `{fill?, stroke?, strokeWidth, strokeAlpha}`: width without color, color without width | `Ink = fill \| stroke \| fillStroke`; "neither" is not a node |
| text | `{rotation: number, ha, va}` = 2·3·5 = **30**, 16 supported | `Placement = horizontal{ha, va} \| ylabel` = **16 of 16** |
| line | `linestyle: 'None' \| ...`, `marker: 'None' \| ...`, `label?` with `'_x'` convention | `LineStroke = none \| on`, `LineMarkers = none \| on`, `Label = none \| text` = **8 of 8** (an invisible line still autoscales, as in matplotlib) |
| fmt string | `{color?, marker?, linestyle?}` | `FmtShape = default \| line \| marker \| both` (naming one implies the other is off) |
| legend loc | `string \| number \| undefined` | `LegendLoc = best \| anchored{1..10}` = **11 of 11** |
| rc | `Record<string, any>` | `Theme`, fully typed, parsed once with every error collected |

**Scene** is the renderer-independent output, a tagged union in device px, laid out for one device ('agg' for PNG with Agg's int canvas and snapping applied, 'svg' for SVG):

```
Scene = { width, height, background: Paint, nodes: Node[] }
Node  = rect{ink} | path{segs, ink} | polyline{xs, ys, stroke} | markers{shape, xs, ys, ink} | text{rotation} | group{clip}
```

Renderers only interpret the tree. Nothing in the core touches the DOM, `fs`, or `process`, so it runs unchanged in a Worker.

Output is built as an **IOList** (`string | IOList[]`, Elixir-iodata style): renderers compose nested fragments without
copying and flatten once at the boundary, or stream chunk by chunk.

## Performance

Perf slice (6 lines × 200 pts + markers + legend, warm): **21.6 ms → 3.1 ms per figure, SVG 339 → 53 KiB**, pixels unchanged.
What the traces showed, in order: a non-monotonic clock (fixed: `epoch + hrtime − hrtime₀`); the cold trace overstating layout
10× vs render (benchmark warm, always); markers emitted as 600 separate 26-vertex paths (now a `Markers` scene node →
`<defs>` + `<use>`); `loc='best'` testing every vertex against every candidate (now bbox-pruned with early exit; the
per-candidate spans show `linesTested=1` after the first).

### Complexity (bench/sweep.ts, warm, best of 5)

Design rule: input is O(N) and must be read once; everything after the transform is bounded by **pixels**, not N.
That is a plan/apply split — one typed-array pass for data limits, then a streaming transform → snap → simplify → emit.

| sweep | N | layout before → after | render before → after | SVG before → after |
|---|---|---|---|---|
| `plot` points | 1,000,000 | 938 ms → **65 ms** | 1449 ms → **0.3 ms** | 18 MB → **5 KiB** |
| `plot('o')` markers | 100,000 | 60 ms → **5 ms** | 40 ms → **0.6 ms** | 3.6 MB → **59 KiB** |
| `bar` | 100,000 | 151 ms → **41 ms** | 128 ms → **0.3 ms** | 7.4 MB → **27 KiB** |
| 256 lines + `legend(best)` | 51k vertices | 57 ms → **18 ms** | 45 ms → 21 ms | 1.0 MB → 0.7 MB |

Measured log-log slopes after: layout 0.4–0.6 (sub-linear once the pixel bound kicks in), render ≈ 0 for points/markers/bars.
Mechanisms, each exact with respect to the Agg oracle (77/77 fixtures unchanged at the time):
- matplotlib's own line pipeline, ported from `path_converters.h` (NaN breaks → canvas clip → snap → `PathSimplifier`, threshold 1/9 px, only for ≥128 vertices like `Path.should_simplify`) plus `Line2D`'s subslice to the view: a 1M-point sine becomes 142 vertices, the same vertices matplotlib emits;
- a `Markers` node instanced via `<use>`, with opaque duplicates at the same snapped pixel dropped (PNG; the SVG writes every marker);
- zero-area and same-column-nested opaque bars culled;
- `legend(best)` answered from a grid index (prefix sums for interior cells, exact tests only on boundary cells) built once per layout;
- hot loops in small pure functions — the same loop inside the 300-line `layoutAxes` ran 4.5× slower (V8 wouldn't optimize the body).

Still linear with a real constant: text layout for N tick labels/categories (every label is measured once; nothing exact to cull).
The log-time case — re-rendering the same data under zoom or a new theme — needs a min/max pyramid index built once; not done yet.

## Axis model (log scales, dates, twinx)

The axis model is the sum type those slot into:

```
AxisSpec = numeric{ scale: Scale, limits, ticks, labels } | category{ names, limits, ticks, labels } | datetime{ tz, limits, ticks, labels }
Scale    = linear | log{ base } | symlog{ linthresh, linscale }
```

'auto' ticks/labels resolve from the axis kind and scale exactly as matplotlib's `Axis._set_scale` and unit converters do
(`AutoLocator`/`ScalarFormatter`, `LogLocator`/`LogFormatterSciNotation`, `AutoDateLocator`/`ConciseDateFormatter`).
`twinx()` is a second `Axes` sharing the x `AxisSpec` with its own y and `ytick.near/far` swapped.

## Measured, not assumed

Things that had to be verified against Agg rather than reasoned about:

- Spines/ticks/grid snap **after** the y-flip (rows 58/427, not 57/426).
- A fractional canvas height (e.g. 4.94 in × 72 dpi = 355.68 px): `RendererAgg` flips paths, markers, images and clip boxes with its int canvas height (355), while text flips with the float height (`Text._draw` uses `get_canvas_width_height`). matplotlib's SVG backend flips everything with the float height and clips lines to the float canvas ± 1, so mpl lays out one scene per device (`frame.ts` `Device`).
- matplotlib's SVG backend never pixel-snaps: no `PathSnapper` (spines, ticks, grid, bars, rectilinear lines) and no draw_markers pixel grid. mpl's SVG layout drops Agg's snapping too, and the PNG keeps it. At 72 dpi `test/svg-geometry.test.ts` checks lines, gridlines, spines, tick origins, the axes patch, bars, spans and markers against matplotlib's own SVG to 6e-5 px. The legend differs by up to 0.016 px, because matplotlib's SVG backend measures text with `TextToPath` (100 pt at 72 dpi, unhinted, scaled) and Agg measures it at the figure dpi. mpl lays out text as Agg does.
- Text width is Σ `horiAdvance` (1/64 px) + kerning with `text.hinting='no_hinting'`; ascent/descent clamp to `"lp"` = 1556/2048, 492/2048 em.
- Markers: origin snaps to `floor(v+0.5)+0.5`; above the marker's snap threshold its vertices snap to integers.
- Filled bars with no edge snap to integer pixel edges (linewidth 0 ⇒ even).
- Python float `//` is `fmod`-based, so `16.0 // 0.01 == 1599.0`; V8's `10 ** -17` is not correctly rounded; `np.float64.__round__` is half-to-even. All three surfaced by the fuzz and are ported explicitly.
- The oracle forces `font.family = DejaVu Sans` and `rcdefaults()`, so a locally patched `matplotlibrc` cannot leak into fixtures.

## Commands and layout

| command | what it does |
|---|---|
| `npm ci` | install dev tooling (TypeScript 7, oxlint, `@types/node`, Playwright, esbuild); there are no runtime dependencies |
| `npm run example` / `npm run examples` | render the quickstart / every example into `examples/out/` |
| `npm test` | `check`, then every oracle, fuzz and unit suite |
| `npm run check` | `tsc` typecheck, the modeling rules (`strict`), and oxlint |
| `npm run build` | `dist/browser`: ES modules plus declarations |
| `npm run dev` | build the browser bundle and serve the interactive demo in `tools/live` on http://localhost:8080 |
| `npm run test:browser` | the runtime cases in headless Chromium (first `npx playwright install chromium-headless-shell`) |
| `npm run test:interactive` | the annotated-SVG client (`mpl/interactive`) on `examples/interactive.ts`'s page in headless Chromium |
| `npm run test:zoom` | zoom and pan (`mpl/zoom`) on `examples/zoom.ts`'s page in headless Chromium; every frame checked against Node |
| `npm run test:workers` | the runtime cases in workerd via `cf build` / `cf dev` (`test/workers` has its own lockfile) |
| `npm run test:size` / `npm run size` | bundle budget check / print sizes and composition (`-- --update` rewrites the budget) |
| `npm run bench` | warm per-span timings (see also `bench/`) |
| `npm run fixtures` | regenerate the matplotlib oracle (needs Python; read [fixtures.md](fixtures.md) first) |
| `node scripts/readme_images.ts` | re-render the README's hero gallery (`docs/images/readme/hero-*.png`; `test/examples.test.ts` fails when stale) |
| `node scripts/readme_interactive.ts` | re-take the README's interactive screenshot in headless Chromium |

Layout: `src/` the library; `test/` suites (TypeScript, run by Node); `examples/`; `bench/` performance tools;
`scripts/` build, strict-rule and code-generation scripts; `tools/` oracle replay, diff panels, and the live demo;
`fixtures/` the committed matplotlib 3.11.2 oracle and its Python generators.
Everything (`src/`, `test/`, `tools/`, `scripts/`, `bench/`, `examples/`) is TypeScript run directly by Node and typechecked by `tsc -p .`;
`src/` additionally obeys the [modeling rules](#modeling-rules-enforced-not-conventions).
`bench/bench_live.ts` additionally needs a Playwright Chromium (`npx playwright install chromium`); it is not part of the
typecheck or CI.

## Regenerating the oracle

Not needed to use or test the library: the fixtures in `fixtures/ref/` (matplotlib 3.11.2 output) are committed.
To regenerate them, or the generated tables in `src/core/data/`:

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install -r fixtures/requirements.txt     # matplotlib==3.11.2, numpy, fonttools
npm run fixtures                             # fixtures/generate.py -> fixtures/ref/*.{json,svg,png}
npm run tables                               # scripts/gen_tables.py -> src/core/data/{markers,colors,stylelib}.ts
INTER_DIR=/path/to/Inter-4.0/extras/otf python3 scripts/gen_fonts.py   # build/fonts/*.json → src/fonts/*.ts (or name faces: ... gen_fonts.py dejavu-sans)
python3 fixtures/generate_additions.py      # only the api_* / example_* cases missing from fixtures/ref
npm run fuzz                                 # python fuzz oracles, then the JS comparison (N=..., SEED=...)
npm test
```

Use exactly matplotlib 3.11.2: other versions change tick/legend/Agg details and the diff will show up as test failures.

Known caveat: the committed PNG oracle is byte-compared and depends on the FreeType build behind matplotlib; do not
regenerate and commit fixtures from a different FreeType. See [fixtures.md](fixtures.md).
