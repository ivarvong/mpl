"""Axes.pie geometry, texts and errors from matplotlib itself -> fixtures/pie_oracle.json (test/pie.test.ts).

Path.arc and Wedge path vertices (bit-exact, as repr strings), pie()'s wedges (centre, r, theta1, theta2, colours,
edge, width), its texts (position, string, alignment, rotation, size, colour) and the axes state it leaves (aspect,
frame, limits, ticks), Python printf-style autopct strings, and the errors pie() raises; pie_label's texts, its
str.format labels (`labels.format(absval=, frac=)` on numpy int64/float64 values) and the errors it raises.
Run with matplotlib 3.11.2 (fixtures/requirements.txt): python fixtures/generate_pie_oracle.py
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt
from matplotlib.path import Path
from matplotlib.patches import Shadow, Wedge
from matplotlib.colors import to_hex, to_rgba

OUT = os.path.join(os.path.dirname(__file__), "pie_oracle.json")
r = lambda v: repr(float(v))

def path_rec(p):
    return {"x": [r(v) for v in p.vertices[:, 0]], "y": [r(v) for v in p.vertices[:, 1]], "codes": [int(c) for c in p.codes]}

ARCS = [[0, 90], [0, 360], [30, 200], [-45, 45], [90, 450], [10, 10.5], [200, 100], [54, 162], [0, 359.9999]]
WEDGES = [
    {"center": [0, 0], "r": 1, "theta1": 0, "theta2": 54},
    {"center": [0.1, -0.2], "r": 0.8, "theta1": 54, "theta2": 162, "width": 0.3},
    {"center": [0, 0], "r": 1, "theta1": 0, "theta2": 360},
    {"center": [0, 0], "r": 1.5, "theta1": 90, "theta2": 450, "width": 0.5},
]

# printf-style autopct: (format, value) -> fmt % value
FMTS = ["%1.1f%%", "%.0f%%", "%d%%", "%1.0f", "%.2f", "%5.1f|", "%-7.2f|", "%+.1f", "% .1f", "%05.1f", "%e", "%.3E", "%g",
        "%.3g", "%#.3g", "%G", "%s", "%r", "%.3s", "%i", "%.3d", "%u", "%F", "%.0e", "%#.0f", "pct=%.1f!", "%%%.1f"]
VALUES = [0.0, 12.5, 37.5, 2.5, 0.125, 33.33333333333333, 66.66666666666667, 100.0, 1e-05, 123456789.0, 0.5, 1.5, 99.95, 7.0, 14.285714285714286]
formats = [{"fmt": f, "value": r(v), "out": f % v} for f in FMTS for v in VALUES]

def text_rec(t):
    x, y = t.get_position()
    return {"x": r(x), "y": r(y), "s": t.get_text(), "ha": t.get_horizontalalignment(), "va": t.get_verticalalignment(),
            "rotation": r(t.get_rotation()), "size": r(t.get_fontsize()), "color": to_hex(t.get_color(), keep_alpha=True),
            "weight": t.get_fontweight(), "clip": t.get_clip_on()}

def pie_case(name, x, **kw):
    fig, ax = plt.subplots()
    pc = ax.pie(x, **kw)
    wedges = []
    for p in ax.patches:
        if isinstance(p, Shadow):
            w = p.patch
            wedges.append({"shadow": True, "of": ax.patches.index(w), "face": [r(v) for v in p.get_facecolor()],
                           "edge": [r(v) for v in p.get_edgecolor()], "lw": r(p.get_linewidth()), "zorder": r(p.get_zorder()),
                           "ox": r(p._ox), "oy": r(p._oy)})
        else:
            wedges.append({"shadow": False, "cx": r(p.center[0]), "cy": r(p.center[1]), "r": r(p.r), "theta1": r(p.theta1), "theta2": r(p.theta2),
                           "width": None if p.width is None else r(p.width), "face": [r(v) for v in p.get_facecolor()],
                           "edge": [r(v) for v in p.get_edgecolor()], "lw": r(p.get_linewidth()), "label": p.get_label(),
                           "zorder": r(p.get_zorder()), "clip": p.get_clip_on()})
    texts = pc.texts
    labelled = kw.get("labeldistance", 1.1) is not None
    rec = {"name": name, "x": x, "kw": kw, "wedges": wedges,
           "texts": [text_rec(t) for t in (texts[0] if labelled and texts else [])],
           "autotexts": [text_rec(t) for t in (texts[-1] if kw.get("autopct") is not None else [])],
           "fracs": [r(v) for v in pc.fracs],
           "aspect": ax.get_aspect(), "frame_on": ax.get_frame_on(), "xlim": [r(v) for v in ax.get_xlim()], "ylim": [r(v) for v in ax.get_ylim()],
           "xticks": [r(v) for v in ax.get_xticks()], "yticks": [r(v) for v in ax.get_yticks()],
           "legend": [h.get_label() for h in ax.get_legend_handles_labels()[0]]}
    plt.close(fig)
    return rec

PIES = [
    pie_case("basic", [15, 30, 45, 10], labels=["Frogs", "Hogs", "Dogs", "Logs"]),
    pie_case("autopct_explode_shadow", [15, 30, 45, 10], labels=["a", "b", "c", "d"], autopct="%1.1f%%", explode=[0, 0.1, 0, 0], shadow=True, startangle=90),
    pie_case("clockwise_rotate", [10, 20, 30, 25, 15], labels=["n", "e", "s", "w", "l"], counterclock=False, rotatelabels=True, startangle=45, labeldistance=1.05),
    pie_case("rotate_inside", [1, 2, 3], labels=["i", "j", "k"], rotatelabels=True, labeldistance=0.5),
    pie_case("partial", [0.2, 0.3, 0.15], normalize=False, autopct="%.0f%%", colors=["C3", "C4", "C5"]),
    pie_case("donut_shadow_dict", [30, 25, 20, 15, 10], wedgeprops={"width": 0.4, "edgecolor": "w", "linewidth": 2},
             shadow={"ox": -0.04, "oy": -0.03, "shade": 0.5}, startangle=30, pctdistance=0.8, autopct="%.0f%%"),
    pie_case("props", [3, 1, 2, 2.5], radius=0.8, center=(0.2, -0.1), labels=["w", "x", "y", "z"], labeldistance=None, autopct="%.2f",
             colors=["0.8", "tab:orange"], textprops={"fontsize": "small", "color": "C3", "fontweight": "bold"}),
    pie_case("wedgeprops_alpha_face", [1, 1, 2], wedgeprops={"alpha": 0.5, "facecolor": "red", "linewidth": 0}, textprops={"size": 14, "c": "b"}, autopct="%d"),
    pie_case("single", [7], labels=["all"], autopct="%1.1f%%"),
    pie_case("zero_slice", [0, 3, 1], labels=["zero", "three", "one"]),
    pie_case("floats_sum", [0.1, 0.2, 0.3, 0.4, 0.05, 0.15, 0.25, 0.35, 0.45], startangle=-30),
    pie_case("underscore_label", [1, 2], labels=["_hidden", "shown"]),
]

def error(name, x, **kw):
    fig, ax = plt.subplots()
    try:
        ax.pie(x, **kw)
        msg = None
    except Exception as e:
        msg = {"type": type(e).__name__, "message": str(e)}
    plt.close(fig)
    enc = [v if np.isfinite(v) else {"$float": repr(v)} for v in x]
    return {"name": name, "x": enc, "kw": kw, "error": msg}

ERRORS = [
    error("negative", [1, -1]), error("all_zero", [0, 0]), error("unnormalized_over", [0.6, 0.6], normalize=False),
    error("labels_len", [1, 2], labels=["a"]), error("explode_len", [1, 2], explode=[0]), error("radius", [1, 2], radius=0),
    error("shade", [1, 2], shadow={"shade": 2}), error("nonfinite", [1, float("inf")]),
]

# pie_label: str.format on the container's numpy values, as `labels.format(absval=val, frac=frac)`
SPECS = ["{absval}", "{frac}", "{absval:d}", "{frac:.0%}", "{frac:.1%}", "{frac:%}", "{absval:.1f}", "{absval:,}", "{absval:,.2f}",
         "{absval:_d}", "{absval:_}", "{absval:>8}|", "{absval:<8}|", "{absval:^9}|", "{absval:*^11.1f}", "{absval:+d}", "{absval:+}",
         "{absval: .2f}", "{absval:08.2f}", "{absval:=+10.1f}", "{absval:0=8}", "{absval:e}", "{absval:.2E}", "{absval:g}",
         "{absval:.3g}", "{absval:#.3g}", "{absval:G}", "{absval:.3}", "{absval:#}", "{absval:x}", "{absval:#X}", "{absval:o}",
         "{absval:#o}", "{absval:b}", "{absval:#b}", "{absval:_b}", "{absval:,x}", "{frac:.3}", "{frac:10.4f}|", "{frac:010.3%}",
         "{absval:010,.1f}", "{absval:08,d}", "{absval:012_.2f}", "{{literal}} {absval}", "{frac:.2%} of {absval}", "{absval:F}",
         "{frac:.0f}", "{absval:.0e}", "{absval:#.0f}", "{absval:%}", "{absval:5}|", "{frac:<+12.3e}|", "{absval:.2d}",
         "{absval:c}", "plain text", "{absval}{frac}", "{absval:n}"]
INTS = [0, 7, 15, 1234, 1234567, -3, 255]
FLOATS = [0.0, 0.35, 12.5, 1234.5678, 1e-05, 123456789.0, 0.125, 2.5, 1 / 3, -0.5, 1e20, 0.999, 0.995]

def strformat(fmt, v):
    try:
        return {"out": fmt.format(absval=v, frac=v)}
    except Exception as e:
        return {"error": {"type": type(e).__name__, "message": str(e)}}

strformats = ([{"fmt": f, "dtype": "int", "value": int(v), **strformat(f, np.int64(v))} for f in SPECS for v in INTS]
              + [{"fmt": f, "dtype": "float", "value": r(v), **strformat(f, np.float64(v))} for f in SPECS for v in FLOATS])

def label_case(name, x, pie_kw, calls):
    fig, ax = plt.subplots()
    pc = ax.pie(x, **pie_kw)
    out = [[text_rec(t) for t in ax.pie_label(pc, labels, **kw)] for labels, kw in calls]
    plt.close(fig)
    return {"name": name, "x": x, "pie": pie_kw, "calls": [{"labels": l, "kw": kw} for l, kw in calls], "texts": out}

PIE_LABELS = [
    label_case("format_inside", [15, 30, 45, 10], {"labels": ["Frogs", "Hogs", "Dogs", "Logs"]},
               [("{absval:d} ({frac:.0%})", {"textprops": {"color": "w", "fontweight": "bold"}})]),
    label_case("list_outer_rotate", [10, 20, 30, 25, 15], {"labeldistance": None, "explode": [0.1, 0, 0, 0, 0], "startangle": 90},
               [(["north", "east", "south", "west", "last"], {"distance": 1.15, "rotate": True, "alignment": "outer"}),
                ("{frac:.1%}", {"distance": 0.7, "textprops": {"fontsize": "small"}})]),
    label_case("auto_both_sides", [1250.5, 3400.25, 980.0], {"labeldistance": None, "wedgeprops": {"width": 0.3}},
               [("{absval:,.1f}", {"distance": 0.85}), (["a", "b", "c"], {"distance": 1.2, "textprops": {"size": 9, "c": "C3"}}),
                (["x", "y", "z"], {"distance": 1.0}), (["p", "q", "r"], {"distance": 0.4, "rotate": True})]),
    label_case("clockwise_center", [3, 1, 2], {"counterclock": False, "startangle": 200, "center": (0.5, -0.25), "radius": 0.7, "labels": ["i", "j", "k"]},
               [("{absval}", {"alignment": "center", "distance": 1.3}), ("{frac:.3}", {"alignment": "outer", "rotate": True, "distance": 0.5})]),
    label_case("partial_unnormalized", [0.2, 0.3, 0.15], {"normalize": False}, [("{frac:.0%} / {absval}", {"textprops": None})]),
    label_case("int_unnormalized", [0, 1], {"normalize": False}, [("{frac} {absval:d}", {})]),
]

def label_error(name, x, labels, **kw):
    fig, ax = plt.subplots()
    pc = ax.pie(x)
    try:
        ax.pie_label(pc, labels, **kw)
        msg = None
    except Exception as e:
        msg = {"type": type(e).__name__, "message": str(e)}
    plt.close(fig)
    return {"name": name, "x": x, "labels": labels, "kw": kw, "error": msg}

LABEL_ERRORS = [
    label_error("count", [1, 2], ["a"]), label_error("alignment", [1, 2], ["a", "b"], alignment="left"),
    label_error("missing_name", [1, 2], "{value}"), label_error("float_d", [1.5, 2], "{absval:d}"),
    label_error("single_close", [1, 2], "a}b"), label_error("single_open", [1, 2], "a{b"), label_error("unclosed", [1, 2], "{absval"),
    label_error("positional", [1, 2], "{}"), label_error("int_precision", [1, 2], "{absval:.2d}"),
]

# pie_label's strings by numpy dtype: JS has no 10.0 literal, so mpl reads a plain array of whole numbers as int64 and a
# Float64Array as float64 (test/pie.test.ts passes x as a Float64Array when dtype is "float64"). Strings only: no trig, so
# any platform's numpy gives the same answer.
def label_strings(x, dtype, labels, **pie_kw):
    fig, ax = plt.subplots()
    pc = ax.pie(np.asarray(x, dtype=dtype), **pie_kw)
    try:
        out = {"out": [t.get_text() for t in ax.pie_label(pc, labels)]}
    except Exception as e:
        out = {"error": {"type": type(e).__name__, "message": str(e)}}
    plt.close(fig)
    return {"x": x, "dtype": dtype, "labels": labels, "pie": pie_kw, **out}

LABEL_STRINGS = [label_strings(x, d, l, **kw) for x, kw in [([10, 20, 30], {}), ([0, 1], {"normalize": False})]
                 for d in ["int64", "float64"] for l in ["{absval}", "{frac}", "{absval:d}", "{absval} ({frac:.0%})"]]

rec = {"matplotlib": matplotlib.__version__, "numpy": np.__version__,
       "arcs": [{"theta1": a, "theta2": b, **path_rec(Path.arc(a, b))} for a, b in ARCS],
       "wedges": [{**w, **path_rec(Wedge(tuple(w["center"]), w["r"], w["theta1"], w["theta2"], width=w.get("width")).get_path())} for w in WEDGES],
       "formats": formats, "pies": PIES, "errors": ERRORS,
       "strformats": strformats, "pie_labels": PIE_LABELS, "label_errors": LABEL_ERRORS, "label_strings": LABEL_STRINGS}
with open(OUT, "w") as f:
    json.dump(rec, f, indent=1)
print(f"wrote {OUT}")
