"""boxplot_stats + Axes.boxplot return shapes / errors from matplotlib itself → fixtures/boxplot_oracle.json.
Run: INTER_DIR=... /workspace/mplstock/bin/python fixtures/generate_boxplot_oracle.py
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt
from matplotlib.cbook import boxplot_stats

R = np.random.default_rng(7)
A = R.normal(0, 1, 80).tolist()
B = (R.normal(2, 0.5, 60) + [20]).tolist()  # one outlier
C = R.normal(-1, 1.2, 50).tolist()
EMPTY = []
NAN = [1.0, 2.0, float("nan"), 4.0]
ALLNAN = [float("nan"), float("nan")]
SAME = [3.0, 3.0, 3.0, 3.0]

def enc(v):
    """JSON-safe: NaN/inf → {"$float": ...}; nested lists recursively."""
    if isinstance(v, float):
        if v != v: return {"$float": "nan"}
        if v == float("inf"): return {"$float": "inf"}
        if v == float("-inf"): return {"$float": "-inf"}
        return v
    if isinstance(v, list):
        return [enc(x) for x in v]
    return v

def f(v):
    a = np.asarray(v, float).ravel()
    return [repr(float(x)) for x in a]

def stats_rec(s):
    return {
        "mean": repr(float(s["mean"])),
        "med": repr(float(s["med"])),
        "q1": repr(float(s["q1"])),
        "q3": repr(float(s["q3"])),
        "iqr": repr(float(s["iqr"])),
        "cilo": repr(float(s["cilo"])),
        "cihi": repr(float(s["cihi"])),
        "whislo": repr(float(s["whislo"])),
        "whishi": repr(float(s["whishi"])),
        "fliers": f(s["fliers"]),
        "label": s.get("label"),
    }

cases = []

def roundtrip(X):
    """Re-load X as the TS harness will see it (JSON numbers)."""
    return json.loads(json.dumps(enc(X)))

def decode_float(a):
    if isinstance(a, dict) and "$float" in a:
        s = a["$float"]
        return float("nan") if s == "nan" else float("inf") if s == "inf" else float("-inf") if s == "-inf" else float(s)
    if isinstance(a, list):
        return [decode_float(x) for x in a]
    return a

def stats_case(name, X, **kw):
    rec = dict(name=name, kind="stats", x=enc(X), kwargs={k: enc(v) for k, v in kw.items()})
    try:
        X2 = decode_float(roundtrip(X))
        kw2 = {k: decode_float(roundtrip(v)) if k == "whis" and isinstance(v, (list, tuple)) else v for k, v in kw.items()}
        out = boxplot_stats(X2, **kw2)
        rec["ok"] = True
        rec["stats"] = [stats_rec(s) for s in out]
    except Exception as e:
        rec["ok"] = False
        rec["error"] = type(e).__name__
        rec["message"] = str(e)
    cases.append(rec)

def api_case(name, args, kwargs=None, setup=()):
    kwargs = kwargs or {}
    fig, ax = plt.subplots()
    for m, a, k in setup:
        getattr(ax, m)(*a, **k)
    rec = dict(name=name, kind="api", setup=[list(s) for s in setup], args=enc(args), kwargs={k: enc(v) for k, v in kwargs.items()})
    try:
        out = ax.boxplot(*args, **kwargs)
        rec["ok"] = True
        rec["counts"] = {k: len(v) for k, v in out.items()}
        rec["xlim"] = [float(x) for x in ax.get_xlim()]
        rec["ylim"] = [float(y) for y in ax.get_ylim()]
        rec["xticks"] = [float(t) for t in ax.get_xticks()]
        rec["yticks"] = [float(t) for t in ax.get_yticks()]
        rec["xticklabels"] = [t.get_text() for t in ax.get_xticklabels()]
        rec["yticklabels"] = [t.get_text() for t in ax.get_yticklabels()]
        # median y (or x if horizontal) of first box
        med = out["medians"][0]
        xd, yd = med.get_xdata(), med.get_ydata()
        rec["median0"] = {"x": f(xd), "y": f(yd)}
        if out["fliers"]:
            rec["fliers0"] = f(out["fliers"][0].get_ydata() if kwargs.get("orientation", "vertical") != "horizontal"
                               and kwargs.get("vert", True) is not False
                               else out["fliers"][0].get_xdata())
        else:
            rec["fliers0"] = []
    except Exception as e:
        rec["ok"] = False
        rec["error"] = type(e).__name__
        rec["message"] = str(e)
    plt.close(fig)
    cases.append(rec)

# --- stats ---
stats_case("stats_basic", A)
stats_case("stats_outlier", B)
stats_case("stats_multi", [A, B, C])
stats_case("stats_empty", EMPTY)
stats_case("stats_empty_list", [EMPTY])
stats_case("stats_nan", NAN)
stats_case("stats_allnan", ALLNAN)
stats_case("stats_whis_pct", B, whis=(5, 95))
stats_case("stats_whis_full", B, whis=(0, 100))
stats_case("stats_whis2", B, whis=2.0)
stats_case("stats_autorange", SAME, autorange=True)
stats_case("stats_no_autorange", SAME, autorange=False)
stats_case("stats_labels", [A, B], labels=["a", "b"])
stats_case("stats_labels_mismatch", [A, B], labels=["a"])
stats_case("stats_scalar", 3.5)
stats_case("stats_single", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 100])

# --- api ---
api_case("bp_basic", [[A, B]])
api_case("bp_notch", [[A]], {"notch": True})
api_case("bp_patch", [[A, B]], {"patch_artist": True})
api_case("bp_means", [[A]], {"showmeans": True})
api_case("bp_meanline", [[A]], {"showmeans": True, "meanline": True})
api_case("bp_horizontal", [[A, B]], {"orientation": "horizontal"})
api_case("bp_vert_false", [[A]], {"vert": False})
api_case("bp_whis_pct", [[B]], {"whis": [5, 95]})
api_case("bp_no_fliers", [[B]], {"showfliers": False})
api_case("bp_no_caps", [[A]], {"showcaps": False})
api_case("bp_no_box", [[A]], {"showbox": False})
api_case("bp_widths", [[A, B]], {"widths": 0.3})
api_case("bp_positions", [[A, B]], {"positions": [10, 20]})
api_case("bp_tick_labels", [[A, B]], {"tick_labels": ["low", "high"]})
api_case("bp_empty", [[[]]])
api_case("bp_nan", [[NAN]])
api_case("bp_props", [[A]], {"boxprops": {"color": "r", "linewidth": 2}, "medianprops": {"color": "b"}})
api_case("bp_manage_false", [[A, B]], {"manage_ticks": False})
api_case("err_labels_len", [[A, B]], {"tick_labels": ["only"]})
api_case("err_whis", [[A]], {"whis": "bad"})
api_case("err_orientation", [[A]], {"orientation": "diag"})
api_case("err_positions_len", [[A, B]], {"positions": [1]})

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "boxplot_oracle.json")
with open(out, "w") as fh:
    json.dump({"matplotlib": matplotlib.__version__, "numpy": np.__version__, "cases": cases}, fh, indent=1)
print(f"wrote {len(cases)} cases to {out}")
