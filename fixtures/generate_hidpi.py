"""Oracle fixtures for matplotlib savefig(dpi=…) overrides.

Figure dpi stays at the default (100); PNGs are written with savefig(dpi=D)
and the fixture JSON records png_dpi=D so test/compare.ts can call
toPNGSync({ dpi: D }) / toRGBA({ dpi: D }). Pixel-exact vs Agg.
"""
import contextlib, json, math, os, sys
from fixture_guard import check_no_literal_newlines
import numpy as np
import matplotlib
matplotlib.use("Agg")
matplotlib.rcdefaults()
matplotlib.rcParams["font.family"] = "DejaVu Sans"
matplotlib.rcParams["text.hinting"] = "none"
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ft2font as ft
from matplotlib import font_manager as fm

ROOT = os.path.dirname(__file__)
OUT = os.path.join(ROOT, "ref")
INDEX = os.path.join(OUT, "_index.json")
STYLE_DIR = os.path.join(ROOT, "..", "styles")
INTER_DIR = os.environ.get("INTER_DIR", "/usr/share/fonts/opentype/inter")
os.makedirs(OUT, exist_ok=True)

def L(v): return np.asarray(v).tolist()
def lin(n, a, b): return np.linspace(a, b, n).tolist()

def decode(a):
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    if isinstance(a, dict) and "$array" in a:
        return np.asarray(a["$array"], dtype=float)
    if isinstance(a, dict) and "$uint8rgb" in a:
        return np.asarray(a["$uint8rgb"], dtype=np.uint8)
    if isinstance(a, list):
        return [decode(v) for v in a]
    return a

def dates(start, n, step):
    base = np.datetime64(start)
    return {"$dates": [str(base + i * np.timedelta64(*step)) for i in range(n)]}

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

def use_static_inter():
    fm.fontManager.ttflist = [f for f in fm.fontManager.ttflist if f.name != "Inter" or os.path.dirname(os.path.realpath(f.fname)) == os.path.realpath(INTER_DIR)]
    for w in ("Regular", "Medium", "SemiBold", "Bold"):
        path = os.path.join(INTER_DIR, f"Inter-{w}.otf")
        if not any(os.path.realpath(f.fname) == os.path.realpath(path) for f in fm.fontManager.ttflist):
            fm.fontManager.addfont(path)
    got = fm.findfont(fm.FontProperties(family="Inter"), fallback_to_default=False)
    if os.path.realpath(got) != os.path.realpath(os.path.join(INTER_DIR, "Inter-Regular.otf")):
        raise RuntimeError(f"Inter resolves to {got}, not the static Inter v4.0 OTFs in INTER_DIR")

x = lin(50, 0, 10)
sx, cx = L(np.sin(x)), L(np.cos(x))
cats = ["apples", "bananas", "cherries", "dates"]
vals = [23, 17, 35, 29]
IM = {"$array": [[0, 1, 2], [3, 4, 5], [6, 7, 8]]}
rng = np.random.default_rng(0)
walk = L(np.cumsum(rng.normal(0, 1, 200)))
DASH = json.load(open(os.path.join(ROOT, "..", "examples", "themes", "data.json")))
TICKS, TICKL = [0, 6, 12, 18, 24], ["00:00", "06:00", "12:00", "18:00", "24:00"]

# (basename, style|None, rc, calls) — figure dpi stays default; savefig dpi applied per run
BASES = []

def base(name, *calls, style=None, rc=None):
    BASES.append((name, style, rc or {}, [list(c) + [{}] * (3 - len(c)) for c in calls]))

base("hidpi_sine",
     ("plot", [x, sx]), ("set_title", ["sin(x)"]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]))

base("hidpi_bar",
     ("bar", [cats, vals]), ("set_title", ["fruit"]), ("set_ylabel", ["count"]))

base("hidpi_inter",
     ("plot", [x, sx], {"label": "sin"}), ("plot", [x, cx], {"label": "cos"}),
     ("legend", []), ("set_title", ["Inter · text-heavy"]),
     ("set_xlabel", ["time (s)"]), ("set_ylabel", ["amplitude"]),
     ("text", [0.5, 0.82, "16:50 · 1x2 · (A) · A-B → C"], {"transform": {"$transform": "axes"}, "ha": "center", "fontsize": 14}),
     rc={"font.family": "Inter"})

# 6.4×5 (kept) + stock 6.4×4.8 — both must stay pixel-exact after Agg snap/transform association fixes
base("hidpi_imshow_colorbar",
     ("$subplots", [1, 1], {"figsize": [6.4, 5.0]}),
     ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}),
     ("fig.colorbar", [], {"label": "intensity"}),
     ("set_title", ["imshow + colorbar"]))

base("hidpi_imshow_colorbar_stock",
     ("$subplots", [1, 1], {"figsize": [6.4, 4.8]}),
     ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}),
     ("fig.colorbar", [], {"label": "intensity"}),
     ("set_title", ["imshow + colorbar"]))

base("hidpi_concise",
     ("plot", [dates("2024-01-01", 30, (1, "D")), walk[:30]]),
     ("$concise_x", []), ("set_title", ["concise 30 days"]))

# one pro theme dashboard (largest / most stressed)
D = DASH
# 13×7.2 (kept) + stock 13×7 — both must stay pixel-exact after Agg snap/transform association fixes
dash_calls = [("$subplots", [2, 3], {"figsize": [13, 7.2]}),
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
     ("imshow", [{"$array": D["heat"]}], {"cmap": "magma", "origin": "lower", "aspect": "auto", "interpolation": "nearest", "extent": [0, 24, 0, 320]}),
     ("set_xticks", [TICKS]), ("set_xticklabels", [TICKL]), ("set_title", ["Latency heatmap (ms)"]),
     ("fig.colorbar", [], {"label": "requests"})]
for i, svc in enumerate(["api", "web"]):
    col = f"C{i}"
    dash_calls += [("sca", [3 + i]),
                  ("fill_between", [D["hours"], 0, D["errors"][svc]], {"color": col, "alpha": 0.18, "linewidth": 0}),
                  ("plot", [D["hours"], D["errors"][svc]], {"color": col, "linewidth": 1.2}),
                  ("axhline", [1.5], {"color": "C5", "linewidth": 0.8, "linestyle": "--"}),
                  ("set_ylim", [0, 2.6]), ("set_xticks", [TICKS]), ("set_xticklabels", [TICKL]), ("set_title", [f"{svc} error rate (%)"])]
dash_calls += [("sca", [5]), ("scatter", [D["size"], D["dur"]], {"c": D["cache"], "cmap": "viridis", "vmin": -20, "vmax": 100, "s": 14, "alpha": 0.9}),
             ("set_title", ["Duration vs payload (colour: cache hit %)"]), ("set_xscale", ["log"]), ("set_xlabel", ["payload (kB)"]),
             ("fig.suptitle", ["checkout service · last 24 h · pro-dark"]),
             ("fig.subplots_adjust", [], {"left": 0.045, "right": 0.975, "bottom": 0.07, "top": 0.89, "wspace": 0.3, "hspace": 0.42})]
base("hidpi_pro_dark_dashboard", *dash_calls, style="pro-dark")

dash_stock = [("$subplots", [2, 3], {"figsize": [13, 7]}), *dash_calls[1:]]
base("hidpi_pro_dark_dashboard_stock", *dash_stock, style="pro-dark")

# Targeted *.5 snap sweep: line + imshow + log axes at figsizes/dpis that land half-pixel device coords
# (Agg PathSnapper floor(v+0.5); y-up vs y-down association). Names encode figsize and dpi.
SNAP_DPIS = (150, 200, 240, 250, 300)
SNAP_FIGSIZES = ((6.4, 4.8), (6.4, 5.0), (8.0, 6.0), (7.0, 5.0))
def snap_calls(fw, fh):
    return [
        ("$subplots", [1, 3], {"figsize": [fw, fh]}),
        ("plot", [x, sx], {"label": "sin"}),
        ("set_title", ["line"]), ("set_xlabel", ["x"]), ("set_ylabel", ["y"]),
        ("sca", [1]),
        ("imshow", [IM], {"cmap": "viridis", "interpolation": "nearest"}),
        ("fig.colorbar", [], {"label": "z"}),
        ("set_title", ["imshow"]),
        ("sca", [2]),
        ("plot", [x, [max(v, 1e-3) for v in cx]], {}),
        ("set_yscale", ["log"]),
        ("set_title", ["log y"]), ("set_xlabel", ["x"]),
    ]
for (fw, fh) in SNAP_FIGSIZES:
    tag = f"{fw:g}x{fh:g}".replace(".", "p")
    base(f"hidpi_snap_{tag}", *snap_calls(fw, fh))

DPIS = (200, 300)
# Per-base dpi overrides for the snap sweep (exercise half-pixel at more than 200/300)
SNAP_BASE_DPIS = {f"hidpi_snap_{fw:g}x{fh:g}".replace(".", "p"): SNAP_DPIS for (fw, fh) in SNAP_FIGSIZES}

def run_case(base_name, style, rc, calls, dpi):
    name = f"{base_name}_{dpi}"
    sheet = os.path.join(STYLE_DIR, f"{style}.mplstyle") if style else None
    with matplotlib.rc_context(), (plt.style.context(sheet) if sheet else contextlib.nullcontext()):
        ver = getattr(ft, "__freetype_version__", "")
        if ver != "2.14.3":
            raise RuntimeError(f"FreeType mismatch: expected 2.14.3, got {ver}")
        if style or rc.get("font.family") == "Inter":
            use_static_inter()
        if not style:
            matplotlib.rcParams["font.family"] = rc.get("font.family", "DejaVu Sans")
        matplotlib.rcParams["text.hinting"] = "none"
        matplotlib.rcParams.update({k: v for k, v in rc.items() if k != "font.family" or not style})
        grid = next((c for c in calls if c[0] == "$subplots"), None)
        if grid is not None:
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
            if fn == "sca":
                ax = axes[args[0]]; continue
            if fn == "$concise_x":
                loc = mdates.AutoDateLocator()
                fmt = mdates.ConciseDateFormatter(loc, show_offset=kwargs.get("show_offset", True))
                ax.xaxis.set_major_locator(loc)
                ax.xaxis.set_major_formatter(fmt)
                continue
            if fn.startswith("fig."):
                method = fn[4:]
                if method == "colorbar":
                    mappable = ax.images[-1] if ax.images else (ax.collections[-1] if ax.collections else None)
                    if mappable is None:
                        raise RuntimeError("fig.colorbar: no mappable on current Axes")
                    fig.colorbar(mappable, ax=ax, **kwargs); continue
                getattr(fig, method)(*args, **kwargs); continue
            kwargs = {k: (ax.transAxes if isinstance(v, dict) and v.get("$transform") == "axes" else decode(v)) for k, v in kwargs.items()}
            getattr(ax, fn)(*args, **kwargs)
        # meta at figure dpi (default); PNG at savefig dpi
        fig.canvas.draw()
        recs = [record(a, fig) for a in axes]
        rec = dict(spec=calls, style=style, rc=rc, png_dpi=dpi, **recs[0], axes=recs)
        fig.savefig(os.path.join(OUT, f"{name}.svg"))
        fig.savefig(os.path.join(OUT, f"{name}.png"), dpi=dpi)
        with open(os.path.join(OUT, f"{name}.json"), "w") as f:
            json.dump(rec, f, indent=1)
        plt.close(fig)
        return name

def main():
    check_no_literal_newlines({n: c for n, _s, _r, c in BASES})
    with open(INDEX, "r") as f:
        names = json.load(f)
    new_names = []
    force = os.getenv("FORCE", "") != ""
    only = set(sys.argv[1:])
    for base_name, style, rc, calls in BASES:
        dpis = SNAP_BASE_DPIS.get(base_name, DPIS)
        for dpi in dpis:
            name = f"{base_name}_{dpi}"
            if only and name not in only and base_name not in only:
                continue
            if not force and name in names and not only:
                continue
            print(f"generating {name}…", flush=True)
            run_case(base_name, style, rc, calls, dpi)
            if name not in names:
                new_names.append(name)
                names.append(name)
    all_names = sorted(set(names))
    with open(INDEX, "w") as f:
        json.dump(all_names, f)
    print(f"wrote {len(new_names)} new hidpi cases: {new_names}")

if __name__ == "__main__":
    main()
