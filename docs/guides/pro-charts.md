## Publication- and Twitter-ready charts with mpljs

This guide shows how to produce polished, phone-legible images for social media or publications, and how to observe a render with the built-in tracer.

- Files:
  - `examples/twitter_pro.ts` — two Twitter-ready designs (speedup bars and a dumbbell).
  - `examples/trace_render.ts` — traces a warm render and draws a span waterfall.
  - `examples/starter_charts.ts` — four small, copy‑pastable starters.
- Images in this doc are rendered from those scripts and committed under `docs/images/`.

### Canvas sizing for X/Twitter

- Use a 16:9 figure at `dpi=150` → 2400×1350 px, which posts cleanly without platform resampling.
- Example:

```ts
const [fig, ax] = subplots({ figsize: [16, 9], dpi: 150 });
```

### Phone‑legible typography and minimal ink

For a single chart image that will be read on a phone, dial up type and strip non‑data ink. mpljs reads matplotlib rc keys, so you can do it in `rc`:

```ts
const [fig, ax] = subplots({
  figsize: [16, 9], dpi: 150,
  rc: {
    'font.size': 24, 'figure.facecolor': 'white', 'axes.facecolor': 'white',
    'axes.spines.left': false, 'axes.spines.right': false,
    'axes.spines.top': false,  'axes.spines.bottom': false,
    'axes.grid': false, 'xtick.bottom': false, 'xtick.labelbottom': false,
    'ytick.left': false, 'ytick.labelleft': false,
    // Tight margins around a left‑aligned headline
    'figure.subplot.left': 0.30, 'figure.subplot.right': 0.86,
    'figure.subplot.bottom': 0.11, 'figure.subplot.top': 0.75,
  },
});
```

Notes:
- There are no spine/tick mutator methods yet; set them via `rc` as above.
- Use `plot('o')` for dots — there is no separate `scatter` API today.
- Prefer direct labeling over a legend when space is tight.

### Headline, subtitle, and footer

mpljs does not yet have figure‑level text (`fig.text`/`suptitle`). Place text in axes coordinates after converting from figure coordinates so it sits in the outer margin:

```ts
const fx = (x: number) => (x - L) / (R - L);  // figure x -> axes x
const fy = (y: number) => (y - B) / (T - B);  // figure y -> axes y
const at = { transform: ax.transAxes };
ax.text(fx(0.045), fy(0.915), 'Bold headline', { ...at, fontsize: 38, fontweight: 'bold' });
ax.text(fx(0.045), fy(0.855), 'Grey subtitle naming the baseline', { ...at, fontsize: 24 });
ax.text(fx(0.045), fy(0.040), 'source or script', { ...at, fontsize: 17 });
```

### Design principles used

- Title = takeaway; say what changed and by how much.
- Always name the baseline (e.g. “vs earlier mpljs before the perf rewrite” or “vs matplotlib 3.x”).
- Sort rows, use a single accent color, keep ink minimal, and cite the source/script.

### Example outputs

<p>
  <img src="../images/twitter_speedup.png" width="560" alt="speedup bars">
  <img src="../images/twitter_dumbbell.png" width="560" alt="dumbbell with ms before/after">
</p>

---

## Tracing a render

Enable the tracer, warm up, collect spans, and summarize. `examples/trace_render.ts` shows the full flow and also draws a span waterfall with mpljs itself.

```ts
import { tracer, renderTree } from '../src/index.ts';
// Warm (untraced) runs
for (let i = 0; i < 6; i++) fig.toSVG(), fig.toPNGSync();
// Aggregate 40 traced runs by span name and print p50/p95
tracer.enable();
for (let i = 0; i < 40; i++) { tracer.clear(); fig.toSVG(); fig.toPNGSync(); }
console.log(renderTree(tracer.spans(), 150));   // pretty tree
await tracer.flush('examples/out/twitter_trace.spans.jsonl'); // OTLP JSONL
```

Observed on this VM (Node 24, warm, 2400×1350, the “Twitter dumbbell” figure), per render:

- png.encode p50 ≈ 5.9 ms (~70% of total), p95 ≈ 7.0 ms
- render.raster p50 ≈ 2.4 ms
- figure.layout p50 ≈ 0.6 ms; render.svg p50 ≈ 0.14 ms
- 177 total spans
- Calling both `toSVG()` and `toPNGSync()` re‑runs layout once per format by design.

The script also groups depth‑1 spans by name and renders a simple waterfall chart:

<p>
  <img src="../images/twitter_trace.png" width="700" alt="span waterfall">
</p>

---

## Baseline and story

These charts explicitly name their baseline: the speedups are vs earlier mpljs before the performance rewrite (numbers from `bench/sweep.ts`, layout before → after, best‑of‑N, warm). If you measure vs matplotlib on your machine, be explicit about:

- Matplotlib version and backend (`Agg` for PNG), device size, and warm vs cold
- Output format (SVG/PNG) and the iteration policy (best‑of‑N, median‑of‑N)
- Machine details (CPU class at least)

---

## API gaps encountered

- No figure‑level text (`fig.text`/`suptitle`) — used `ax.text` in axes coords instead.
- No spine/tick mutator methods — set via rc (`axes.spines.*`, `xtick.bottom`, …).
- No `subplots_adjust` — margins set via `figure.subplot.*` rc.
- No two‑line tick labels.
- No `scatter`; use `plot('o')`.
- Markers clip at the axes edge.
- Tracer: `tracer.flush()` exists and writes OTLP/JSON lines; layout runs once per output format.

