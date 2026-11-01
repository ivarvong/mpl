"""Generate matplotlib reference fixtures.

Each case is a *spec*: a list of (method, args, kwargs) calls on an Axes,
replayed identically here (matplotlib) and in test/compare.ts (mpljs).
For each case we record autoscaled limits, tick locations/labels, offset
text, legend window extent, plus the reference SVG and PNG (640x480 @ 100 dpi).
"""
import contextlib, json, math, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
matplotlib.rcdefaults()                      # ignore any local matplotlibrc
matplotlib.rcParams["font.family"] = "DejaVu Sans"   # ignore any locally patched matplotlibrc
matplotlib.rcParams["text.hinting"] = "none"         # reproduce oracle PNGs (stock FT 2.14.3, no hinting)
import matplotlib.pyplot as plt

OUT = os.path.join(os.path.dirname(__file__), "ref")
os.makedirs(OUT, exist_ok=True)

def lin(n, a, b): return np.linspace(a, b, n).tolist()
def L(v): return np.asarray(v).tolist()

CASES = {}
def case(name, *calls):
    CASES[name] = [list(c) + [{}] * (3 - len(c)) for c in calls]

x = lin(50, 0, 10)
sx, cx = L(np.sin(x)), L(np.cos(x))

# Figure-level call helpers encoded in the spec with a 'fig.' prefix
def fig_text(x, y, s, **kw): return ("fig.text", [x, y, s], kw)
def fig_suptitle(s, **kw): return ("fig.suptitle", [s], kw)
def fig_subxlabel(s, **kw): return ("fig.supxlabel", [s], kw)
def fig_subylabel(s, **kw): return ("fig.supylabel", [s], kw)
def fig_adjust(**kw): return ("fig.subplots_adjust", [], kw)
# Spine edit encoding: ("spine", [side, action, value])
def spine(side, action, value): return ("spine", [side, action, value])
# ---- slice 1 corpus (plot + title/labels) ------------------------------------
case("sine", ("plot", [x, sx]), ("set_title", ["sin(x)"]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))
case("linear", ("plot", [lin(11, 0, 10), lin(11, 0, 10)]))
case("quadratic", ("plot", [lin(100, -5, 5), L(np.linspace(-5, 5, 100) ** 2)]), ("set_title", ["y = x²"]), ("set_xlabel", ["x"]), ("set_ylabel", ["x²"]))
case("two_lines", ("plot", [x, sx]), ("plot", [x, cx]), ("set_title", ["sin & cos"]))
case("tiny_range", ("plot", [lin(20, 0, 1), lin(20, 0.0001, 0.0003)]), ("set_title", ["tiny y"]))
case("huge_range", ("plot", [lin(20, 0, 1), lin(20, 0, 1e7)]), ("set_title", ["huge y"]))
case("huge_offset", ("plot", [lin(20, 0, 1), lin(20, 1e6, 1e6 + 10)]), ("set_title", ["offset y"]))
case("negative", ("plot", [lin(20, -100, -50), lin(20, -3, -1)]))
case("single_point", ("plot", [[3.0], [7.0]]), ("set_title", ["one point"]))
case("constant_y", ("plot", [lin(10, 0, 9), [5.0] * 10]), ("set_title", ["constant"]))
case("constant_zero", ("plot", [lin(10, 0, 9), [0.0] * 10]))
case("exp_growth", ("plot", [lin(30, 0, 29), L(np.exp(np.linspace(0, 29, 30) / 5))]), ("set_title", ["exp"]))
case("decay", ("plot", [lin(60, 0, 6), L(np.exp(-np.linspace(0, 6, 60)) * np.cos(np.linspace(0, 60, 60)))]), ("set_title", ["damped"]))
case("microseconds", ("plot", [lin(15, 0, 1e-6), lin(15, 0, 1)]), ("set_title", ["µs scale"]))
case("years", ("plot", [lin(21, 2000, 2020), [2.1, 2.3, 2.2, 2.6, 2.9, 3.1, 3.0, 3.4, 3.3, 3.8, 3.9, 4.1, 4.0, 4.4, 4.6, 4.5, 4.9, 5.0, 5.2, 5.1, 5.5]]), ("set_title", ["years as x"]), ("set_xlabel", ["year"]), ("set_ylabel", ["value"]))
case("step_like", ("plot", [[0, 1, 1, 2, 2, 3, 3, 4], [0, 0, 1, 1, 0, 0, 1, 1]]))
case("many_points", ("plot", [lin(1000, 0, 4 * math.pi), L(np.sin(np.linspace(0, 4 * math.pi, 1000)) + 0.3 * np.sin(np.linspace(0, 4 * math.pi, 1000) * 7))]), ("set_title", ["1000 pts"]))
case("long_title", ("plot", [x, sx]), ("set_title", ["A reasonably long title describing the plot in some detail"]), ("set_xlabel", ["the x axis label"]), ("set_ylabel", ["the y axis label"]))
case("ten_lines", *[("plot", [x, L(np.sin(x) + i * 0.5)]) for i in range(10)], ("set_title", ["color cycle"]))
case("offset_neg", ("plot", [lin(20, 0, 1), lin(20, -1e6 - 10, -1e6)]), ("set_title", ["neg offset"]))

# ---- slice 2: line styling -----------------------------------------------------
x8 = lin(8, 0, 7)
y8 = [1, 3, 2, 5, 4, 6, 5, 7]
case("fmt_markers", ("plot", [x8, y8, "o-"]), ("plot", [x8, [v + 1 for v in y8], "s--"]), ("plot", [x8, [v + 2 for v in y8], "^:"]), ("plot", [x8, [v + 3 for v in y8], "x-."]), ("plot", [x8, [v + 4 for v in y8], "D"]))
case("fmt_colors", ("plot", [x8, y8, "r--"]), ("plot", [x8, [v + 1 for v in y8], "g-"]), ("plot", [x8, [v + 2 for v in y8], "k:"]), ("plot", [x8, [v + 3 for v in y8], "c-."]))
case("kw_styles", ("plot", [x, sx], {"linestyle": "--", "linewidth": 3, "color": "red"}), ("plot", [x, cx], {"color": "#ff00ff", "linewidth": 0.5}), ("plot", [x, L(np.sin(x) * 0.5)], {"color": "C2", "marker": "o", "markersize": 4}), ("plot", [x, L(np.cos(x) * 0.5)], {"color": "0.5", "linestyle": ":"}))
case("markers_only", ("plot", [x8, y8, "o"]), ("plot", [x8, [v + 1 for v in y8], "s"]), ("plot", [x8, [v + 2 for v in y8], "^"]), ("plot", [x8, [v + 3 for v in y8], "v"]), ("plot", [x8, [v + 4 for v in y8], "D"]), ("plot", [x8, [v + 5 for v in y8], "x"]), ("plot", [x8, [v + 6 for v in y8], "+"]), ("plot", [x8, [v + 7 for v in y8], "*"]), ("plot", [x8, [v + 8 for v in y8], "."]))
case("y_only", ("plot", [[3, 1, 4, 1, 5, 9, 2, 6]]))
case("named_colors", ("plot", [x8, y8], {"color": "steelblue"}), ("plot", [x8, [v + 1 for v in y8]], {"color": "tab:orange"}), ("plot", [x8, [v + 2 for v in y8]], {"color": "darkgreen", "linestyle": "-."}))
case("set_limits", ("plot", [x, sx]), ("set_xlim", [-1, 12]), ("set_ylim", [-2, 2]), ("set_title", ["explicit limits"]))
case("set_ticks", ("plot", [x, sx]), ("set_xticks", [[0, 2.5, 5, 7.5, 10]]), ("set_yticks", [[-1, 0, 1]]), ("set_xticklabels", [["zero", "2.5", "five", "7.5", "ten"]]))
case("ticks_dense", ("plot", [x, sx]), ("set_xticks", [L(np.arange(0, 10.5, 0.5))]))

# ---- slice 2: legend -------------------------------------------------------------
case("legend_best_tl", ("plot", [x, L(np.exp(-np.asarray(x)))], {"label": "decay"}), ("plot", [x, L(1 - np.exp(-np.asarray(x)))], {"label": "growth"}), ("legend", []))
case("legend_best_br", ("plot", [x, L(np.exp(np.asarray(x) / 4))], {"label": "exp"}), ("plot", [x, L(np.asarray(x) ** 1.5)], {"label": "power"}), ("legend", []))
case("legend_best_sine", ("plot", [x, sx], {"label": "sin(x)"}), ("plot", [x, cx], {"label": "cos(x)"}), ("legend", []), ("set_title", ["trig"]))
case("legend_upper_left", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("legend", [], {"loc": "upper left"}))
case("legend_lower_right", ("plot", [x, sx], {"label": "sin"}), ("legend", [], {"loc": "lower right"}))
case("legend_center", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("legend", [], {"loc": "center"}))
case("legend_upper_center", ("plot", [x, sx, "o-"], {"label": "with markers"}), ("plot", [x, cx, "s--"], {"label": "dashed squares"}), ("legend", [], {"loc": "upper center"}))
case("legend_long_labels", ("plot", [x, sx], {"label": "a rather long legend entry label"}), ("plot", [x, cx], {"label": "short"}), ("plot", [x, L(np.sin(x) * 0.5)], {"label": "medium length"}), ("legend", []))
case("legend_ncols", *[("plot", [x, L(np.sin(x) + i * 0.3)], {"label": f"series {i}"}) for i in range(6)], ("legend", [], {"ncols": 2}))
case("legend_noframe", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("legend", [], {"frameon": False}))
case("legend_markers_only", ("plot", [x8, y8, "o"], {"label": "circles"}), ("plot", [x8, [v + 2 for v in y8], "^"], {"label": "triangles"}), ("plot", [x8, [v + 4 for v in y8], "x"], {"label": "crosses"}), ("legend", []))
case("legend_partial_labels", ("plot", [x, sx], {"label": "labelled"}), ("plot", [x, cx]), ("legend", []))

# ---- slice 2: grid -------------------------------------------------------------------
case("grid", ("plot", [x, sx]), ("grid", [True]))
case("grid_legend_title", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("grid", [True]), ("legend", []), ("set_title", ["full chart"]), ("set_xlabel", ["time (s)"]), ("set_ylabel", ["amplitude"]))
case("grid_y_only", ("plot", [x, sx]), ("grid", [True], {"axis": "y"}))

# ---- slice 2: bars ---------------------------------------------------------------------
cats = ["apples", "bananas", "cherries", "dates"]
vals = [23, 17, 35, 29]
case("bar_numeric", ("bar", [[1, 2, 3, 4, 5], [5, 3, 8, 2, 6]]))
case("bar_categorical", ("bar", [cats, vals]), ("set_title", ["fruit"]), ("set_ylabel", ["count"]))
case("bar_width_color", ("bar", [[1, 2, 3, 4], vals], {"width": 0.5, "color": "green"}))
case("bar_edgecolor", ("bar", [cats, vals], {"edgecolor": "black"}))
case("barh_categorical", ("barh", [cats, vals]), ("set_xlabel", ["count"]))
case("barh_numeric", ("barh", [[1, 2, 3, 4, 5], [5, 3, 8, 2, 6]], {"height": 0.6}))
case("bar_negative", ("bar", [[1, 2, 3, 4, 5, 6], [3, -2, 5, -4, 1, -1]]), ("set_title", ["signed"]))
xs4 = [0, 1, 2, 3]
case("bar_grouped", ("bar", [[v - 0.2 for v in xs4], [20, 34, 30, 35]], {"width": 0.4, "label": "2024"}), ("bar", [[v + 0.2 for v in xs4], [25, 32, 34, 20]], {"width": 0.4, "label": "2025"}), ("set_xticks", [xs4]), ("set_xticklabels", [["Q1", "Q2", "Q3", "Q4"]]), ("legend", []), ("set_ylabel", ["revenue"]))
case("bar_stacked", ("bar", [cats, [10, 12, 8, 15]], {"label": "a"}), ("bar", [cats, [5, 7, 9, 4]], {"bottom": [10, 12, 8, 15], "label": "b"}), ("legend", []))
case("bar_many", ("bar", [L(np.arange(20)), L(np.abs(np.sin(np.arange(20) / 3)) * 10 + 1)]))
case("bar_long_cats", ("bar", [["north america", "south america", "europe", "asia", "africa"], [12, 7, 15, 30, 9]]))
case("bar_line_overlay", ("bar", [[1, 2, 3, 4, 5], [5, 3, 8, 2, 6]], {"label": "count"}), ("plot", [[1, 2, 3, 4, 5], [4, 4.5, 5, 4.8, 5.2], "o-"], {"color": "C3", "label": "trend"}), ("grid", [True]), ("legend", []))
case("bar_legend_best", ("bar", [cats, vals], {"label": "fruit"}), ("legend", []))
case("bar_small_values", ("bar", [cats, [0.001, 0.0025, 0.0015, 0.003]]))
case("bar_large_values", ("bar", [cats, [1.2e6, 3.4e6, 2.1e6, 4.8e6]]))

# ---- slice 2: themes (matplotlib style sheets) -------------------------------------------
STYLES = {}
RCS = {}
def with_rc(rc, name, *calls):
    case(name, *calls); RCS[name] = rc
def styled(style, name, *calls):
    case(name, *calls); STYLES[name] = style
for st in ["ggplot", "fivethirtyeight", "dark_background", "bmh", "seaborn-v0_8-darkgrid", "grayscale", "Solarize_Light2", "seaborn-v0_8-whitegrid", "tableau-colorblind10"]:
    tag = st.replace("-", "_").replace(".", "_").lower()
    styled(st, f"style_{tag}_lines", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("plot", [x, L(np.sin(x) * 0.5)], {"label": "half"}), ("legend", []), ("set_title", [st]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))
    styled(st, f"style_{tag}_bars", ("bar", [cats, vals], {"label": "fruit"}), ("plot", [cats, [20, 25, 30, 35], "o--"], {"label": "trend"}), ("legend", []), ("set_title", [st]))

# ---- slice 3: log scales -----------------------------------------------------------
xe = lin(60, 0, 10)
case("log_y_exp", ("plot", [xe, L(np.exp(np.asarray(xe)))]), ("set_yscale", ["log"]), ("set_title", ["exp on log y"]))
case("log_y_wide", ("plot", [lin(40, 0, 1), L(np.logspace(-3, 12, 40))]), ("set_yscale", ["log"]))
case("log_y_narrow", ("plot", [lin(20, 0, 1), lin(20, 2, 30)]), ("set_yscale", ["log"]), ("set_title", ["1.2 decades"]))
case("log_y_sub_decade", ("plot", [lin(20, 0, 1), lin(20, 2, 5)]), ("set_yscale", ["log"]))
case("log_y_tiny", ("plot", [lin(20, 0, 1), L(np.logspace(-9, -6, 20))]), ("set_yscale", ["log"]))
case("log_x", ("plot", [L(np.logspace(-2, 3, 50)), L(np.log10(np.logspace(-2, 3, 50)))]), ("set_xscale", ["log"]), ("set_xlabel", ["frequency"]))
case("loglog", ("plot", [L(np.logspace(0, 4, 30)), L(3 * np.logspace(0, 4, 30) ** -1.5)], {"label": "power law"}),
     ("plot", [L(np.logspace(0, 4, 30)), L(np.logspace(0, 4, 30) ** -0.5), "o--"], {"label": "shallow"}),
     ("set_xscale", ["log"]), ("set_yscale", ["log"]), ("legend", []), ("grid", [True]), ("set_title", ["log-log"]))
case("log_bar", ("bar", [cats, [3, 40, 700, 12000]]), ("set_yscale", ["log"]), ("set_ylabel", ["count (log)"]))
case("log_y_with_zeros", ("plot", [lin(10, 0, 9), [0, 1, 10, 100, 0, 1000, 10, 1, 0.1, 5], "o-"]), ("set_yscale", ["log"]))

# ---- slice 3: dates -----------------------------------------------------------------
def dates(start, n, step):
    base = np.datetime64(start)
    return {"$dates": [str(base + i * np.timedelta64(*step)) for i in range(n)]}
walk = L(np.cumsum(np.sin(np.arange(400) * 0.37) + 0.2))
case("dates_days", ("plot", [dates("2024-01-01", 30, (1, "D")), walk[:30]]), ("set_title", ["30 days"]))
case("dates_weeks", ("plot", [dates("2024-01-01", 100, (1, "D")), walk[:100]]))
case("dates_months", ("plot", [dates("2023-01-01", 24, (31, "D")), walk[:24]]), ("set_title", ["two years"]))
case("dates_years", ("plot", [dates("1995-01-01", 30, (365, "D")), walk[:30]]), ("set_ylabel", ["index"]))
case("dates_decades", ("plot", [dates("1900-01-01", 120, (365, "D")), walk[:120]]))
case("dates_hours", ("plot", [dates("2024-03-10T00:00", 48, (1, "h")), walk[:48]]), ("set_title", ["48 hours"]))
case("dates_minutes", ("plot", [dates("2024-03-10T09:00", 90, (1, "m")), walk[:90]]))
case("dates_seconds", ("plot", [dates("2024-03-10T09:00:00", 120, (1, "s")), walk[:120]]))
case("dates_bar", ("bar", [dates("2024-01-01", 12, (1, "D")), walk[:12]]), ("set_title", ["daily bars"]))
case("dates_legend", ("plot", [dates("2024-01-01", 60, (1, "D")), walk[:60]], {"label": "a"}),
     ("plot", [dates("2024-01-01", 60, (1, "D")), walk[60:120]], {"label": "b"}), ("legend", []), ("grid", [True]))

# ---- slice 3: twinx ------------------------------------------------------------------
months = lin(12, 1, 12)
temp = [-3, -1, 4, 10, 16, 21, 24, 23, 18, 11, 5, -1]
rain = [80, 65, 70, 75, 90, 95, 100, 92, 85, 90, 95, 88]
case("twinx_basic", ("plot", [months, temp], {"color": "C0"}), ("set_ylabel", ["temperature (°C)"]), ("set_xlabel", ["month"]),
     ("twinx", []), ("plot", [months, rain], {"color": "C1"}), ("set_ylabel", ["rain (mm)"]), ("set_title", ["climate"]))
case("twinx_bar_line", ("bar", [months, rain], {"color": "C0", "label": "rain"}), ("set_ylabel", ["rain (mm)"]),
     ("twinx", []), ("plot", [months, temp, "o-"], {"color": "C3", "label": "temp"}), ("set_ylabel", ["temp"]), ("legend", [], {"loc": "upper left"}))
case("twinx_log", ("plot", [lin(30, 0, 10), lin(30, 0, 5)], {"color": "C2"}),
     ("twinx", []), ("plot", [lin(30, 0, 10), L(np.exp(np.linspace(0, 10, 30)))], {"color": "C4"}), ("set_yscale", ["log"]))
case("twinx_offset", ("plot", [lin(20, 0, 1), lin(20, 0, 1)]), ("twinx", []), ("plot", [lin(20, 0, 1), lin(20, 1e6, 1e6 + 5)], {"color": "C1"}))

# ---- fill_between, text, title location ----------------------------------------------------
AX = {"$transform": "axes"}
case("fill_basic", ("fill_between", [x, sx]))
case("fill_band", ("plot", [x, sx], {"label": "signal"}), ("fill_between", [x, L(np.sin(x) - 0.3), L(np.sin(x) + 0.3)], {"alpha": 0.3, "label": "band"}),
     ("legend", [], {"loc": "upper right"}))
case("fill_two", ("fill_between", [x, L(np.abs(np.sin(x)) * 2)], {"color": "C1", "alpha": 0.5, "label": "a"}),
     ("fill_between", [x, L(np.abs(np.cos(x)))], {"alpha": 0.6, "label": "b"}), ("legend", [], {"loc": "upper left"}))
case("text_coords", ("plot", [x, sx]), ("text", [5.0, 0.5, "peak-ish"], {"ha": "center", "va": "bottom"}),
     ("text", [0.02, 0.95, "axes corner"], {"transform": AX, "va": "top", "fontsize": 12, "color": "C3"}),
     ("text", [9.5, -0.9, "right edge"], {"ha": "right"}), ("set_title", ["left title"], {"loc": "left"}))
case("title_right", ("plot", [x, cx]), ("set_title", ["right title"], {"loc": "right"}), ("text", [0.5, 0.5, "middle"], {"transform": AX, "ha": "center", "va": "center"}))

# ---- fonts: Inter (CFF/cubic outlines, GPOS kerning, calt), weights, high dpi ------------------------
INTER = {"font.family": "Inter"}
# edgeless and even-width-edged markers: the snap grid offset follows the edge width
case("markers_mew0", ("plot", [lin(9, 0, 8), lin(9, 1, 5)], {"marker": "s", "markersize": 9, "markeredgewidth": 0, "linestyle": "none"}),
     ("plot", [lin(9, 0, 8), lin(9, 2, 6)], {"marker": "^", "markersize": 9, "markeredgewidth": 0}),
     ("plot", [lin(9, 0, 8), lin(9, 3, 7)], {"marker": "o", "markersize": 5, "markeredgewidth": 0}),
     ("plot", [lin(9, 0, 8), lin(9, 4, 8)], {"marker": "D", "markersize": 9, "markeredgewidth": 1.44}))
with_rc({"figure.dpi": 300, "figure.figsize": [3.5, 2.5]}, "markers_mew0_hidpi",
     ("plot", [lin(9, 0, 8), lin(9, 1, 5)], {"marker": "s", "markersize": 3, "markeredgewidth": 0, "label": "a"}),
     ("plot", [lin(9, 0, 8), lin(9, 2, 6)], {"marker": "^", "markersize": 3, "markeredgewidth": 0, "label": "b"}), ("legend", []))
# axisbelow=False: the axis (2.5) ties the spines (2.5); matplotlib draws spines first
with_rc({"axes.grid": True, "axes.axisbelow": False, "grid.color": "red", "grid.linewidth": 3, "axes.linewidth": 3},
        "axisbelow_false_tie", ("plot", [x, sx]), ("set_ylim", [-1, 1]), ("set_xlim", [0, 10]))
# log tick labels (mathtext) across dpi, label size and text font
LOGXY = (("plot", [[100, 1000, 1e4, 1e5, 1e6], [0.2, 0.9, 3, 9, 40]], {"marker": "o"}), ("set_xscale", ["log"]), ("set_yscale", ["log"]))
with_rc({"figure.dpi": 240, "figure.figsize": [4, 3]}, "log_dpi240", *LOGXY)
with_rc({"figure.dpi": 240, "figure.figsize": [4, 3], "xtick.labelsize": 8.5, "ytick.labelsize": 8.5}, "log_dpi240_8p5", *LOGXY)
with_rc({"figure.dpi": 240, "figure.figsize": [4, 3], "xtick.labelsize": 8.5, "ytick.labelsize": 8.5, "font.family": "Inter"}, "log_dpi240_inter", *LOGXY)
with_rc({"font.family": "Inter"}, "log_inter", *LOGXY)
# bar colour lists cycle over the bars; alpha replaces face and edge alpha
case("bar_color_list", ("bar", [lin(7, 0, 6), [3, 5, 2, 6, 4, 1, 5]], {"color": ["C7", "C0", "C0", "C3", "C0", "#123456", "tab:green"]}))
case("bar_color_cycle_alpha", ("bar", [lin(6, 0, 5), [2, 4, 3, 5, 1, 2]], {"color": ["C1", "C2"], "alpha": 0.5, "edgecolor": "k", "linewidth": 2}),
     ("barh", [lin(3, 1, 3), [1, 2, 1.5]], {"color": "C4", "alpha": 0.3}))
# Line2D alpha replaces the line, marker face and marker edge alpha
case("plot_alpha", ("plot", [x, sx], {"alpha": 0.4, "linewidth": 4}),
     ("plot", [x, cx], {"marker": "o", "alpha": 0.6, "markeredgecolor": "k", "color": "#ff000080"}))
# rectilinear fill_between paths snap (PathSnapper SNAP_AUTO), offset by the collection linewidth
case("fill_rect_snap", ("fill_between", [lin(9, 0.3, 7.7), -1.13, [-0.61] * 9], {"facecolor": "C3", "alpha": 0.5}),
     ("fill_between", [lin(9, 0.3, 7.7), 0.17, 0.83], {"color": "C0", "alpha": 0.4}),
     ("fill_between", [lin(9, 0.3, 7.7), 1.07, 1.61], {"facecolor": "C2", "linewidth": 0}),
     ("plot", [x, sx]))
with_rc({"figure.dpi": 150}, "fill_rect_snap_150", ("fill_between", [lin(9, 0.3, 7.7), -1.13, [-0.61] * 9], {"facecolor": "C3"}),
     ("fill_between", [lin(9, 0.3, 7.7), 0.17, 0.83], {"color": "C0", "alpha": 0.4}))
# legend rows: TextArea floors the height above the baseline at the "lp" metrics (labels with descenders)
with_rc({"figure.dpi": 150}, "legend_lp_floor", ("plot", [x, sx], {"label": "done"}), ("plot", [x, cx], {"label": "review"}),
     ("plot", [x, [v * 0.5 for v in sx]], {"label": "open"}), ("plot", [x, [v * 0.3 for v in cx]], {"label": "gpq"}), ("legend", [], {"loc": "lower right", "fontsize": 8}))
# rc marker colours: a surface-coloured ring around markers
with_rc({"lines.markeredgecolor": "white", "lines.markeredgewidth": 2, "lines.markersize": 9}, "rc_marker_ring",
     ("plot", [lin(8, 0, 7), lin(8, 1, 3)], {"marker": "o"}), ("plot", [lin(8, 0, 7), lin(8, 3, 1)], {"marker": "s", "markeredgecolor": "C3"}))
with_rc({"lines.markerfacecolor": "white"}, "rc_marker_face", ("plot", [lin(8, 0, 7), lin(8, 1, 3)], {"marker": "o", "markersize": 10}))
# patch.force_edgecolor gives fills an edge colour; at linewidth 0 it still selects draw_markers (+0.5)
FORCE = {"patch.force_edgecolor": True, "patch.edgecolor": "white", "patch.linewidth": 1.5}
with_rc(FORCE, "fill_force_edge_lw0", ("fill_between", [x, sx, 0], {"facecolor": "C0", "alpha": 0.15, "linewidth": 0}), ("plot", [x, sx]))
with_rc(FORCE, "fill_force_edge", ("fill_between", [x, sx, 0], {"facecolor": "C1", "label": "band"}), ("fill_between", [x, cx, -1], {"facecolor": "C2", "alpha": 0.4}), ("legend", []))
# grid(visible, axis=...) changes only that axis; the other keeps the rc state
with_rc({"axes.grid": True}, "grid_axis_keeps_other", ("plot", [x, sx]), ("grid", [True], {"axis": "y"}))
with_rc({"axes.grid": True}, "grid_axis_off_one", ("plot", [x, sx]), ("grid", [False], {"axis": "x"}))
with_rc(INTER, "inter_line", ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}), ("legend", []),
        ("set_title", ["Latency held through the evening peak"]), ("set_xlabel", ["time (h)"]), ("set_ylabel", ["TTFB (ms)"]))
with_rc({**INTER, "axes.titleweight": "semibold"}, "inter_weights", ("plot", [x, sx]), ("set_title", ["Semibold title"]),
        ("text", [0.03, 0.9, "Regular 400"], {"transform": AX}), ("text", [0.03, 0.8, "Medium 500"], {"transform": AX, "fontweight": "medium"}),
        ("text", [0.03, 0.7, "SemiBold 600"], {"transform": AX, "fontweight": "semibold"}), ("text", [0.03, 0.6, "Bold 700"], {"transform": AX, "fontweight": "bold", "fontsize": 14}))
with_rc(INTER, "inter_calt", ("plot", [x, sx]), ("text", [0.5, 0.5, "16:50 · 1x2 · (A) · A-B → C"], {"transform": AX, "ha": "center", "fontsize": 16}),
        ("set_title", ["office “quotes” — 10:30"], {"loc": "left"}))
with_rc({**INTER, "figure.dpi": 240}, "inter_hidpi", ("plot", [x, sx], {"label": "sin"}), ("fill_between", [x, L(np.sin(x) - 0.2), L(np.sin(x) + 0.2)], {"alpha": 0.25}),
        ("legend", []), ("set_title", ["Retina: 240 dpi"], {"fontweight": "semibold"}), ("set_xlabel", ["x"]))
case("dejavu_bold", ("plot", [x, sx]), ("set_title", ["Bold DejaVu title"], {"fontweight": "bold"}), ("text", [5, 0, "bold text"], {"fontweight": "bold", "ha": "center"}))

# ---- showcase: dates x, linear left, log twin right, bars, legend, grid, theme ---------------
days90 = dates("2024-01-01", 90, (1, "D"))
signups = L(np.round(200 + 80 * np.sin(np.arange(90) / 9) + np.arange(90) * 3))
revenue = L(np.exp(np.linspace(7, 11.5, 90)) * (1 + 0.15 * np.sin(np.arange(90) / 4)))
styled("seaborn-v0_8-whitegrid", "showcase",
       ("bar", [days90, signups], {"color": "C0", "label": "daily signups", "width": 0.8}), ("set_ylabel", ["signups / day"]),
       ("legend", [], {"loc": "upper left"}), ("set_title", ["Q1 2024: signups vs revenue"]),
       ("twinx", []), ("plot", [days90, revenue], {"color": "C3", "linewidth": 2, "label": "revenue (log)"}),
       ("set_yscale", ["log"]), ("set_ylabel", ["revenue ($)"]), ("legend", [], {"loc": "lower right"}))

# ---- parity additions: APIs to audit -------------------------------------------------------
case("fig_text_and_suplabels",
     ("plot", [x, sx]),
     fig_text(0.02, 0.02, "fig corner", color="C2", fontsize=10),
     fig_suptitle("A super title"),
     fig_subxlabel("overall x"),
     fig_subylabel("overall y"))
case("spines_edit",
     ("plot", [x, sx]),
     spine("right", "set_visible", False),
     spine("left", "set_color", "C3"),
     spine("bottom", "set_linewidth", 2.0),
     spine("top", "set_position", ["outward", 6]))
case("tick_params_edit",
     ("plot", [x, sx]),
     ("tick_params", [], {"length": 9, "width": 2, "colors": "C2", "labelsize": 12, "direction": "in"}))
case("scatter_sizes",
     ("scatter", [lin(5, 0, 4), [1, 2, 3, 2, 1]], {"s": [9, 36, 81, 144, 225], "marker": "s", "edgecolors": "k", "linewidths": 1}))
case("spans_both",
     ("plot", [x, sx]),
     ("axvspan", [2, 7], {"ymin": 0.1, "ymax": 0.7, "color": "C1", "alpha": 0.3}),
     ("axhspan", [-0.5, 0.5], {"xmin": 0.2, "xmax": 0.9, "color": "C2", "alpha": 0.3}))
case("annotate_arrow",
     ("plot", [x, sx]),
     ("annotate", ["peak", [5.0, 0.5]], {"xytext": [7.0, 0.75], "arrowprops": {"color": "C3", "linewidth": 2, "headlength": 8, "headwidth": 6}}))
case("clip_off_text",
     ("plot", [x, sx]),
     ("text", [-0.1, 1.05, "outside"], {"transform": AX, "clip_on": False}))
case("multi_line_texts",
     ("plot", [x, sx]),
     ("set_title", ["A title\\nwith two lines"]),
     ("set_xlabel", ["x\\nunits"]),
     ("set_ylabel", ["y\\nunits"]),
     ("text", [0.5, 0.5, "a\\nb\\nc"], {"transform": AX, "ha": "center", "va": "center"}),
     ("set_xticks", [[0, 5, 10]]), ("set_xticklabels", [["zero\\nfive", "five", "ten\\ndec"]]))
case("subplots_adjust_margins",
     ("plot", [x, sx]),
     fig_adjust(left=0.2, right=0.95, bottom=0.2, top=0.85))
with_rc({"svg.fonttype": "path"}, "svg_fonttype_path", ("plot", [x, sx]), ("set_title", ["svg path text"]))

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

def decode(a):
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    return a

for name, calls in CASES.items():
  style = STYLES.get(name)
  with matplotlib.rc_context(), (plt.style.context(style) if style else contextlib.nullcontext()):
    matplotlib.rcParams["font.family"] = "DejaVu Sans"
    matplotlib.rcParams.update(RCS.get(name, {}))
    fig, ax = plt.subplots()
    axes = [ax]
    for fn, args, kwargs in calls:
        args = [decode(a) for a in args]
        if fn.startswith("fig."):
            # Figure-level calls encoded as 'fig.method'
            getattr(fig, fn[4:])(*args, **kwargs); continue
        if fn == "twinx":
            ax = ax.twinx(); axes.append(ax); continue
        if fn == "sca":
            ax = axes[args[0]]; continue
        if fn == "spine":
            side, action, val = args
            getattr(ax.spines[side], action)(val); continue
        kwargs = {k: (ax.transAxes if isinstance(v, dict) and v.get("$transform") == "axes" else v) for k, v in kwargs.items()}
        getattr(ax, fn)(*args, **kwargs)
    fig.canvas.draw()
    recs = [record(a, fig) for a in axes]
    rec = dict(spec=calls, style=style, rc=RCS.get(name, {}), **recs[0], axes=recs)
    fig.savefig(os.path.join(OUT, f"{name}.svg"))
    fig.savefig(os.path.join(OUT, f"{name}.png"))
    with open(os.path.join(OUT, f"{name}.json"), "w") as f:
        json.dump(rec, f, indent=1)
    plt.close(fig)

with open(os.path.join(OUT, "_index.json"), "w") as f:
    json.dump(sorted(CASES), f)
print(f"wrote {len(CASES)} cases to {OUT}; matplotlib {matplotlib.__version__}")
