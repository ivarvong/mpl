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

def date(s): return {"$date": s}
def decode(a):
    """JSON spec -> matplotlib args. Tags (at any depth):
    {"$dates": [...]} / {"$date": s} → datetime64; {"$float": "nan"|"inf"|"-inf"} → float;
    {"$uint8rgb": rows} → uint8 ndarray; {"$tuple": items} → tuple (a dash linestyle such as (0, [1, 2])); {"$arange": [n, step]} → [i * step for i < n] (a dense x axis, stored small); {"$array": rows} → float ndarray (imshow only —
    a bare list-of-lists must stay a list so hist treats rows as datasets, not columns).
    """
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    if isinstance(a, dict) and "$date" in a:
        return np.datetime64(a["$date"], "us")
    if isinstance(a, dict) and "$float" in a:
        return float(a["$float"])  # "nan", "inf", "-inf"
    if isinstance(a, dict) and "$uint8rgb" in a:
        return np.asarray(a["$uint8rgb"], dtype=np.uint8)
    if isinstance(a, dict) and "$arange" in a:
        n, step = a["$arange"]
        return (np.arange(n, dtype=float) * step).tolist()
    if isinstance(a, dict) and "$array" in a:
        return np.asarray(decode(a["$array"]), dtype=float)
    if isinstance(a, dict) and "$tuple" in a:
        return tuple(decode(v) for v in a["$tuple"])
    if isinstance(a, list):
        return [decode(v) for v in a]
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
# Issue #67: set_title takes fontsize/fontdict/loc/pad/y, and each loc is its own title
case("title_loc_fontsize", ("plot", [x, sx]), ("set_title", ["ops / 15 min"], {"fontsize": 10, "loc": "left"}))
case("title_three_locs", ("plot", [x, sx]), ("set_title", ["left"], {"loc": "left", "color": "C3", "fontsize": "small"}),
     ("set_title", ["centre"], {"fontdict": {"fontsize": 16, "fontweight": "bold"}}), ("set_title", ["right"], {"loc": "right", "fontweight": "bold", "c": "0.4"}))
case("title_fontdict_kwarg_wins", ("plot", [x, sx]), ("set_title", ["kwarg wins"], {"fontdict": {"fontsize": 16, "color": "C1"}, "fontsize": 8}))
case("title_pad_y", ("plot", [x, sx]), ("set_title", ["padded"], {"pad": 20}), ("set_title", ["inside"], {"loc": "right", "y": 0.88, "fontsize": "x-small"}))
case("title_reset_on_call", ("plot", [x, sx]), ("set_title", ["first"], {"fontsize": 20, "color": "C2", "pad": 12}), ("set_title", ["second"]))
case("title_grid_tight", ("$subplots", [2, 2]), *[c for i in range(4) for c in [("sca", [i]), ("plot", [x, L(np.sin(np.array(x) + i))]),
     ("set_title", [f"panel {i}"], {"loc": "left", "fontsize": 9}), ("set_title", [f"n={50 + i}"], {"loc": "right", "fontsize": 9, "color": "0.5"})]],
     ("fig.tight_layout", []))

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

# examples/gantt.ts, call for call (no longer shown in the docs; examples/trace.ts is)
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

# Issue #68: (offset, [on, off, ...]) dash tuples wherever a linestyle goes, scaled by linewidth (lines.scale_dashes)
def T(off, seq): return {"$tuple": [off, seq]}
NONUNIFORM = T(0, [1, 2, 4, 2])
case("linestyle_dash_tuples",
     *[("plot", [x, L(np.asarray(sx) + 2.6 * i)], {"linestyle": ls, "linewidth": lw, "label": f"{tuple(ls['$tuple'])} lw {lw}"})
       for i, (ls, lw) in enumerate([(NONUNIFORM, 1), (NONUNIFORM, 2.5), (T(5, [6, 2]), 1.5), (T(-3, [1, 2, 4, 2]), 1.5),
                                     (T(0, [5]), 2), (T(0, [1, 2, 4]), 2), (T(0, None), 6), (T(0, []), 6), (T(17.5, [3, 1.5, 0.5, 1.5]), 1)])],
     ("legend", [], {"loc": "upper left", "fontsize": 7, "ncols": 3}))
case("linestyle_dash_tuples_reflines", ("plot", [x, sx], {"linestyle": NONUNIFORM}),
     ("axhline", [0.5], {"linestyle": T(2, [8, 3]), "linewidth": 2, "color": "C1", "label": "axhline"}),
     ("axvline", [3.3], {"linestyle": T(0, [0.5, 1.5]), "linewidth": 3, "color": "C2", "label": "axvline"}),
     ("grid", [True], {"linestyle": T(0, [4, 1, 1, 1]), "linewidth": 0.8}),
     ("legend", [], {"loc": "lower left"}))
case("linestyle_dash_tuples_collections",
     ("hlines", [[0.2, 0.5, 0.8], 0.1, 0.9], {"linestyles": NONUNIFORM, "linewidth": 2, "label": "hlines"}),
     ("vlines", [[0.3, 0.6], 0.05, 0.95], {"linestyles": [T(0, [3, 1]), T(1.5, [1, 1, 3, 1])], "colors": ["C1", "C2"], "label": "vlines"}),
     ("errorbar", [[0.15, 0.45, 0.75], [0.3, 0.6, 0.4]], {"yerr": 0.08, "fmt": "o", "elinestyle": T(0, [2, 1]), "capsize": 3, "label": "errorbar"}),
     ("legend", [], {"loc": "upper right"}))
case("linestyle_dash_tuples_unscaled", ("$rc", [], {"lines.scale_dashes": False, "figure.dpi": 72}),
     ("plot", [x, sx], {"linestyle": NONUNIFORM, "linewidth": 3, "label": "unscaled"}),
     ("plot", [x, cx], {"linestyle": T(4, [6, 2]), "linewidth": 1, "label": "offset 4"}),
     ("legend", []))

# Issue #69: arrowprops arrowstyle (FancyArrowPatch: the _Curve family, brackets, simple / fancy / wedge), with
# connectionstyle arc3 rad, relpos, shrinkA / shrinkB, mutation_scale, linewidth, alpha and the colour precedence
def _sty(style, i, n, dx, dy, **kw):
    y = 1 - (i + 0.5) / n
    return ("annotate", [style, [0.62, y]], {"xycoords": "axes fraction", "xytext": [0.62 - dx, y - dy], "textcoords": "axes fraction",
                                           "va": "center", "ha": "right", "fontsize": 9, "arrowprops": {"arrowstyle": style, **kw}})
CURVE_STYLES = ["-", "->", "-|>", "<-", "<->", "<|-", "<|-|>"]
case("annotate_arrowstyle_curves", ("set_xlim", [0, 1]), ("set_ylim", [0, 1]),
     *[_sty(st, i, len(CURVE_STYLES), 0.3, 0.0) for i, st in enumerate(CURVE_STYLES)],
     ("annotate", ["diag ->", [0.95, 0.9]], {"xycoords": "axes fraction", "xytext": [0.72, 0.55], "textcoords": "axes fraction", "arrowprops": {"arrowstyle": "->", "color": "C3", "lw": 2}}),
     ("annotate", ["diag <|-|>", [0.96, 0.08]], {"xycoords": "axes fraction", "xytext": [0.7, 0.3], "textcoords": "axes fraction", "arrowprops": {"arrowstyle": "<|-|>"}}),
     ("annotate", ["params", [0.98, 0.45]], {"xycoords": "axes fraction", "xytext": [0.7, 0.75], "textcoords": "axes fraction",
                                           "arrowprops": {"arrowstyle": "-|>,head_length=0.8,head_width=0.4", "fc": "C2", "ec": "C1"}}))
BRACKETS = ["]-", "-[", "]-[", "|-|", "]->", "<-["]
case("annotate_arrowstyle_brackets", ("set_xlim", [0, 1]), ("set_ylim", [0, 1]),
     *[_sty(st, i, len(BRACKETS), 0.3, 0.0, lw=1 + (i % 2)) for i, st in enumerate(BRACKETS)],
     ("annotate", ["vertical ]-[", [0.85, 0.1]], {"xycoords": "axes fraction", "xytext": [0.85, 0.85], "textcoords": "axes fraction", "ha": "center", "arrowprops": {"arrowstyle": "]-[,widthA=0.5,lengthB=0.6"}}),
     ("annotate", ["diagonal |-|", [0.98, 0.4]], {"xycoords": "axes fraction", "xytext": [0.72, 0.62], "textcoords": "axes fraction", "arrowprops": {"arrowstyle": "|-|,widthA=0.4,widthB=0.8", "color": "C4"}}),
     ("annotate", ["scaled", [0.98, 0.05]], {"xycoords": "axes fraction", "xytext": [0.72, 0.2], "textcoords": "axes fraction", "arrowprops": {"arrowstyle": "-[,widthB=2", "mutation_scale": 6}}))
case("annotate_arrowstyle_patches", ("plot", [x, sx]),
     ("annotate", ["simple", [1.5, math.sin(1.5)]], {"xytext": [0.5, -0.6], "arrowprops": {"arrowstyle": "simple"}}),
     ("annotate", ["fancy", [4.7, math.sin(4.7)]], {"xytext": [3.0, 0.6], "arrowprops": {"arrowstyle": "fancy", "connectionstyle": "arc3,rad=0.3", "color": "C1"}}),
     ("annotate", ["wedge", [7.8, math.sin(7.8)]], {"xytext": [6.2, -0.5], "arrowprops": {"arrowstyle": "wedge,tail_width=0.7", "fc": "C2", "ec": "none", "alpha": 0.6}}),
     ("annotate", ["simple rad", [9.5, math.sin(9.5)]], {"xytext": [8.0, 0.75], "arrowprops": {"arrowstyle": "Simple, tail_width=0.4, head_width=1.2", "connectionstyle": "arc3,rad=-0.4", "mutation_scale": 14, "fc": "0.8"}}),
     ("annotate", ["fancy short", [2.6, math.sin(2.6)]], {"xytext": [2.2, 0.15], "arrowprops": {"arrowstyle": "fancy,head_length=1.2"}}))
case("annotate_arrowstyle_props", ("plot", [x, sx]),
     ("annotate", ["rad ->", [2.0, math.sin(2.0)]], {"xytext": [0.2, -0.4], "arrowprops": {"arrowstyle": "->", "connectionstyle": "arc3,rad=0.5", "lw": 1.5, "color": "C3"}}),
     ("annotate", ["relpos, shrinkA 0", [5.0, math.sin(5.0)]], {"xytext": [3.4, 0.5], "arrowprops": {"arrowstyle": "-|>", "relpos": [0, 0], "shrinkA": 0, "shrinkB": 8}}),
     ("annotate", ["", [7.0, math.sin(7.0)]], {"xytext": [-30, -30], "textcoords": "offset points", "arrowprops": {"arrowstyle": "<->", "color": "C2", "shrinkA": 0, "shrinkB": 0}}),
     ("annotate", ["alpha + mutation", [8.5, math.sin(8.5)]], {"xytext": [6.0, -0.8], "fontsize": 14, "arrowprops": {"arrowstyle": "<|-", "alpha": 0.5, "mutation_scale": 25, "lw": 2}}),
     ("annotate", ["color wins", [3.9, math.sin(3.9)]], {"xytext": [4.4, -0.2], "arrowprops": {"arrowstyle": "-|>", "color": "C4", "facecolor": "C1", "edgecolor": "C2"}}),
     ("annotate", ["ya: color wins", [1.0, math.sin(1.0)]], {"xytext": [1.3, 0.3], "arrowprops": {"color": "C5", "facecolor": "C1", "headwidth": 6, "headlength": 6, "width": 2}}))
case("annotate_arrowstyle_dpi", ("$rc", [], {"figure.dpi": 72, "figure.figsize": [5.0, 3.5]}), ("plot", [x, sx]),
     ("annotate", ["->", [2.0, math.sin(2.0)]], {"xytext": [0.5, -0.5], "arrowprops": {"arrowstyle": "->"}}),
     ("annotate", ["]-[", [5.0, math.sin(5.0)]], {"xytext": [5.0, 0.5], "ha": "center", "arrowprops": {"arrowstyle": "]-["}}),
     ("annotate", ["fancy", [8.0, math.sin(8.0)]], {"xytext": [6.0, -0.6], "arrowprops": {"arrowstyle": "fancy", "connectionstyle": "arc3,rad=0.2"}}))

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

# examples/small_multiples.ts, call for call (docs/images/small_multiples.png)
CITIES = [('Oslo', [-4.0, -2.7, 1.0, 6.0, 11.0, 14.7, 16.0, 14.7, 11.0, 6.0, 1.0, -2.7]), ('Lisbon', [11.0, 11.8, 14.0, 17.0, 20.0, 22.2, 23.0, 22.2, 20.0, 17.0, 14.0, 11.8]), ('Cairo', [15.0, 15.9, 18.5, 22.0, 25.5, 28.1, 29.0, 28.1, 25.5, 22.0, 18.5, 15.9]), ('Sydney', [23.0, 22.3, 20.5, 18.0, 15.5, 13.7, 13.0, 13.7, 15.5, 18.0, 20.5, 22.3]), ('Quito', [13.5, 13.6, 13.8, 14.0, 14.2, 14.4, 14.5, 14.4, 14.2, 14.0, 13.8, 13.6]), ('Montreal', [-8.0, -6.0, -0.5, 7.0, 14.5, 20.0, 22.0, 20.0, 14.5, 7.0, -0.5, -6.0])]
SM = []
for i, (city, temps) in enumerate(CITIES):
    SM += [("sca", [i]), ("plot", [list(range(1, 13)), temps, "o-"], {"color": f"C{i}", "markersize": 4}), ("set_title", [city]), ("grid", [True], {"color": "0.9"})]
case("example_small_multiples", ("$subplots", [2, 3], {"sharex": True, "sharey": True, "figsize": [9, 5]}), *SM,
     ("fig.suptitle", ["Monthly mean temperature"]), ("fig.supxlabel", ["month"]), ("fig.supylabel", ["°C"]), ("fig.tight_layout", []))

# plots-1: hist, step, errorbar, axhline/axvline/axline, hlines/vlines (data is synthetic, seeded)
R = np.random.default_rng(20261101)
HN = L(R.normal(0, 1, 400)); HE = L(R.exponential(1.5, 300)); HA = L(R.normal(-1, 0.8, 200)); HB = L(R.normal(1, 1.2, 250)); HC = L(R.normal(0.3, 0.5, 150))
HW = L(R.uniform(0.2, 2.0, 400))
case("hist_basic", ("hist", [HN]))
case("hist_log", ("hist", [HE], {"bins": 20, "log": True, "color": "C1", "edgecolor": "k", "linewidth": 0.5}))
case("hist_density_weights", ("hist", [HN], {"bins": 15, "density": True, "weights": HW, "color": "C2", "alpha": 0.7, "label": "weighted"}),
     ("hist", [HN], {"bins": 15, "density": True, "histtype": "step", "label": "unweighted"}), ("legend", []))
case("hist_cumulative", ("hist", [HN], {"bins": 25, "cumulative": True, "histtype": "step", "label": "cumulative"}),
     ("hist", [HN], {"bins": 25, "cumulative": -1, "histtype": "step", "density": True, "label": "reversed, density"}), ("legend", [], {"loc": "center right"}))
case("hist_stepfilled_stacked", ("hist", [[HA, HB, HC]], {"bins": 20, "histtype": "stepfilled", "stacked": True, "label": ["a", "b", "c"], "alpha": 0.8}), ("legend", []))
case("hist_step_stacked_density", ("hist", [[HA, HB]], {"bins": 18, "histtype": "step", "stacked": True, "density": True, "label": ["a", "b"], "linewidth": [1, 2.5]}), ("legend", []))
case("hist_horizontal", ("hist", [HN], {"bins": "auto", "orientation": "horizontal", "rwidth": 0.8, "color": "C4", "edgecolor": "k"}))
case("hist_horizontal_step", ("hist", [[HA, HB]], {"bins": 12, "orientation": "horizontal", "histtype": "stepfilled", "label": ["a", "b"], "alpha": 0.5}), ("legend", []))
case("hist_side_by_side", ("hist", [[HA, HB, HC]], {"bins": 12, "label": ["a", "b", "c"]}), ("legend", []))
case("hist_barstacked_edges", ("hist", [[HA, HB]], {"bins": [-4, -2, -1, -0.5, 0, 0.5, 1, 2, 4], "histtype": "barstacked", "rwidth": 0.9,
     "color": ["C3", "C5"], "label": ["first", "second"]}), ("legend", []))
case("hist_align_range_bottom", ("hist", [HN], {"bins": 8, "range": [-2, 2], "align": "left", "histtype": "step", "bottom": 5, "label": "left"}),
     ("hist", [HN], {"bins": 8, "range": [-2, 2], "align": "right", "rwidth": 0.5, "label": "right"}), ("legend", []))
case("hist_estimators", ("$subplots", [2, 4], {"figsize": [10, 5]}),
     *[c for i, est in enumerate(["auto", "fd", "doane", "scott", "stone", "rice", "sturges", "sqrt"]) for c in [("sca", [i]), ("hist", [HE], {"bins": est}), ("set_title", [est])]],
     ("fig.tight_layout", []))
SX = list(range(10)); SY = [math.sin(i / 1.7) + 0.1 * i for i in SX]
case("step_where", ("step", [SX, SY], {"where": "pre", "label": "pre"}), ("step", [SX, [v + 1 for v in SY]], {"where": "post", "label": "post"}),
     ("step", [SX, [v + 2 for v in SY], "o--"], {"where": "mid", "label": "mid"}), ("plot", [SX, [v + 3 for v in SY]], {"drawstyle": "steps-mid", "label": "drawstyle"}),
     ("plot", [SX, [v + 4 for v in SY]], {"ds": "steps", "color": "k", "lw": 2}), ("legend", []))
EX = [0.5 * i for i in range(1, 11)]; EY = [math.exp(-v / 3) * 4 + 0.2 * math.sin(3 * v) for v in EX]
ELO = [0.1 + 0.03 * i for i in range(10)]; EHI = [0.3 - 0.02 * i for i in range(10)]
case("errorbar_asym_caps", ("errorbar", [EX, EY], {"yerr": [ELO, EHI], "xerr": 0.15, "fmt": "o", "capsize": 4, "ecolor": "C3", "elinewidth": 1, "label": "asymmetric"}),
     ("errorbar", [EX, [v + 1 for v in EY]], {"yerr": 0.2, "label": "default"}), ("legend", []))
case("errorbar_lims_every", ("errorbar", [EX, EY], {"yerr": 0.4, "lolims": [i % 3 == 0 for i in range(10)], "uplims": [i % 3 == 1 for i in range(10)], "errorevery": 2, "fmt": "s", "label": "lims, every 2"}),
     ("errorbar", [EX, [v + 2 for v in EY]], {"xerr": 0.2, "xlolims": True, "fmt": "none", "capsize": 3, "errorevery": [1, 3], "label": "fmt none"}),
     ("errorbar", [EX, [v + 4 for v in EY]], {"yerr": 0.3, "uplims": True, "capsize": 2, "errorevery": [i < 5 for i in range(10)], "fmt": "^-", "label": "mask"}),
     ("legend", [], {"loc": "upper right"}))
case("errorbar_inverted_lims", ("set_ylim", [6, -1]), ("errorbar", [EX, EY], {"yerr": 0.5, "lolims": True, "uplims": [i % 2 == 0 for i in range(10)], "fmt": "o", "label": "inverted"}), ("legend", []))
case("errorbar_barsabove_style", ("errorbar", [EX, EY], {"yerr": [ELO, EHI], "fmt": "s-", "markersize": 8, "markerfacecolor": "white", "lw": 2, "capsize": 5, "capthick": 2,
     "barsabove": True, "elinestyle": "--", "alpha": 0.8, "label": "styled"}), ("errorbar", [EX, [v - 1 for v in EY]], {"xerr": [ELO, EHI], "yerr": 0.1, "fmt": ".", "mew": 3, "capsize": 3, "label": "mew"}), ("legend", []))
case("errorbar_rc", ("$rc", [], {"errorbar.capsize": 3, "lines.linewidth": 2.5}), ("errorbar", [EX, EY], {"yerr": 0.25, "xerr": [0.1] * 10, "label": "rc caps"}), ("legend", []))
case("axlines", ("plot", [x, sx], {"label": "sin"}), ("axhline", [0.5], {"color": "C1", "ls": "--", "label": "axhline"}), ("axvline", [3], {"ymin": 0.1, "ymax": 0.9, "color": "k", "lw": 2}),
     ("axline", [[0, 0], [1, 0.2]], {"color": "C2", "label": "two points"}), ("axline", [[0, 1]], {"slope": -0.1, "ls": ":", "label": "slope"}),
     ("axhline", [], {"xmin": 0.25, "xmax": 0.75}), ("legend", []))
case("axline_autoscale", ("axhline", [5]), ("axvline", [-2], {"color": "C3"}))
case("axline_inside_bounds", ("plot", [[0, 10], [0, 10]]), ("axhline", [2]), ("axvline", [12]), ("axline", [[1, 1], [2, 3]], {"color": "C4"}))
case("axline_log", ("plot", [lin(20, 1, 100), L(np.geomspace(1, 1000, 20))]), ("set_xscale", ["log"]), ("set_yscale", ["log"]),
     ("axline", [[1, 1], [100, 1000]], {"color": "C1"}), ("axhline", [30], {"color": "C2"}), ("axvline", [10], {"color": "C3"}))
case("hlines_vlines", ("hlines", [[1, 2, 3], 0, [2, 4, 6]], {"colors": ["C0", "C1", "C2"], "linestyles": ["solid", "dashed", "dotted"], "label": "hlines"}),
     ("vlines", [[1, 2, 3, 4, 5], 0, [0.5, 1.5, 2.5, 3.5, 2.5]], {"colors": "k", "lw": 2, "label": "vlines"}), ("legend", []))
case("hlines_single", ("hlines", [0.5, 0.1, 0.9]), ("vlines", [[0.3], [0.2], [0.8]], {"color": "C3", "linestyles": "dashed", "alpha": 0.5}))
case("hist_integer_auto", ("hist", [[int(v) for v in np.round(R.normal(10, 3, 120))]], {"bins": "auto", "histtype": "step", "log": True}))
case("hist_rc_bins", ("$rc", [], {"hist.bins": "sturges", "patch.force_edgecolor": True}), ("hist", [HB], {"color": "C6"}))
case("scatter_under_line", ("plot", [[0, 1, 2, 3], [0, 1, 0, 1]], {"lw": 6}), ("scatter", [[0.5, 1.5, 2.5], [0.5, 0.5, 0.5]], {"s": 300, "c": "C1"}))
case("plots_grid", ("$subplots", [2, 2], {"figsize": [8, 6]}),
     ("hist", [[HA, HB]], {"bins": 15, "histtype": "stepfilled", "alpha": 0.6, "label": ["a", "b"]}), ("legend", []), ("set_title", ["hist"]),
     ("sca", [1]), ("errorbar", [EX, EY], {"yerr": [ELO, EHI], "fmt": "o", "capsize": 3, "label": "data"}), ("legend", []), ("set_title", ["errorbar"]),
     ("sca", [2]), ("step", [SX, SY], {"where": "mid", "label": "step"}), ("axhline", [0], {"color": "0.5", "lw": 0.8}), ("legend", []),
     ("sca", [3]), ("vlines", [SX, 0, SY], {"label": "stems"}), ("plot", [SX, SY, "o"]), ("axline", [[0, 0]], {"slope": 0.2, "color": "C3", "label": "trend"}), ("legend", []),
     ("fig.tight_layout", []))

# examples/histogram_errorbar.ts, call for call (docs/images/histogram_errorbar.png); the data is illustrative
LAT_BEFORE = [144, 166, 61, 136, 129, 173, 133, 152, 147, 173, 122, 192, 112, 155, 149, 249, 109, 159, 125, 97, 166, 85, 103, 135, 172, 162, 143, 76, 110, 118,   95, 69, 137, 164, 115, 172, 81, 93, 136, 112, 160, 151, 115, 84, 110, 152, 162, 112, 69, 80, 148, 114, 115, 93, 92, 171, 150, 105, 133, 141,   214, 90, 140, 170, 206, 104, 114, 160, 75, 144, 240, 149, 57, 97, 105, 183, 123, 69, 128, 136, 109, 92, 248, 171, 176, 123, 103, 111, 81, 213,   125, 197, 113, 150, 138, 78, 222, 114, 87, 161, 130, 145, 134, 59, 96, 95, 175, 131, 153, 116, 155, 123, 120, 138, 134, 276, 96, 75, 144, 100]
LAT_AFTER = [45, 71, 203, 76, 53, 199, 70, 244, 92, 178, 96, 120, 99, 96, 112, 122, 110, 106, 81, 101, 170, 79, 114, 152, 122, 140, 69, 114, 94, 95,   165, 96, 115, 53, 178, 138, 102, 93, 126, 151, 179, 136, 106, 143, 134, 107, 133, 132, 102, 87, 128, 72, 67, 115, 127, 115, 119, 47, 126, 165,   137, 135, 112, 114, 99, 118, 71, 166, 78, 137, 158, 137, 210, 48, 89, 157, 66, 78, 124, 106, 121, 109, 112, 81, 111, 91, 95, 136, 65, 41,   133, 111, 158, 79, 101, 107, 84, 76, 135, 62, 71, 99, 140, 86, 83, 97, 117, 92, 146, 149, 99, 189, 106, 147, 116, 115, 57, 69, 94, 148]
DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
case("example_histogram_errorbar", ("$subplots", [1, 2], {"figsize": [10, 4]}),
     ("hist", [[LAT_BEFORE, LAT_AFTER]], {"bins": "auto", "histtype": "stepfilled", "alpha": 0.5, "label": ["before", "after"]}),
     ("axvline", [130.5], {"color": "C0", "linestyle": "--", "label": "median before"}),
     ("axvline", [111], {"color": "C1", "linestyle": "--", "label": "median after"}),
     ("set_xlabel", ["latency (ms)"]), ("set_ylabel", ["requests"]), ("set_title", ["Latency distribution (illustrative)"]), ("legend", []),
     ("sca", [1]), ("errorbar", [DAYS, [131, 128, 125, 112, 109, 104, 102]], {"yerr": [[38, 35, 36, 30, 29, 27, 28], [52, 61, 49, 44, 47, 39, 41]], "fmt": "o-", "capsize": 4, "label": "p50 with p10–p90"}),
     ("axhline", [100], {"color": "0.5", "linewidth": 0.8, "linestyle": ":"}),
     ("set_ylabel", ["latency (ms)"]), ("set_title", ["Daily median (illustrative)"]), ("legend", [], {"loc": "upper right"}),
     ("fig.tight_layout", []))

# Issue #14: annotate and text take Dates and category names in 'data' coordinates (convert_xunits at draw time),
# and neither switches an axis's units: a Date in a text on a numeric axis leaves the ticks numeric
DAYS14 = dates("2026-01-01", 10, (1, "D")); VAL14 = [3, 4, 3.5, 5, 6, 5.5, 7, 6.5, 8, 7.5]
ARW14 = {"color": "C3", "width": 1, "headwidth": 6, "headlength": 6}
case("annotate_dates", ("plot", [DAYS14, VAL14]),
     ("annotate", ["peak", [date("2026-01-09"), 8]], {"xytext": [date("2026-01-03T12:00"), 7.5], "arrowprops": ARW14}),
     ("annotate", ["dip", [date("2026-01-02"), 4]], {"xytext": [20, -30], "textcoords": "offset points", "arrowprops": ARW14}),
     ("annotate", ["axes text, date point", [date("2026-01-06"), 5.5]], {"xytext": [0.55, 0.12], "textcoords": "axes fraction", "arrowprops": ARW14}),
     ("text", [date("2026-01-07"), 4, "text at a Date"]), ("axvline", [date("2026-01-05")], {"color": "C2", "ls": ":"}))
case("text_date_numeric_axis", ("plot", [[0, 1, 2], [0, 1, 0]]), ("text", [date("1970-01-02"), 0.5, "x = 1 day"]),
     ("annotate", ["also 1 day", [date("1970-01-02T12:00"), 0.8]], {"xytext": [0.2, 0.2], "arrowprops": ARW14}))
case("annotate_category", ("bar", [["apples", "pears", "plums"], [3, 5, 2]]),
     ("annotate", ["most", ["pears", 5]], {"xytext": ["plums", 4.5], "arrowprops": ARW14}),
     ("text", ["apples", 3.2, "first"], {"ha": "center"}))

# The arrow starts on the text's window extent, which must match matplotlib to the last bit (a one-ulp corner moved a
# thin shaft's antialiasing): every ha x va, a multi-line block, thin and thick shafts, arrows in each direction
EXT = []
for i, (ha, va) in enumerate([(h, v) for h in ["left", "center", "right"] for v in ["top", "bottom", "center", "baseline", "center_baseline"]]):
    gx, gy = 0.6 + (i % 5) * 1.9, 0.5 + (i // 5) * 1.0
    EXT.append(("annotate", [f"{ha[0]}/{va}" + ("\nline 2" if i % 4 == 1 else ""), [gx + (0.7 if i % 2 else -0.5), gy + (0.45 if i % 3 else -0.4)]],
                {"xytext": [gx, gy], "ha": ha, "va": va, "fontsize": 7 + i % 3,
                 "arrowprops": {"color": f"C{i % 10}", "width": [0.5, 1, 1.5, 2.5][i % 4], "headwidth": 5 + i % 4, "headlength": 4 + i % 5, "shrink": 0.05 * (i % 2)}}))
case("annotate_arrow_extent", ("set_xlim", [0, 10]), ("set_ylim", [0, 3.5]), *EXT)

# Issue #14 (comment): scatter legend entries (HandlerPathCollection) and loc='best' counting collection offsets
SC_X = [0.5, 1.2, 2.0, 2.6, 3.3]; SC_Y = [1.0, 2.2, 1.6, 2.9, 2.4]
case("scatter_legend_basic", ("scatter", [[1, 2, 3], [1, 2, 3]], {"label": "x"}), ("legend", []))
case("scatter_legend_styles",
     ("scatter", [SC_X, SC_Y], {"s": [20, 80, 200, 50, 120], "c": ["C0", "C1", "C2", "C3", "C4"], "marker": "s", "edgecolors": "k", "linewidths": 1, "label": "sized squares"}),
     ("scatter", [SC_X, [v - 0.8 for v in SC_Y]], {"marker": "^", "alpha": 0.5, "color": "C5", "label": "alpha triangles"}),
     ("plot", [SC_X, [v + 0.6 for v in SC_Y], "o-"], {"label": "line"}), ("legend", [], {"loc": "lower right"}))
case("scatter_legend_points",
     ("scatter", [SC_X, SC_Y], {"s": [10, 40, 90, 160, 250], "label": "sizes"}),
     ("plot", [SC_X, [v - 1 for v in SC_Y], "D--"], {"label": "line"}),
     ("errorbar", [SC_X, [v + 1 for v in SC_Y]], {"yerr": 0.2, "fmt": "o", "capsize": 3, "label": "errorbar"}),
     ("legend", [], {"scatterpoints": 3, "markerscale": 1.5, "loc": "upper left"}))
case("scatter_legend_rc", ("$rc", [], {"legend.scatterpoints": 4, "legend.markerscale": 0.7}),
     ("scatter", [SC_X, SC_Y], {"s": [10, 40, 90, 160, 250], "c": "C2", "marker": "*", "label": "rc points"}),
     ("plot", [SC_X, SC_Y, "s"], {"label": "markers"}), ("legend", [], {"scatteryoffsets": [0.2, 0.8]}))
case("scatter_legend_proxy", ("plot", [lin(30, 0, 6), L(np.sin(lin(30, 0, 6)))]),
     ("scatter", [[], []], {"c": "C3", "marker": "o", "label": "proxy (empty)"}), ("scatter", [[], []], {"c": "C2", "s": 80, "marker": "D", "label": "proxy s=80"}), ("legend", []))
# a cloud in the upper right and a line along the bottom: only the scatter offsets push 'best' away from code 1
CLOUD = R.uniform(0, 1, (60, 2))
case("scatter_best_offsets", ("plot", [[0, 10], [0.5, 0.5]], {"label": "baseline"}),
     ("scatter", [L(7 + 3 * CLOUD[:, 0]), L(7 + 3 * CLOUD[:, 1])], {"s": 12, "label": "cloud"}),
     ("set_xlim", [0, 10]), ("set_ylim", [0, 10]), ("legend", []))

# Every scatter marker through both PathCollection draws: one size and colour (draw_markers, GraphicsContext defaults:
# round join, SNAP_AUTO snaps only axis-aligned paths) and a per-point size list (draw_path_collection, even when the
# sizes are equal); odd and even edge widths pick PathSnapper's offset. Sub-pixel jitter in x.
MK = ["o", "s", "^", "v", "<", ">", "D", "d", "x", "+", "*", ".", "p", "h", "X", "P", "|", "_"]
UNFILLED = {"x", "+", "|", "_"}
MKC = []
for i, m in enumerate(MK):
    edge = {} if m in UNFILLED else {"edgecolors": "k", "linewidths": 1 + i % 2}
    MKC += [("scatter", [[0.13 * i + j for j in range(4)], [i] * 4], {"marker": m, "s": 50 + 7 * (i % 3), **edge}),
            ("scatter", [[6.07 * 1 + 0.11 * i + j for j in range(4)], [i] * 4], {"marker": m, "s": [60] * 4, "c": "C1"})]
case("scatter_markers_paths", ("$rc", [], {"figure.figsize": [6.4, 7.0]}), *MKC)

# loc='best' counts every Text child's window extent (Legend._auto_legend_data): a text, and an annotation as the union
# of its text and arrow, each alone in a corner the legend would otherwise take
LOW = [("plot", [[0, 1], [0.05, 0.05]], {"label": "low line"}), ("set_ylim", [0, 1])]
case("legend_best_text", *LOW, ("text", [0.75, 0.9, "text here"], {"fontsize": 14}), ("legend", []))
case("legend_best_annotation", *LOW, ("annotate", ["", [0.97, 0.97]], {"xytext": [0.6, 0.6], "arrowprops": {"color": "C1"}}),
     ("annotate", ["left note", [0.03, 0.95]], {"fontsize": 12}), ("legend", []))

# xycoords / textcoords as (x, y) pairs (blended_transform_factory): data x with an axes-fraction y and the reverse,
# offsets per axis, a Date on the data axis, and a pair with xy outside the axes (only the string 'data' hides it)
PAIR = [
    ("annotate", ["x data, y axes", [date("2026-01-04"), 0.92]], {"xycoords": ["data", "axes fraction"], "ha": "center", "arrowprops": ARW14,
                                                                   "xytext": [date("2026-01-02"), 0.6], "textcoords": ["data", "axes fraction"]}),
    ("annotate", ["x axes, y data", [0.03, 7]], {"xycoords": ["axes fraction", "data"]}),
    ("annotate", ["mixed offsets", [date("2026-01-08"), 6.5]], {"xytext": [-50, 0.15], "textcoords": ["offset points", "axes fraction"], "arrowprops": ARW14}),
    ("annotate", ["figure pixels x, data y", [10, 4]], {"xycoords": ["figure pixels", "data"], "color": "C2"}),
    ("annotate", ["pair, xy outside", [date("2026-02-20"), 5]], {"xycoords": ["data", "data"], "xytext": [0.6, 0.3], "textcoords": "axes fraction"}),
]
case("annotate_coord_pairs", ("plot", [DAYS14, VAL14]), *PAIR)

# cmap-1: scatter zorder, numeric c + cmap, set_aspect
SCX = lin(25, 0, 4); SCY = [math.sin(v * 1.7) + 0.15 * v for v in SCX]
SCC = [v / 4 for v in SCX]
case("scatter_zorder_over",
     ("plot", [[0, 1, 2, 3], [0, 1, 0, 1]], {"lw": 10, "color": "C0", "zorder": 1, "label": "under"}),
     ("scatter", [[0.5, 1.5, 2.5], [0.5, 0.5, 0.5]], {"s": 500, "c": "C1", "zorder": 3, "edgecolors": "k", "linewidths": 1, "label": "top"}),
     ("plot", [[0, 3], [0.5, 0.5]], {"lw": 5, "color": "C2", "zorder": 2, "label": "mid"}),
     ("legend", []))
case("scatter_zorder_under",
     ("scatter", [[0, 1, 2, 3], [0, 1, 0, 1]], {"s": 400, "c": "C3", "zorder": 0.5}),
     ("plot", [[0, 1, 2, 3], [0, 1, 0, 1]], {"lw": 8, "color": "C0", "zorder": 2}))
case("scatter_cmap_viridis",
     ("scatter", [SCX, SCY], {"c": SCC, "cmap": "viridis", "s": 80, "edgecolors": "none"}),
     ("set_title", ["viridis"]))
case("scatter_cmap_plasma_vminvmax",
     ("scatter", [SCX, SCY], {"c": SCC, "cmap": "plasma", "vmin": 0.2, "vmax": 0.8, "s": 90, "edgecolors": "k", "linewidths": 0.4}),
     ("set_title", ["plasma vmin/vmax"]))
case("scatter_cmap_coolwarm",
     ("scatter", [SCX, [v - 1 for v in SCY]], {"c": [v - 0.5 for v in SCC], "cmap": "coolwarm", "s": 70}),
     ("set_title", ["coolwarm"]))
case("scatter_cmap_reversed",
     ("scatter", [SCX, SCY], {"c": SCC, "cmap": "viridis_r", "s": 80}),
     ("set_title", ["viridis_r"]))
case("aspect_equal_line",
     ("plot", [[0, 1, 2, 3, 4], [0, 0.5, 1, 0.5, 0]], {"marker": "o"}),
     ("set_aspect", ["equal"]),
     ("set_title", ["equal"]))
case("aspect_equal_scatter",
     ("scatter", [[0, 1, 2, 3], [0, 1, 0.5, 2]], {"s": 120, "c": "C1"}),
     ("set_aspect", ["equal"]))
case("aspect_ratio_2",
     ("plot", [[0, 2, 4], [0, 1, 0]]),
     ("set_aspect", [2]),
     ("set_title", ["aspect=2"]))
case("aspect_equal_grid",
     ("$subplots", [1, 2], {"figsize": [8, 3.5]}),
     ("plot", [[0, 1, 2], [0, 1, 0]], {"marker": "s"}), ("set_aspect", ["equal"]), ("set_title", ["equal"]),
     ("sca", [1]), ("plot", [[0, 1, 2], [0, 2, 0]], {"marker": "o"}), ("set_aspect", ["equal"]), ("set_title", ["equal tall data"]),
     ("fig.tight_layout", []))


# cmap-2: imshow + colorbar (nearest first)
# {"$array": ...} → float ndarray in decode (explicit; bare lists stay lists for hist)
IM = {"$array": [[0, 1, 2], [3, 4, 5], [6, 7, 8]]}
case("imshow_nearest_viridis", ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}))
case("imshow_nearest_lower", ("imshow", [IM], {"cmap": "plasma", "interpolation": "nearest", "origin": "lower"}))
case("imshow_nearest_extent", ("imshow", [IM], {"cmap": "coolwarm", "interpolation": "nearest", "extent": [0, 3, 0, 2], "origin": "lower"}))
case("imshow_auto_small", ("imshow", [IM], {"cmap": "viridis"}))  # auto → nearest when zoomed in

case("colorbar_imshow_viridis", ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}), ("fig.colorbar", []))
case("colorbar_imshow_label", ("imshow", [IM], {"cmap": "plasma", "interpolation": "nearest"}), ("fig.colorbar", [], {"label": "intensity"}))
case("colorbar_scatter", ("scatter", [lin(20, 0, 10), lin(20, 0, 5)], {"c": lin(20, 0, 1), "cmap": "coolwarm", "s": 40}), ("fig.colorbar", []))
case("colorbar_imshow_tight", ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}), ("fig.colorbar", []), ("fig.tight_layout", []))
case("colorbar_grid", ("$subplots", [1, 2]), ("sca", [0]), ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}), ("fig.colorbar", []), ("sca", [1]), ("imshow", [{"$array": [[0, 1], [1, 0]]}], {"cmap": "magma", "interpolation": "nearest"}), ("fig.colorbar", []))

# more imshow cases
case("imshow_nan", ("imshow", [{"$array": [[0, 1, {"$float": "nan"}], [3, 4, 5], [6, 7, 8]]}], {"cmap": "viridis", "interpolation": "nearest"}))
case("imshow_vmin_vmax", ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest", "vmin": 2, "vmax": 6}))
case("imshow_origin_extent_auto", ("imshow", [IM], {"cmap": "RdBu", "origin": "lower", "extent": [-1, 1, -1, 1]}))

# Downsampling: auto → hanning when data has more pixels than display
_Zbig = {"$array": np.linspace(0, 1, 80 * 80).reshape(80, 80).tolist()}
case("imshow_downsample_auto", ("imshow", [_Zbig], {"cmap": "viridis"}))
case("imshow_downsample_nearest", ("imshow", [_Zbig], {"cmap": "viridis", "interpolation": "nearest"}))
# True downsample: 200×200 into a small axes → auto/hanning, rgba-stage
_Zdown = {"$array": np.linspace(0, 1, 200 * 200).reshape(200, 200).tolist()}
case("imshow_true_downsample_hanning",
     ("$rc", [], {"figure.figsize": [1.2, 1.2]}),
     ("imshow", [_Zdown], {"cmap": "viridis", "interpolation": "hanning"}))
case("imshow_true_downsample_auto",
     ("$rc", [], {"figure.figsize": [1.2, 1.2]}),
     ("imshow", [_Zdown], {"cmap": "viridis"}))
case("imshow_upsample_hanning",
     ("$rc", [], {"figure.figsize": [2.0, 2.0]}),
     ("imshow", [{"$array": [[0, 1], [2, 3]]}], {"cmap": "viridis", "interpolation": "hanning"}))
# RGB / RGBA
_rgb = {"$array": [[[1, 0, 0], [0, 1, 0]], [[0, 0, 1], [1, 1, 0]]]}
_rgba = {"$array": [[[1, 0, 0, 1], [0, 1, 0, 0.5]], [[0, 0, 1, 1], [1, 1, 0, 0.25]]]}
case("imshow_rgb_float", ("imshow", [_rgb], {"interpolation": "nearest"}))
case("imshow_rgba_float", ("imshow", [_rgba], {"interpolation": "nearest"}))
# uint8 RGB: encode as {"$uint8rgb": rows} so decode builds a uint8 array
_rgb8 = {"$uint8rgb": [[[255, 0, 0], [0, 255, 0]], [[0, 0, 255], [255, 255, 0]]]}
case("imshow_rgb_uint8", ("imshow", [_rgb8], {"interpolation": "nearest"}))
# Colorbar extend + horizontal
# extend triangles: default extendfrac=0.05, under/over from cmap LUT, axes shrunk like _ColorbarAxesLocator
case("colorbar_extend_both",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "both"}))
case("colorbar_extend_min",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "min"}))
case("colorbar_extend_max",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "max"}))
case("colorbar_extend_both_horizontal",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "both", "orientation": "horizontal"}))
case("colorbar_extend_min_horizontal",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "min", "orientation": "horizontal"}))
case("colorbar_extend_max_horizontal",
     ("imshow", [IM], {"cmap": "viridis", "vmin": 2, "vmax": 6, "interpolation": "nearest"}),
     ("fig.colorbar", [], {"extend": "max", "orientation": "horizontal"}))
case("colorbar_horizontal",
     ("imshow", [IM], {"cmap": "plasma", "interpolation": "nearest"}),
     ("fig.colorbar", [], {"orientation": "horizontal", "label": "h"}))
# ---- bundled pro themes (styles/*.mplstyle): matplotlib renders the same sheet from its file ----
STYLES = {}
STYLE_DIR = os.path.join(ROOT, "..", "styles")
# the pro sheets use Inter: matplotlib must load the same static v4.0 OTFs mpl baked (scripts/gen_fonts.py)
INTER_DIR = os.environ.get("INTER_DIR", "/usr/share/fonts/opentype/inter")
def use_static_inter():
    from matplotlib import font_manager as fm
    # drop any other Inter build (e.g. a system variable font) so findfont cannot pick it
    fm.fontManager.ttflist = [f for f in fm.fontManager.ttflist if f.name != "Inter" or os.path.dirname(os.path.realpath(f.fname)) == os.path.realpath(INTER_DIR)]
    for w in ("Regular", "Medium", "SemiBold", "Bold"):
        path = os.path.join(INTER_DIR, f"Inter-{w}.otf")
        if not any(os.path.realpath(f.fname) == os.path.realpath(path) for f in fm.fontManager.ttflist):
            fm.fontManager.addfont(path)
    got = fm.findfont(fm.FontProperties(family="Inter"), fallback_to_default=False)
    if os.path.realpath(got) != os.path.realpath(os.path.join(INTER_DIR, "Inter-Regular.otf")):
        raise RuntimeError(f"Inter resolves to {got}, not the static Inter v4.0 OTFs in INTER_DIR")
def styled(style, name, *calls):
    case(name, *calls); STYLES[name] = style
TX = list(range(24))
P50 = [round(40 + 6 * math.sin(i / 3) + i * 0.4, 2) for i in TX]
P95 = [round(v * 1.8 + 4 * math.cos(i / 2), 2) for i, v in zip(TX, P50)]
P99 = [round(v * 1.35 + 6, 2) for v in P95]
HRS = ["00", "04", "08", "12", "16", "20"]
OKR, ERR4, ERR5 = [120, 90, 210, 340, 300, 180], [12, 8, 25, 40, 33, 20], [3, 2, 9, 14, 6, 4]
SCT = [(i * 0.37) % 10 for i in range(40)]
SCV = [round(2 + 0.6 * v + 2.5 * math.sin(i * 1.7), 3) for i, v in enumerate(SCT)]
SCZ = [round(abs(math.sin(i * 0.9)) * 100, 2) for i in range(40)]
for st in ["pro-dark", "pro-mono", "pro-ember", "pro-slate"]:
    tag = st.replace("-", "_")
    styled(st, f"theme_{tag}_bands",
           ("fill_between", [TX, P50, P99], {"alpha": 0.15, "color": "C0", "linewidth": 0}),
           ("fill_between", [TX, P50, P95], {"alpha": 0.25, "color": "C0", "linewidth": 0}),
           ("plot", [TX, P50], {"label": "p50"}), ("plot", [TX, P95], {"label": "p95"}), ("plot", [TX, P99], {"label": "p99", "linestyle": "--"}),
           ("legend", [], {"loc": "upper left", "ncols": 3}), ("set_title", ["Latency (ms)"]), ("set_xlabel", ["hour"]))
    styled(st, f"theme_{tag}_stacked",
           ("bar", [HRS, OKR], {"label": "2xx", "width": 0.7}),
           ("bar", [HRS, ERR4], {"bottom": OKR, "label": "4xx", "width": 0.7}),
           ("bar", [HRS, ERR5], {"bottom": [a + b for a, b in zip(OKR, ERR4)], "label": "5xx", "width": 0.7}),
           ("legend", [], {"loc": "upper left"}), ("set_title", ["Requests / min"]), ("set_ylabel", ["requests"]))
    styled(st, f"theme_{tag}_scatter",
           ("scatter", [SCT, SCV], {"c": SCZ, "cmap": "viridis", "s": 28}),
           ("scatter", [[1, 5, 9], [9, 3, 6]], {"s": 40, "color": "C1", "label": "outliers"}),
           ("legend", []), ("set_title", ["Duration vs size"]), ("set_xlabel", ["payload (kB)"]), ("set_ylabel", ["ms"]))
    styled(st, f"theme_{tag}_multiples",
           ("$subplots", [1, 3], {"figsize": [9, 2.8], "sharey": True}),
           ("plot", [TX, [round(abs(math.sin(i / 4)) * 2, 3) for i in TX]], {"color": "C0"}), ("set_title", ["api"]),
           ("sca", [1]), ("plot", [TX, [round(abs(math.cos(i / 5)) * 1.5, 3) for i in TX]], {"color": "C1"}), ("set_title", ["web"]),
           ("sca", [2]), ("plot", [TX, [round(0.3 + (i % 7) * 0.2, 3) for i in TX]], {"color": "C3"}), ("set_title", ["worker"]),
           ("fig.tight_layout", []))
# the examples/themes/dashboard.ts figures, call for call (test/examples.test.ts checks the example renders these pixels)
DASH = json.load(open(os.path.join(ROOT, "..", "examples", "themes", "data.json")))
TICKS, TICKL = [0, 6, 12, 18, 24], ["00:00", "06:00", "12:00", "18:00", "24:00"]
for st, cmap, vmin, heat in [("pro-dark", "viridis", -20, "magma"), ("pro-mono", "Blues", -40, "Greys"), ("pro-ember", "inferno", -40, "inferno"), ("pro-slate", "plasma", -10, "Blues")]:
    D = DASH
    calls = [("$subplots", [2, 3], {"figsize": [13, 7]}),
             ("fill_between", [D["hours"], D["p50"], D["p99"]], {"color": "C0", "alpha": 0.12, "linewidth": 0}),
             ("fill_between", [D["hours"], D["p50"], D["p95"]], {"color": "C0", "alpha": 0.22, "linewidth": 0}),
             ("plot", [D["hours"], D["p50"]], {"color": "C0", "label": "p50"}),
             ("plot", [D["hours"], D["p95"]], {"color": "C1", "label": "p95"}),
             ("plot", [D["hours"], D["p99"]], {"color": "C3", "label": "p99", "linestyle": "--"}),
             ("axhline", [150], {"color": "C5", "linewidth": 0.8, "linestyle": ":"}),
             ("set_xticks", [TICKS]), ("set_xticklabels", [TICKL]), ("set_ylim", [0, 220]),
             ("legend", [], {"loc": "upper left", "ncols": 3}), ("set_title", ["Latency (ms)"]),
             ("sca", [1]),
             ("bar", [D["bucket"], D["ok"]], {"color": "C0", "width": 0.72, "label": "2xx"}),
             ("bar", [D["bucket"], D["e4"]], {"bottom": D["ok"], "color": "C1", "width": 0.72, "label": "4xx"}),
             ("bar", [D["bucket"], D["e5"]], {"bottom": [a + b for a, b in zip(D["ok"], D["e4"])], "color": "C3", "width": 0.72, "label": "5xx"}),
             ("legend", [], {"loc": "upper left", "ncols": 3}), ("set_ylim", [0, 1900]), ("set_title", ["Requests / 2 h"]),
             ("sca", [2]),
             ("imshow", [{"$array": D["heat"]}], {"cmap": heat, "origin": "lower", "aspect": "auto", "interpolation": "nearest", "extent": [0, 24, 0, 320]}),
             ("set_xticks", [TICKS]), ("set_xticklabels", [TICKL]), ("set_title", ["Latency heatmap (ms)"]),
             ("fig.colorbar", [], {"label": "requests"})]
    for i, svc in enumerate(["api", "web"]):
        col = f"C{i}"
        calls += [("sca", [3 + i]),
                  ("fill_between", [D["hours"], 0, D["errors"][svc]], {"color": col, "alpha": 0.18, "linewidth": 0}),
                  ("plot", [D["hours"], D["errors"][svc]], {"color": col, "linewidth": 1.2}),
                  ("axhline", [1.5], {"color": "C5", "linewidth": 0.8, "linestyle": "--"}),
                  ("set_ylim", [0, 2.6]), ("set_xticks", [TICKS]), ("set_xticklabels", [TICKL]), ("set_title", [f"{svc} error rate (%)"])]
    calls += [("sca", [5]),("scatter", [D["size"], D["dur"]], {"c": D["cache"], "cmap": cmap, "vmin": vmin, "vmax": 100, "s": 14, "alpha": 0.9}),
             ("set_title", ["Duration vs payload (colour: cache hit %)"]), ("set_xscale", ["log"]), ("set_xlabel", ["payload (kB)"])]
    calls += [("fig.suptitle", [f"checkout service \u00b7 last 24 h \u00b7 {st}"]),
              ("fig.subplots_adjust", [], {"left": 0.045, "right": 0.975, "bottom": 0.07, "top": 0.89, "wspace": 0.3, "hspace": 0.42})]
    styled(st, f"theme_{st.replace('-', '_')}_dashboard", *calls)
# marker paths at full precision: a 6-digit unit circle flattens differently, moving antialiased edge pixels
MPX = [round(0.37 * i % 10, 4) for i in range(300)]
MPY = [round((0.61 * i) % 7 + 0.013 * i, 4) for i in range(300)]
case("scatter_marker_precision", ("scatter", [MPX, MPY], {"c": [i % 17 for i in range(300)], "s": 14}),
     ("scatter", [[v + 0.05 for v in MPX], MPY], {"c": [i % 5 for i in range(300)], "s": 40, "marker": "o", "cmap": "plasma"}))
# tight_layout with no titles: the top is the axes patch (h·1 + b) and the bottom the x tick labels, both y-up
styled("pro-mono", "theme_pro_mono_tight_untitled",
       ("$subplots", [1, 3], {"figsize": [9, 2.8], "sharey": True}),
       ("sca", [2]), ("plot", [TX, [round(0.3 + (i % 7) * 0.2, 3) for i in TX]]),
       ("fig.tight_layout", []))

# examples/trace.ts, call for call: the README's side-by-side (docs/images/readme/trace-*.png), at 200 dpi
WATERFALL = [("GET /api/checkout", 0, 120, "C0"), ("auth.verify", 2, 14, "C1"), ("db.query orders", 15, 55, "C2"),
             ("pool.acquire", 15, 19, "C2"), ("inventory.reserve", 56, 92, "C4"), ("render.json", 93, 118, "C3")]
for st in ["pro-slate", "pro-dark"]:
    styled(st, f"example_trace_{st.replace('-', '_')}",
           ("$rc", [], {"figure.figsize": [4.4, 3.7], "figure.dpi": 200}),
           ("barh", [list(range(len(WATERFALL))), [e - s for _, s, e, _ in WATERFALL]],
            {"left": [s for _, s, _, _ in WATERFALL], "color": [c for *_, c in WATERFALL], "height": 0.34}),
           *[("text", [e if s > 80 else s, i - 0.25, f"{n}  {e - s} ms"],
              {"ha": "right" if s > 80 else "left", "va": "bottom", "fontsize": 9.5, "fontweight": "semibold" if i == 0 else "normal"})
             for i, (n, s, e, _) in enumerate(WATERFALL)],
           ("set_yticks", [[]]), ("set_ylim", [len(WATERFALL) - 0.5, -0.85]), ("set_xlim", [0, 122]),
           ("grid", [False], {"axis": "y"}), ("grid", [True], {"axis": "x"}),
           ("set_xlabel", ["ms since request start"]), ("set_title", ["Checkout request trace"]),
           ("fig.tight_layout", []))


# A dense time series, modelled on the archival-tag chart in the markstream + mpl blog: three channels (light, temperature,
# depth) of 11,641 samples each at 30 s (34,923 in all), noisy, with dives and one-sample deep spikes. Synthetic and
# seeded; quantized like the tag (light 1, temperature 0.05 °C, depth 0.5 m) so the spec stays small. Exercises
# path.simplify (PathSimplifier) on long noisy lines; the depth panel is inverted with set_ylim(hi, lo).
def tag_series(n=11641, dt_h=30 / 3600):
    rng = np.random.default_rng(20130618)
    t = np.arange(n) * dt_h
    hod = (6.5 + t) % 24
    depth = 12 + 6 * np.sin(2 * np.pi * t / 5.3) + rng.normal(0, 1.2, n)
    for _ in range(26):   # dives, clustered around dawn (~08:45) and dusk (~00:15)
        centre = rng.choice([8.75, 24.25]) + rng.normal(0, 1.2) + 24 * rng.integers(0, 5) - 6.5
        i0 = int(centre / dt_h)
        down, bottom, up = (int(v) for v in rng.integers([8, 6, 10], [30, 60, 40]))
        dmax = rng.uniform(60, 215)
        prof = np.concatenate([np.linspace(0, 1, down), np.ones(bottom) + rng.normal(0, 0.04, bottom), np.linspace(1, 0, up)])
        for k, f in enumerate(prof):
            if 0 <= i0 + k < n:
                depth[i0 + k] = max(depth[i0 + k], 12 + f * dmax)
    spikes = rng.choice(n, 40, replace=False)
    depth[spikes] += rng.uniform(80, 210, 40)
    depth = np.clip(depth, 1, 240)
    sun = np.clip(np.sin(np.pi * (hod - 8.75) / 15.5), 0, None) ** 0.7   # sunrise ~08:45, sunset ~00:15
    cloud = 1 - 0.35 * np.clip(np.sin(t / 3.1) * np.sin(t / 0.7), 0, None)
    light = 22 + 188 * sun * cloud * np.exp(-depth / 140) + rng.normal(0, 1.5, n)
    temp_now = 11 + 10 / (1 + np.exp((depth - 70) / 18))
    temp = np.empty(n); temp[0] = temp_now[0]
    for i in range(1, n):   # 150 s sensor lag
        temp[i] = temp[i - 1] + (temp_now[i] - temp[i - 1]) * (30 / 150)
    temp += rng.normal(0, 0.06, n)
    q = lambda v, s: [round(float(x), 2) for x in np.round(v / s) * s]
    return {"$arange": [n, dt_h]}, q(light, 1), q(temp, 0.05), q(depth, 0.5)
TX, TLIGHT, TTEMP, TDEPTH = tag_series()
case("dense_timeseries_tag", ("$rc", [], {"figure.figsize": [7.2, 4.8]}), ("$subplots", [3, 1], {"sharex": True}),
     ("plot", [TX, TLIGHT], {"lw": 0.8, "color": "#63B2EB"}), ("set_ylim", [0, 250]), ("set_ylabel", ["Light"]),
     ("sca", [1]), ("plot", [TX, TTEMP], {"lw": 0.8, "color": "#3F72A5"}), ("set_ylim", [10, 22]), ("set_ylabel", ["Temp (°C)"]),
     ("sca", [2]), ("plot", [TX, TDEPTH], {"lw": 0.8, "color": "#050830"}), ("set_ylim", [250, 0]), ("set_ylabel", ["Depth (m)"]),
     ("set_xlabel", ["hours since 2013-06-18 06:30"]))

# path.simplify around matplotlib's other line converters (seeded noisy series, 3 decimals):
# Line2D._subslice draws only the samples around a zoomed xlim (sorted x, > 1000 points), which moves where the
# simplifier starts; spikes that leave the figure go through PathClipper, whose MOVETOs restart the simplifier.
SR = np.random.default_rng(20261107)
SY = [round(float(v), 3) for v in np.sin(np.arange(6000) / 600) * 10 + SR.uniform(0, 3, 6000)]
case("simplify_zoom_subslice", ("plot", [{"$arange": [6000, 1]}, SY], {"lw": 1}), ("set_xlim", [1500.5, 2500]))
CY = [round(float(v), 3) for v in np.sin(np.arange(3000) / 300) + SR.uniform(0, 0.3, 3000)]
for i in range(0, 3000, 397): CY[i] += 40
for i in range(0, 3000, 211): CY[i] -= 25
case("simplify_clip_spikes", ("plot", [{"$arange": [3000, 1]}, CY], {"lw": 1}), ("set_ylim", [-2, 2.5]))

# NaN in plot() data: PathNanRemover breaks the line (a MOVETO after each gap), dataLim skips a vertex when either
# coordinate is non-finite (update_path_extents), markers skip NaN points, and legend 'best' bridges a gap.
NAN = {"$float": "nan"}
case("plot_nan_gaps",
     ("plot", [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [NAN, 1, 2, NAN, 4, 5, NAN, NAN, 8, NAN]], {"marker": "o", "label": "y gaps"}),
     ("plot", [[0, 1, NAN, 3, 4, 5, 6, 7, 8, 9.5], [2, 3, 4, 5, NAN, 7, 6, 5, 4, 3]], {"drawstyle": "steps-mid", "label": "x gap, steps"}),
     ("plot", [[NAN, 2, 4, 6, 12], [1, 1.5, 2, 2.5, NAN]], {"ls": "--", "lw": 2, "label": "NaN ends"}),
     ("legend", [], {"loc": "best"}))
# legend 'best' tests lines through PathNanRemover and ignores MOVETOs: the NaN gap below is one segment across the
# top of the axes (both finite points lie outside them), so upper right and upper left count as hit
case("plot_nan_legend_best", ("plot", [[-5, 0, 15], [9.5, NAN, 9.5]], {"label": "gap across the top"}),
     ("plot", [[1, 9], [5, 5]], {"label": "middle"}), ("set_xlim", [0, 10]), ("set_ylim", [0, 10]), ("legend", [], {"loc": "best"}))
NR = np.random.default_rng(20261108)
NX = [float(i) for i in range(5000)]; NY = [round(float(v), 3) for v in np.sin(np.arange(5000) / 400) * 5 + NR.uniform(0, 2, 5000)]
for a, b in [(0, 3), (700, 701), (1500, 1505), (2600, 2640), (3333, 3334), (4990, 5000)]:
    for i in range(a, b): NY[i] = NAN
for i in (1200, 2000, 2001, 3900): NX[i] = NAN
case("plot_nan_dense", ("plot", [NX, NY], {"lw": 1}), ("set_xlim", [800, 4200]))

# Fractional canvas height: Agg's canvas is int(h·dpi) and RendererAgg flips paths, markers, images and clip boxes with
# that int height, while text flips with the float height (Text._draw uses get_canvas_width_height, then FreeType's y).
case("frac_canvas_tag_dpi72", ("$rc", [], {"figure.figsize": [7.2, 4.94], "figure.dpi": 72}), ("$subplots", [3, 1], {"sharex": True}),
     ("plot", [TX, TLIGHT], {"lw": 0.8, "color": "#63B2EB"}), ("set_ylim", [0, 250]), ("set_ylabel", ["Light"]),
     ("sca", [1]), ("plot", [TX, TTEMP], {"lw": 0.8, "color": "#3F72A5"}), ("set_ylim", [10, 22]), ("set_ylabel", ["Temp (°C)"]),
     ("sca", [2]), ("plot", [TX, TDEPTH], {"lw": 0.8, "color": "#050830"}), ("set_ylim", [250, 0]), ("set_ylabel", ["Depth (m)"]),
     ("set_xlabel", ["hours since 2013-06-18 06:30"]))
FR = np.random.default_rng(20261108)
FIMG = [[round(float(v), 3) for v in row] for row in FR.uniform(0, 1, (6, 8))]
case("frac_canvas_mixed", ("$rc", [], {"figure.figsize": [6.4, 4.805], "figure.dpi": 100}), ("$subplots", [2, 2]),
     ("plot", [[0, 1, 2, 3, 4], [1, 3, 2, 4, 3]], {"marker": "o", "label": "line"}), ("axhline", [2.5], {"color": "k", "lw": 1}),
     ("grid", [True]), ("legend", [], {"loc": "upper left"}), ("set_title", ["fractional height"]),
     ("sca", [1]), ("bar", [[0, 1, 2, 3], [3, 1.5, 2.25, 0.7]], {"color": "C1", "edgecolor": "k"}), ("text", [0.5, 2.5, "text in data"]),
     ("sca", [2]), ("scatter", [[0.1, 0.4, 0.5, 0.9, 0.33], [0.2, 0.8, 0.45, 0.6, 0.1]], {"s": 60, "c": "C2"}),
     ("fill_between", [[0, 0.5, 1], [0, 0.3, 0.1], [0.2, 0.6, 0.4]], {"alpha": 0.4}),
     ("sca", [3]), ("imshow", [{"$array": FIMG}]))
case("frac_canvas_odd_dpi", ("$rc", [], {"figure.figsize": [5.0, 3.3], "figure.dpi": 77}),
     ("plot", [[0, 1, 2, 3], [0, 1, 0.5, 2]], {"lw": 1.5, "marker": "s"}), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]),
     ("fig.suptitle", ["suptitle"]))

# The SVG backend clips line paths to the float canvas (PathClipper over (0, 0, width, height) in points, ±1); Agg to
# its int canvas. At 72 dpi the SVG is in px: spikes leave the bottom of a 345.96 px tall figure (test/svg-geometry.test.ts).
case("frac_canvas_svg_clip", ("$rc", [], {"figure.figsize": [6.4, 4.805], "figure.dpi": 72}),
     ("plot", [[0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 2, -60, 1.5, 2.5, -400, 1, 80, 2]], {"lw": 1.5, "color": "#d62728"}),
     ("plot", [[0, 8], [-50, -50]], {"lw": 1, "color": "#2ca02c"}),
     ("set_ylim", [0, 3]))

# matplotlib's SVG backend never pixel-snaps (Agg's PathSnapper and draw_markers' pixel grid are Agg-only). At 72 dpi
# its SVG is in px, so test/svg-geometry.test.ts compares mpl's SVG geometry with it: lines, grid, spines, ticks, the
# axes patch, bars, spans, markers and the legend.
case("svg_nosnap", ("$rc", [], {"figure.figsize": [6.3, 4.1], "figure.dpi": 72}),
     ("plot", [[0.3, 1.1, 2.2, 3.7], [1.15, 2.6, 1.9, 3.3]], {"marker": "o", "ms": 7, "color": "#1f77b4", "label": "line"}),
     ("plot", [[0.2, 3.9], [0.7, 0.7]], {"lw": 1.5, "color": "#9467bd", "label": "flat"}),
     ("axhline", [2.13], {"color": "#8c564b", "lw": 1}),
     ("axvline", [2.71], {"color": "#e377c2", "lw": 2}),
     ("bar", [[0.5, 1.5, 2.5], [0.83, 1.37, 0.61]], {"width": 0.43, "color": "#ff7f0e", "edgecolor": "#000000", "lw": 1, "label": "bars"}),
     ("axvspan", [3.05, 3.33], {"color": "#bcbd22", "alpha": 0.5}),
     ("scatter", [[0.71, 1.93, 3.17], [3.07, 3.41, 2.29]], {"marker": "s", "s": 50, "c": "#17becf", "edgecolors": "#000000", "label": "sq"}),
     ("fill_between", [[1.0, 1.6, 2.0], [0.13, 0.2, 0.3], [0.41, 0.33, 0.47]], {"color": "#7f7f7f", "alpha": 0.4}),
     ("grid", [True]), ("legend", [], {"loc": "upper left"}))
# invert_xaxis / invert_yaxis (Axis.set_inverted: _set_lim(sorted, reverse=inverted), auto=None): an autoscaled axis
# stays autoscaled and keeps its inversion through later autoscaling (set_bound), set limits are swapped in place.
case("invert_yaxis_auto", ("plot", [[0, 1, 2, 3], [1.5, 3.2, 2.1, 4.7]], {"marker": "o"}), ("invert_yaxis", []))
case("invert_before_plot", ("invert_yaxis", []), ("plot", [[0, 1, 2], [3, 1, 2]]), ("invert_xaxis", []),
     ("plot", [[0.5, 4], [0, 5]], {"ls": "--"}), ("scatter", [[1, 3], [6, -1]]))
case("invert_barh_categories", ("barh", [["alpha", "beta", "gamma", "delta"], [3, 7, 2, 5]]), ("invert_yaxis", []),
     ("invert_xaxis", []), ("set_title", ["top-down categories, right to left"]))
case("invert_fixed_toggle", ("plot", [[0, 10], [0, 10]]), ("set_ylim", [2, 8]), ("invert_yaxis", []), ("invert_xaxis", []),
     ("invert_xaxis", []), ("set_xlim", [1, 9]))

# Spines: a spine disabled in rc comes back with set_visible(True); set_position 'outward' (also inward), 'axes', 'data',
# 'center' and 'zero'. The x (y) ticks and their labels follow the bottom (left) spine (tick1 is the spine transform).
SPX = [round(-3 + i * 0.1, 1) for i in range(61)]
SPY = [round(float(np.sin(v) * 1.6 + 0.3 * v), 4) for v in SPX]
case("spines_rc_reenable", ("$rc", [], {"axes.spines.top": False, "axes.spines.right": False}), ("plot", [SPX, SPY]),
     ("spine", ["top", "set_visible", True]), ("spine", ["top", "set_color", "C3"]))
case("spines_center", ("plot", [SPX, SPY]), ("spine", ["left", "set_position", "center"]), ("spine", ["bottom", "set_position", "center"]),
     ("spine", ["top", "set_visible", False]), ("spine", ["right", "set_visible", False]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))
case("spines_zero", ("plot", [[v + 1.2 for v in SPX], SPY]), ("spine", ["left", "set_position", "zero"]), ("spine", ["bottom", "set_position", "zero"]),
     ("spine", ["top", "set_visible", False]), ("spine", ["right", "set_visible", False]), ("set_title", ["zero"]))
case("spines_axes_data", ("plot", [SPX, SPY]), ("spine", ["left", "set_position", ["axes", 0.1]]), ("spine", ["bottom", "set_position", ["data", -0.5]]),
     ("spine", ["right", "set_position", ["data", 2.0]]), ("spine", ["top", "set_position", ["axes", 0.85]]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))
case("spines_inward", ("plot", [SPX, SPY]), ("spine", ["left", "set_position", ["outward", -12]]), ("spine", ["bottom", "set_position", ["outward", -8]]),
     ("spine", ["right", "set_position", ["outward", 10]]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))
# Fonts. Inter has ■ ● ‒ ▲ ✓ (mpl bakes Inter's General Punctuation, Arrows, Geometric Shapes and check marks); with font.family ["Inter", "DejaVu Sans"],
# matplotlib's font fallback (FT2Font _fallback_list, libraqm runs per face) draws what Inter lacks (∀ ∈ ∇ ⇄ ∃) from DejaVu.
case("font_inter_symbols", ("$rc", [], {"font.family": ["Inter"]}), ("plot", [[0, 1, 2], [1, 3, 2]], {"label": "● online"}),
     ("plot", [[0, 1, 2], [2, 1, 2.5]], {"label": "■ offline ‒ ok"}), ("legend", []), ("set_title", ["Status ■ ● ‒ ▲ ✓ • → ±"]),
     ("set_xlabel", ["time — s"]))
case("font_fallback_chain", ("$rc", [], {"font.family": ["Inter", "DejaVu Sans"]}), ("plot", [[0, 1, 2], [1, 3, 2]], {"label": "∃ a ■ b"}),
     ("legend", []), ("set_title", ["∀x ∈ S: ∇f ⇄ g ■ ok"]), ("set_xlabel", ["Wave ∇ AV ∇ Ta"]),
     ("text", [0.2, 2.5, "x∈A∧B, AV∀To"]))
case("font_fallback_chain_bold", ("$rc", [], {"font.family": ["Inter", "DejaVu Sans"], "axes.titleweight": "bold"}),
     ("plot", [[0, 1], [0, 1]]), ("set_title", ["Bold ∀ ∈ ■ ‒ fallback"]))

def run_case(name, calls):
    style = STYLES.get(name)
    rc_layer = {}
    sheet = os.path.join(STYLE_DIR, f"{style}.mplstyle") if style else None
    with matplotlib.rc_context(), (plt.style.context(sheet) if sheet else contextlib.nullcontext()):
        # Guardrail: these fixtures must be rendered with FreeType 2.14.3 and no hinting
        # (stock matplotlib 3.11.2 wheels); this reproduces the committed oracle PNGs.
        ver = getattr(ft, "__freetype_version__", "")
        if ver != "2.14.3":
            raise RuntimeError(f"FreeType mismatch: expected 2.14.3, got {ver}. "
                               "Use the stock matplotlib 3.11.2 wheel that bundles FreeType 2.14.3.")
        if not style:   # a pro sheet names its own font
            matplotlib.rcParams["font.family"] = "DejaVu Sans"
        else:
            use_static_inter()
        if any(fn == "$rc" and "Inter" in str(kw.get("font.family", "")) for fn, _a, kw in calls):
            use_static_inter()
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
                method = fn[4:]
                if method == "colorbar":
                    # last ScalarMappable on the current Axes (imshow / collection)
                    mappable = ax.images[-1] if ax.images else (ax.collections[-1] if ax.collections else None)
                    if mappable is None:
                        raise RuntimeError("fig.colorbar: no mappable on current Axes")
                    fig.colorbar(mappable, ax=ax, **kwargs); continue
                getattr(fig, method)(*args, **kwargs); continue
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
                kwargs = {k: (ax.transAxes if isinstance(v, dict) and v.get("$transform") == "axes" else decode(v)) for k, v in kwargs.items()}
                # an (x, y) coordinate-system pair is a tuple to matplotlib (JSON only has lists)
                kwargs = {k: (tuple(v) if k in ("xycoords", "textcoords") and isinstance(v, list) else v) for k, v in kwargs.items()}
                getattr(ax, fn)(*args, **kwargs)
        fig.canvas.draw()
        recs = [record(a, fig) for a in axes]
        # figaxes: every Axes in fig.axes order (colorbar caxes too), so their ticks are pinned, not only their pixels
        rec = dict(spec=calls, style=style, rc=rc_layer, **recs[0], axes=recs, figaxes=[record(a, fig) for a in fig.axes])
        fig.savefig(os.path.join(OUT, f"{name}.svg"))
        fig.savefig(os.path.join(OUT, f"{name}.png"))
        with open(os.path.join(OUT, f"{name}.json"), "w") as f:
            json.dump(rec, f, indent=1)
        plt.close(fig)


# boxplot (data is synthetic, seeded)
RB = np.random.default_rng(11)
BA = RB.normal(0, 1, 80).tolist()
BB = (RB.normal(1.5, 0.8, 70) + [8.0]).tolist()
BC = RB.normal(-0.5, 1.1, 60).tolist()
case("boxplot_basic", ("boxplot", [[BA, BB, BC]]))
case("boxplot_notch_means", ("boxplot", [[BA, BB]], {"notch": True, "showmeans": True, "tick_labels": ["a", "b"]}))
case("boxplot_patch_horiz", ("boxplot", [[BA, BB]], {"patch_artist": True, "orientation": "horizontal",
     "boxprops": {"facecolor": "C0"}, "medianprops": {"color": "k", "linewidth": 1.5}}))
case("boxplot_whis_fliers", ("boxplot", [[BB]], {"whis": [5, 95], "flierprops": {"marker": "x", "markersize": 8}}))
case("boxplot_meanline", ("boxplot", [[BA, BC]], {"showmeans": True, "meanline": True, "widths": 0.4,
     "positions": [1, 2], "showfliers": False}))
# Mixed float positions: tick labels must be str(np.float64) ('0.5','2.0','4.5'), not JS String() ('0.5','2','4.5')
case("boxplot_positions_float", ("boxplot", [[BA, BB, BC]], {"positions": [0.5, 2.0, 4.5], "widths": [0.3, 0.8, 1.2]}))

# Issue #65: a colorbar under LogNorm takes the norm's log scale (bands at norm.inverse of a uniform grid, LogLocator ticks)
LOGIM = {"$array": [[10, 100, 1000, 10000]]}
case("colorbar_lognorm", ("imshow", [LOGIM], {"cmap": "viridis", "norm": "log", "vmin": 10, "vmax": 10000}), ("fig.colorbar", []))
LOGIM2 = {"$array": [[3 * 1.7 ** (i + 4 * j) for i in range(4)] for j in range(4)]}
case("colorbar_lognorm_extend", ("imshow", [LOGIM2], {"cmap": "plasma", "norm": "log", "interpolation": "nearest"}), ("fig.colorbar", [], {"extend": "both", "label": "rate"}))
# autoscale skips non-positive values (LogNorm.autoscale_None); they draw as the cmap's bad colour
case("colorbar_lognorm_nonpositive", ("imshow", [{"$array": [[0, 2, 40], [-5, 800, 16000]]}], {"cmap": "magma", "norm": "log", "interpolation": "nearest"}), ("fig.colorbar", []))
case("colorbar_lognorm_scatter_horizontal", ("scatter", [lin(16, 0, 15), lin(16, 0, 3)], {"c": [0.02 * 2.1 ** i for i in range(16)], "cmap": "coolwarm", "norm": "log", "s": 40}),
     ("fig.colorbar", [], {"orientation": "horizontal"}))

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

