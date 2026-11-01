"""Generate additional matplotlib reference fixtures without touching existing ones.

Writes only the new cases into fixtures/ref and appends them to _index.json.
Requires matplotlib==3.11.2 and numpy installed in the Python environment.
"""
import contextlib, json, math, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
matplotlib.rcdefaults()
matplotlib.rcParams["font.family"] = "DejaVu Sans"
import matplotlib.pyplot as plt
import matplotlib.ft2font as ft

ROOT = os.path.dirname(__file__)
OUT = os.path.join(ROOT, "ref")
INDEX = os.path.join(OUT, "_index.json")
os.makedirs(OUT, exist_ok=True)

def lin(n,a,b): return np.linspace(a,b,n).tolist()
def L(v): return np.asarray(v).tolist()
def dates(start, n, step):
    base = np.datetime64(start)
    return {"$dates": [str(base + i * np.timedelta64(*step)) for i in range(n)]}

def decode(a):
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    return a

def axis_record(axis):
    return dict(lim=[float(v) for v in axis.get_view_interval()],
                ticks=[float(v) for v in axis.get_majorticklocs()],
                labels=[t.get_text() for t in axis.get_majorticklabels()],
                minor=[float(v) for v in axis.get_minorticklocs()],
                minorlabels=[t.get_text() for t in axis.get_minorticklabels()],
                offset=axis.get_offset_text().get_text())

def record(ax, fig):
    leg = ax.get_legend()
    H = fig.bbox.height
    legend = None
    if leg is not None:
        r = fig.canvas.get_renderer()
        bb = leg.get_window_extent(r)
        legend = dict(loc=leg._loc, x0=bb.x0, x1=bb.x1, top=H - bb.y1, bottom=H - bb.y0,
                      texts=[t.get_text() for t in leg.texts])
    return dict(
        xlim=list(ax.get_xlim()), ylim=list(ax.get_ylim()),
        xticks=[float(v) for v in ax.get_xticks()], yticks=[float(v) for v in ax.get_yticks()],
        xticklabels=[t.get_text() for t in ax.get_xticklabels()],
        yticklabels=[t.get_text() for t in ax.get_yticklabels()],
        xoffset=ax.xaxis.get_offset_text().get_text(),
        yoffset=ax.yaxis.get_offset_text().get_text(),
        legend=legend,
        x=axis_record(ax.xaxis), y=axis_record(ax.yaxis),
    )

# Case builder: list of (method, args, kwargs)
CASES = {}
def case(name, *calls): CASES[name] = [list(c) + [{}] * (3 - len(c)) for c in calls]
AX = {"$transform": "axes"}

# New API fixtures
x = lin(50, 0, 10); sx, cx = L(np.sin(x)), L(np.cos(x))
case("api_fig_text", ("plot", [x, sx]), ("fig.text", [0.02, 0.02, "fig corner"], {"color": "C2"}))
case("api_suptitle", ("plot", [x, sx]), ("set_title", ["local"]), ("fig.suptitle", ["overall"]))
case("api_supx_supy", ("plot", [x, sx]), ("fig.supxlabel", ["overall x"]), ("fig.supylabel", ["overall y"]))
case("api_spines_outward", ("plot", [x, sx]), ("spine", ["right", "set_visible", False]), ("spine", ["left", "set_color", "C3"]), ("spine", ["bottom", "set_linewidth", 2.0]), ("spine", ["top", "set_position", ["outward", 6]]))
case("api_tick_params", ("plot", [x, sx]), ("tick_params", [], {"length": 9, "width": 2, "colors": "C2", "labelsize": 12, "direction": "in"}))
case("api_scatter_sizes_colors", ("scatter", [lin(8,0,7), [math.sin(i/2) for i in range(8)]], {"s":[9,25,49,81,121,169,225,289], "c":["C0","C1","C2","C3","C4","C5","C6","C7"], "edgecolors":"k", "linewidths":0.5}))
case("api_spans", ("plot", [x, sx]), ("axvspan", [2, 7], {"ymin": 0.1, "ymax": 0.7, "color": "C1", "alpha": 0.3}), ("axhspan", [-0.5, 0.5], {"xmin": 0.2, "xmax": 0.9, "color": "C2", "alpha": 0.3}))
case("api_annotate_arrow", ("plot", [x, sx]), ("annotate", ["peak", [1.5, math.sin(1.5)]], {"xytext":[2.5,1.2], "arrowprops":{"color":"C3","linewidth":2,"headlength":8,"headwidth":6}}))
case("api_clipoff_text", ("plot", [x, sx]), ("text", [0.5, 1.05, "outside"], {"transform": AX, "clip_on": False, "ha":"center"}))
case("api_multiline_texts", ("plot", [x, sx]), ("set_title", ["A title\\nwith two lines"]), ("set_xlabel", ["x\\nunits"]), ("set_ylabel", ["y\\nunits"]), ("text", [0.5, 0.5, "a\\nb\\nc"], {"transform": AX, "ha":"center","va":"center"}))
# real newlines (api_multiline_texts above passes the two characters backslash-n, not line breaks)
case("api_multiline_real", ("plot", [x, sx]), ("set_title", ["A title\nwith two lines"]), ("set_xlabel", ["x\nunits"]), ("set_ylabel", ["y\nunits"]),
     ("text", [0.5, 0.5, "a\nbbb\ncc"], {"transform": AX, "ha": "center", "va": "center"}),
     ("text", [0.95, 0.9, "right\naligned block"], {"transform": AX, "ha": "right", "va": "top"}),
     ("text", [0.05, 0.1, "baseline\nof the last line"], {"transform": AX}),
     ("fig.text", [0.01, 0.98, "fig\ntext"], {"va": "top"}))
case("api_svg_fonttype_path", ("plot", [x, sx]), ("set_title", ["svg path text"]), ("$rc", [], {"svg.fonttype":"path"}))

# Issue #7 gaps: glyph coverage, grid line kwargs, tight_layout, per-tick label styling
TREE = "└ ls-refs\n├── src\n│   └── api.ts\n╰─▶ done ✓"
case("api_glyphs_box_drawing", ("plot", [x, sx]),
     ("text", [0.05, 0.55, TREE], {"transform": AX}),
     ("text", [0.55, 0.85, "αβγ Δ ≤ ≥ ± ≠ ∞ → ⇒"], {"transform": AX}),
     ("text", [0.55, 0.7, "café naïve Œuvre € £ ¥ §"], {"transform": AX, "fontweight": "bold"}),
     ("text", [0.55, 0.55, "█▓▒░ ■□▲△●○ ‰ ‡ ⁿ"], {"transform": AX}),
     ("set_title", ["Glyphs → ✓"]))
case("api_grid_styled", ("plot", [x, sx]), ("grid", [True], {"color": "C1", "linewidth": 0.5, "linestyle": "--", "alpha": 0.6}))
case("api_grid_aliases_axis", ("plot", [x, sx]), ("grid", [], {"axis": "y", "c": "0.85", "lw": 2, "ls": ":"}))
case("api_grid_minor_log", ("plot", [lin(30, 1, 30), L(np.exp(np.linspace(0, 6, 30)))]), ("set_yscale", ["log"]),
     ("grid", [True], {"which": "both"}), ("grid", [], {"which": "minor", "ls": ":", "alpha": 0.5, "color": "C0"}))
case("api_grid_toggle_keeps_style", ("plot", [x, sx]), ("grid", [], {"color": "red", "lw": 1.5}), ("grid", [False]), ("grid", [None]))
case("api_grid_rgba_color", ("plot", [x, sx]), ("grid", [True], {"color": [0.0, 0.0, 1.0, 0.25], "lw": 3}))
case("api_tight_layout", ("plot", [x, sx]), ("set_title", ["tight"]), ("set_xlabel", ["x label"]), ("set_ylabel", ["y label"]), ("fig.tight_layout", []))
case("api_tight_layout_pad_suptitle", ("plot", [x, sx]), ("set_xlabel", ["x"]), ("fig.suptitle", ["Overall"]), ("fig.supylabel", ["side"]), ("fig.tight_layout", [], {"pad": 0.4}))
case("api_tight_layout_twinx", ("plot", [x, sx]), ("set_ylabel", ["left"]), ("twinx", []), ("plot", [x, L(np.array(cx) * 1000)], {"color": "C1"}), ("set_ylabel", ["right"]), ("fig.tight_layout", []))
case("api_tight_layout_rect", ("plot", [x, sx]), ("set_title", ["rect"]), ("set_xlabel", ["x"]), ("fig.tight_layout", [], {"rect": [0, 0, 1, 0.9]}))
case("api_ticklabels_styled", ("plot", [[0, 1, 2], [2, 0, 1]]), ("set_yticks", [[0, 1, 2]]),
     ("set_yticklabels", [["low", "mid", "high"]], {"fontweight": "bold", "color": "C3", "fontsize": 12}),
     ("set_xticks", [[0, 1, 2]]), ("set_xticklabels", [["a", "b", "c"]], {"size": "small", "c": "0.4"}))
case("api_ticklabel_setters", ("plot", [[0, 1, 2, 3], [3, 1, 2, 0]]), ("set_yticks", [[0, 1, 2, 3]]),
     ("set_yticklabels", [["Plan", "  Build", "  Test", "Ship"]]),
     ("ticklabel", ["y", 0, "set_fontweight", "bold"]), ("ticklabel", ["y", 3, "set_fontweight", "bold"]),
     ("ticklabel", ["x", 1, "set_color", "C2"]), ("ticklabel", ["x", 2, "set_fontsize", 14]))
GANTT = ["Discovery", "  Interviews", "  Synthesis", "Build", "  API", "  UI", "Launch"]
case("api_gantt_waterfall",
     ("barh", [list(range(7)), [3, 2, 1.5, 6, 3.5, 4, 1]], {"left": [0, 0, 2, 3, 3, 5, 9], "color": ["C0", "C0", "C0", "C1", "C1", "C1", "C2"], "height": 0.6}),
     ("set_yticks", [list(range(7))]), ("set_yticklabels", [GANTT]),
     ("ticklabel", ["y", 0, "set_fontweight", "bold"]), ("ticklabel", ["y", 3, "set_fontweight", "bold"]), ("ticklabel", ["y", 6, "set_fontweight", "bold"]),
     ("set_ylim", [6.6, -0.6]), ("set_xlabel", ["weeks"]), ("set_title", ["Project plan"]),
     ("grid", [True], {"axis": "x", "color": "0.9", "lw": 0.8, "ls": "--"}),
     ("spine", ["top", "set_visible", False]), ("spine", ["right", "set_visible", False]),
     ("fig.tight_layout", []))

# examples/gantt.ts, call for call (docs/images/gantt.svg)
TRACE = [("GET /api/checkout", 0, 120, "C0"), ("├─ auth.verify", 2, 14, "C1"), ("├─ db.query orders", 15, 55, "C2"),
         ("└─ pool.acquire", 15, 19, "C2"), ("├─ inventory.reserve", 56, 92, "C4"), ("└─ render.json", 93, 118, "C1")]
case("example_gantt_trace", ("$rc", [], {"axes.axisbelow": True}),
     ("barh", [list(range(len(TRACE))), [e - s for _, s, e, _ in TRACE]], {"left": [s for _, s, _, _ in TRACE], "color": [c for *_, c in TRACE], "height": 0.6}),
     ("set_yticks", [list(range(len(TRACE)))]), ("set_yticklabels", [[l for l, *_ in TRACE]]),
     ("ticklabel", ["y", 0, "set_fontweight", "bold"]),
     ("set_ylim", [len(TRACE) - 0.4, -0.6]), ("set_xlabel", ["ms since request start"]), ("set_title", ["Checkout request trace"], {"loc": "left"}),
     ("grid", [True], {"axis": "x", "color": "0.85", "linestyle": "--", "linewidth": 0.8}),
     ("spine", ["top", "set_visible", False]), ("spine", ["right", "set_visible", False]),
     ("fig.tight_layout", []))

def run_case(name, calls):
    style = None
    rc_layer = {}
    with matplotlib.rc_context(), (plt.style.context(style) if style else contextlib.nullcontext()):
        # Guardrail: these fixtures must be rendered with FreeType 2.14.3 and no hinting
        # (stock matplotlib 3.11.2 wheels); this reproduces the committed oracle PNGs.
        ver = getattr(ft, "__freetype_version__", "")
        if ver != "2.14.3":
            raise RuntimeError(f"FreeType mismatch: expected 2.14.3, got {ver}. "
                               "Use the stock matplotlib 3.11.2 wheel that bundles FreeType 2.14.3.")
        matplotlib.rcParams["font.family"] = "DejaVu Sans"
        matplotlib.rcParams["text.hinting"] = "none"
        # "$rc" steps configure the figure before it exists (replay builds the Figure with fx.rc)
        for fn, _args, kwargs in calls:
            if fn == "$rc" and not any(k.startswith("svg.") for k in kwargs):
                matplotlib.rcParams.update(kwargs)
        fig, ax = plt.subplots()
        axes = [ax]
        for fn, args, kwargs in calls:
            args = [decode(a) for a in args]
            if fn == "twinx":
                ax = ax.twinx(); axes.append(ax); continue
            if fn == "sca":
                ax = axes[args[0]]; continue
            # Figure-level calls prefixed with 'fig.'
            if fn.startswith("fig."):
                getattr(fig, fn[4:])(*args, **kwargs); continue
            if fn == "$rc":
                rc_layer.update(kwargs)
                continue
            if fn == "spine":
                side, action, val = args
                getattr(ax.spines[side], action)(val)
            elif fn == "ticklabel":
                which, i, action, val = args
                labels = ax.get_xticklabels() if which == "x" else ax.get_yticklabels()
                getattr(labels[i], action)(val)
            else:
                kwargs = {k: (ax.transAxes if isinstance(v, dict) and v.get("$transform") == "axes" else v) for k, v in kwargs.items()}
                getattr(ax, fn)(*args, **kwargs)
        fig.canvas.draw()
        recs = [record(a, fig) for a in axes]
        rec = dict(spec=calls, style=style, rc=rc_layer, **recs[0], axes=recs)
        fig.savefig(os.path.join(OUT, f"{name}.svg"))
        fig.savefig(os.path.join(OUT, f"{name}.png"))
        with open(os.path.join(OUT, f"{name}.json"), "w") as f:
            json.dump(rec, f, indent=1)
        plt.close(fig)

def main():
    with open(INDEX, "r") as f:
        names = json.load(f)
    new_names = []
    force = os.getenv("FORCE", "") != ""
    for name, calls in CASES.items():
        if not force and name in names:
            continue
        run_case(name, calls)
        if name not in names:
            new_names.append(name)
    all_names = sorted(names + new_names)
    with open(INDEX, "w") as f:
        json.dump(all_names, f)
    print(f"wrote {len(new_names)} new cases to {OUT}: {new_names}")

if __name__ == "__main__":
    main()

