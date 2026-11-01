"""Generate additional matplotlib reference fixtures without touching existing ones.

Writes only the new cases into fixtures/ref and appends them to _index.json.
Requires matplotlib==3.11.2 and numpy installed in the Python environment.
"""
import contextlib, json, math, os
from fixture_guard import check_no_literal_newlines
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

# Annotation coordinate systems, mixed (_AnnotationBase._get_xy_transform)
ARW = {"color": "C3", "width": 1.5, "headwidth": 6, "headlength": 6}
ANN = [
    ("annotate", ["data to axes", [2.0, math.sin(2.0)]], {"xytext": [0.55, 0.88], "textcoords": "axes fraction", "arrowprops": ARW}),
    ("annotate", ["axes to data", [0.05, 0.08]], {"xycoords": "axes fraction", "xytext": [3.5, -0.6], "textcoords": "data", "arrowprops": ARW}),
    ("annotate", ["figure fraction", [0.5, 0.96]], {"xycoords": "figure fraction", "ha": "center", "va": "top"}),
    ("annotate", ["offset points", [7.0, math.sin(7.0)]], {"xytext": [-40, -36], "textcoords": "offset points", "arrowprops": ARW}),
    ("annotate", ["axes to figure", [0.95, 0.95]], {"xycoords": "axes fraction", "xytext": [0.72, 0.03], "textcoords": "figure fraction", "arrowprops": ARW}),
    ("annotate", ["axes pixels", [12, 30]], {"xycoords": "axes pixels", "xytext": [6, 6], "textcoords": "offset pixels", "color": "C2"}),
    ("annotate", ["fontsize", [9.0, math.sin(9.0)]], {"xytext": [-6, 1.5], "textcoords": "offset fontsize", "fontsize": 8, "arrowprops": ARW}),
    ("annotate", ["figure points", [10, 10]], {"xycoords": "figure points", "color": "C1"}),
    ("annotate", ["outside, hidden", [20.0, 0.0]], {"xytext": [0.5, 0.5], "textcoords": "axes fraction"}),
]
case("annotate_coords_mixed", ("plot", [x, sx]), *ANN)
case("annotate_coords_dpi", ("$rc", [], {"figure.dpi": 72, "figure.figsize": [5.0, 3.5]}), ("plot", [x, sx]), *ANN)

# Subplot grids: ("$subplots", [nrows, ncols], kwargs) first; ("sca", [i]) picks fig.axes[i]
def panel(i, **kw):
    """Distinct data per panel: a damped sine with its own phase and scale."""
    t = np.linspace(0, 10, 60)
    return [("sca", [i]), ("plot", [L(t), L(np.sin(t + i) * np.exp(-t / (6 + i)) * (1 + i))], kw)]
def panels(n): return [c for i in range(n) for c in panel(i)]
case("grid_1x1_squeeze", ("$subplots", [1, 1]), *panel(0), ("set_title", ["one"]))
case("grid_1x3", ("$subplots", [1, 3]), *[c for i in range(3) for c in panel(i) + [("set_title", [f"panel {i}"])]])
case("grid_3x1", ("$subplots", [3, 1]), *[c for i in range(3) for c in panel(i) + [("set_ylabel", [f"y{i}"])]],
     ("set_xlabel", ["time"]))
case("grid_2x2", ("$subplots", [2, 2]), *[c for i in range(4) for c in panel(i) + [("set_title", [f"title {i}"]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"])]])
case("grid_2x3_ratios", ("$subplots", [2, 3], {"gridspec_kw": {"width_ratios": [1, 2, 1], "height_ratios": [2, 1]}}), *panels(6))
case("grid_sharex_col", ("$subplots", [2, 2], {"sharex": "col"}),
     ("plot", [[0, 1, 2], [1, 3, 2]]), ("sca", [1]), ("plot", [[10, 20, 30], [0, 1, 0]]),
     ("sca", [2]), ("plot", [[-1, 0.5], [5, 6]]), ("set_xlabel", ["left x"]), ("sca", [3]), ("plot", [[15, 50], [2, 1]]), ("set_xlabel", ["right x"]))
case("grid_sharey_row", ("$subplots", [2, 2], {"sharey": "row"}),
     ("plot", [[0, 1, 2], [1, 3, 2]]), ("set_ylabel", ["top y"]), ("sca", [1]), ("plot", [[0, 1], [10, -4]]),
     ("sca", [2]), ("plot", [[0, 1], [100, 200]]), ("set_ylabel", ["bottom y"]), ("sca", [3]), ("plot", [[0, 1], [150, 260]]))
case("grid_sharex_row_sharey_col", ("$subplots", [2, 2], {"sharex": "row", "sharey": "col"}), *panels(4))
case("grid_share_all", ("$subplots", [2, 2], {"sharex": True, "sharey": True}),
     ("plot", [[0, 1, 2], [100000.0, 100000.5, 100001.0]]), ("sca", [1]), ("plot", [[1, 3], [100000.2, 100000.4]]),
     ("sca", [2]), ("plot", [[0.5, 2.5], [100000.1, 100000.9]]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]),
     ("sca", [3]), ("set_xlim", [-0.5, 4.0]), ("plot", [[2, 3], [100000.3, 100000.6]]), ("set_xlabel", ["x"]))
case("grid_subplots_adjust", ("$subplots", [2, 2]), *panels(4),
     ("fig.subplots_adjust", [], {"left": 0.08, "right": 0.97, "bottom": 0.07, "top": 0.95, "wspace": 0.45, "hspace": 0.6}))
case("grid_gridspec_kw_spacing", ("$subplots", [2, 3], {"gridspec_kw": {"wspace": 0.05, "hspace": 0.5}}), *panels(6),
     ("fig.subplots_adjust", [], {"wspace": 0.8, "left": 0.05}))
LONG = [("set_title", ["a fairly long panel title"]), ("set_xlabel", ["a long x axis label (units)"]), ("set_ylabel", ["long y label (units)"])]
case("grid_tight_layout_2x2", ("$subplots", [2, 2]), *[c for i in range(4) for c in panel(i) + LONG], ("fig.tight_layout", []))
case("grid_tight_layout_pads", ("$subplots", [2, 3]), *[c for i in range(6) for c in panel(i) + LONG[:2]], ("fig.tight_layout", [], {"pad": 0.5, "w_pad": 2.0, "h_pad": 0.2}))
case("grid_suptitle_suplabels", ("$subplots", [2, 2], {"sharex": True, "sharey": True}), *panels(4),
     ("fig.suptitle", ["A grid of four"]), ("fig.supxlabel", ["shared time"]), ("fig.supylabel", ["shared amplitude"]))
case("grid_suptitle_tight", ("$subplots", [2, 2]), *[c for i in range(4) for c in panel(i) + [("set_title", [f"t{i}"])]],
     ("fig.suptitle", ["Tight with a suptitle"]), ("fig.supxlabel", ["x"]), ("fig.supylabel", ["y"]), ("fig.tight_layout", []))
case("grid_twinx_cell", ("$subplots", [2, 2]), *panels(4), ("sca", [3]), ("set_ylabel", ["left"]), ("twinx", []),
     ("plot", [lin(20, 0, 10), lin(20, 1000, 3000)], {"color": "C1"}), ("set_ylabel", ["right"]))
case("grid_twinx_tight", ("$subplots", [1, 2]), *panels(2), ("set_ylabel", ["left"]), ("twinx", []),
     ("plot", [lin(20, 0, 10), lin(20, 1000, 3000)], {"color": "C1"}), ("set_ylabel", ["right"]), ("fig.tight_layout", []))
case("grid_figsize_dpi", ("$rc", [], {"figure.figsize": [7.0, 3.0], "figure.dpi": 80}), ("$subplots", [1, 3], {"sharey": True}), *panels(3))

# examples/small_multiples.ts, call for call (docs/images/small_multiples.svg)
CITIES = [('Oslo', [-4.0, -2.7, 1.0, 6.0, 11.0, 14.7, 16.0, 14.7, 11.0, 6.0, 1.0, -2.7]), ('Lisbon', [11.0, 11.8, 14.0, 17.0, 20.0, 22.2, 23.0, 22.2, 20.0, 17.0, 14.0, 11.8]), ('Cairo', [15.0, 15.9, 18.5, 22.0, 25.5, 28.1, 29.0, 28.1, 25.5, 22.0, 18.5, 15.9]), ('Sydney', [23.0, 22.3, 20.5, 18.0, 15.5, 13.7, 13.0, 13.7, 15.5, 18.0, 20.5, 22.3]), ('Quito', [13.5, 13.6, 13.8, 14.0, 14.2, 14.4, 14.5, 14.4, 14.2, 14.0, 13.8, 13.6]), ('Montreal', [-8.0, -6.0, -0.5, 7.0, 14.5, 20.0, 22.0, 20.0, 14.5, 7.0, -0.5, -6.0])]
SM = []
for i, (city, temps) in enumerate(CITIES):
    SM += [("sca", [i]), ("plot", [list(range(1, 13)), temps, "o-"], {"color": f"C{i}", "markersize": 4}), ("set_title", [city]), ("grid", [True], {"color": "0.9"})]
case("example_small_multiples", ("$subplots", [2, 3], {"sharex": True, "sharey": True, "figsize": [9, 5]}), *SM,
     ("fig.suptitle", ["Monthly mean temperature"]), ("fig.supxlabel", ["month"]), ("fig.supylabel", ["°C"]), ("fig.tight_layout", []))

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
        grid = next((c for c in calls if c[0] == "$subplots"), None)
        if grid is not None:
            # a grid: Axes listed row-major (fig.axes order); "sca" picks one by index
            fig, axarr = plt.subplots(*grid[1], squeeze=False, **grid[2])
            axes = list(axarr.flat)
        else:
            fig, ax0 = plt.subplots()
            axes = [ax0]
        ax = axes[0]
        for fn, args, kwargs in calls:
            if fn == "$subplots":
                continue
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
    check_no_literal_newlines(CASES)
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

