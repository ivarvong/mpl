"""Axes.hist return values and the plotting calls' error messages, from matplotlib itself, for test/plots.test.ts.

Writes fixtures/plots_oracle.json. Each case is one Axes call on a fresh Axes (after optional setup calls)
and either what it returned (hist: n and bins, floats as repr strings) or the exception type and message.
Run with the oracle venv: python generate_plots_oracle.py
"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt

R = np.random.default_rng(7)
A = R.normal(0, 1, 300).tolist(); B = R.gamma(2.0, 1.5, 200).tolist(); W = R.uniform(0.1, 3, 300).tolist()
INTS = R.integers(0, 30, 150).tolist()
def f(v): return [repr(float(x)) for x in np.asarray(v, float).ravel()]

cases = []
def case(name, method, args, kwargs=None, setup=()):
    kwargs = kwargs or {}
    fig, ax = plt.subplots()
    for m, a, k in setup: getattr(ax, m)(*a, **k)
    rec = dict(name=name, setup=[list(s) for s in setup], method=method, args=args, kwargs=kwargs)
    try:
        out = getattr(ax, method)(*args, **kwargs)
        if method == "hist":
            n, bins, patches = out
            multi = isinstance(args[0], list) and len(args[0]) > 0 and isinstance(args[0][0], list)
            rec["n"] = [f(r) for r in n] if multi else f(n)
            rec["bins"] = f(bins)
            rec["patches"] = len(patches)
        rec["ok"] = True
    except Exception as e:
        rec["ok"] = False
        rec["error"] = type(e).__name__
        rec["message"] = str(e)
    plt.close(fig)
    cases.append(rec)

case("hist_default", "hist", [A])
case("hist_ints_auto", "hist", [INTS], {"bins": "auto"})
case("hist_ints_fd_stone", "hist", [INTS], {"bins": "stone"})
case("hist_multi_fd", "hist", [[A, B]], {"bins": "fd"})
case("hist_multi_weights", "hist", [[A, B[:100]]], {"bins": 7, "weights": [W, W[:100]]})
case("hist_density_stacked", "hist", [[A, B]], {"bins": 9, "density": True, "stacked": True})
case("hist_cumulative_reverse_density", "hist", [A], {"bins": 11, "cumulative": -1, "density": True})
case("hist_cumulative_stacked", "hist", [[A, B]], {"bins": 6, "cumulative": True, "histtype": "barstacked"})
case("hist_range", "hist", [B], {"bins": 5, "range": [1, 4]})
case("hist_edges", "hist", [A], {"bins": [-3, -1, 0, 0.5, 3]})
case("hist_empty", "hist", [[]])
case("hist_empty_multi", "hist", [[[], []]])
case("hist_scalar", "hist", [3.5])
case("hist_step_polys", "hist", [[A, B]], {"histtype": "step"})
case("err_hist_histtype", "hist", [A], {"histtype": "bars"})
case("err_hist_align", "hist", [A], {"align": "center"})
case("err_hist_orientation", "hist", [A], {"orientation": "up"})
case("err_hist_estimator", "hist", [A], {"bins": "magic"})
case("err_hist_weighted_estimator", "hist", [A], {"bins": "auto", "weights": W})
case("err_hist_weights_shape", "hist", [A], {"weights": W[:10]})
case("err_hist_colors", "hist", [[A, B]], {"color": ["r", "g", "b"]})
case("err_step_where", "step", [[1, 2], [1, 2]], {"where": "middle"})
case("err_errorbar_negative", "errorbar", [[1, 2, 3], [1, 2, 3]], {"yerr": [0.1, -0.2, 0.3]})
case("err_errorbar_shape", "errorbar", [[1, 2, 3], [1, 2, 3]], {"yerr": [0.1, 0.2]})
case("err_errorbar_xshape", "errorbar", [[1, 2, 3], [1, 2, 3]], {"xerr": [[0.1, 0.2], [0.1, 0.2]]})
case("err_errorbar_sizes", "errorbar", [[1, 2, 3], [1, 2]], {"yerr": 0.1})
case("err_errorbar_every", "errorbar", [[1, 2, 3], [1, 2, 3]], {"yerr": 0.1, "errorevery": "x"})
case("err_errorbar_every_index", "errorbar", [[1, 2, 3], [1, 2, 3]], {"yerr": 0.1, "errorevery": [0, 5]})
case("err_axline_slope_log", "axline", [[1, 1]], {"slope": 2}, setup=[("set_yscale", ["log"], {})])
case("err_axline_slope_logx", "axline", [[1, 1]], {"slope": 2}, setup=[("set_xscale", ["log"], {})])
case("err_axline_both", "axline", [[0, 0], [1, 1]], {"slope": 1})
case("err_axline_neither", "axline", [[0, 0]])
case("err_axhline_transform", "axhline", [0.5], {"transform": None})
case("err_plot_drawstyle", "plot", [[1, 2], [1, 2]], {"drawstyle": "stairs"})
case("axline_log_points", "axline", [[1, 1], [10, 100]], setup=[("set_yscale", ["log"], {}), ("set_xscale", ["log"], {})])

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "plots_oracle.json")
with open(out, "w") as fh:
    json.dump({"matplotlib": matplotlib.__version__, "numpy": np.__version__, "cases": cases}, fh, indent=1)
print(f"wrote {len(cases)} cases to {out}")
