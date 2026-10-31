"""Replay showcase specs (recorded by tools/showcase.mjs) in matplotlib and time it.

    python3 tools/showcase_mpl.py <dir>

For each <name>.spec.json writes <name>.mpl.png and a timing line to _mpl.json: the median of
build + savefig over warm runs, the same work tools/showcase.mjs times for mpljs.
"""
import contextlib, io, json, os, sys, time
import numpy as np
import matplotlib
matplotlib.use("Agg")
matplotlib.rcdefaults()
import matplotlib.pyplot as plt
from cycler import cycler

D = sys.argv[1]

def decode(a):
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    if isinstance(a, dict) and "$date" in a:
        return np.datetime64(a["$date"], "us")
    return a

def rc_of(rc):
    out = {"font.family": "DejaVu Sans"}             # mpljs' default
    for k, v in rc.items():
        out[k] = cycler(color=v) if k == "axes.prop_cycle" else v
    return out

def build(rec):
    style = rec.get("style") or None
    with matplotlib.rc_context(), (plt.style.context(style) if style else contextlib.nullcontext()), matplotlib.rc_context(rc_of(rec["rc"])):
        fig, ax = plt.subplots()
        axes = [ax]
        for fn, args, kwargs in rec["spec"]:
            args = [decode(a) for a in args]
            if fn == "twinx":
                ax = ax.twinx(); axes.append(ax); continue
            if fn == "sca":
                ax = axes[args[0]]; continue
            kw = {}
            for k, v in kwargs.items():
                if isinstance(v, dict) and "$transform" in v:
                    v = ax.transAxes if v["$transform"] == "axes" else ax.transData
                kw[k] = decode(v)
            if fn == "grid" and args == [True]:
                args = []
                kw = {"visible": True, **kw}
            getattr(ax, fn)(*args, **kw)
        buf = io.BytesIO()
        fig.savefig(buf, format="png")
        plt.close(fig)
        return buf.getvalue()

timing = {}
for f in sorted(os.listdir(D)):
    if not f.endswith(".spec.json"):
        continue
    name = f[: -len(".spec.json")]
    rec = json.load(open(os.path.join(D, f)))
    png = build(rec)
    open(os.path.join(D, f"{name}.mpl.png"), "wb").write(png)
    for _ in range(3):
        build(rec)
    ts = []
    for _ in range(9):
        t = time.perf_counter(); build(rec); ts.append((time.perf_counter() - t) * 1000)
    timing[name] = {"p50": sorted(ts)[4], "bytes": len(png)}
    print(f"{name:20s} matplotlib p50 {sorted(ts)[4]:7.1f} ms  {len(png) / 1024:6.0f} KiB")
json.dump({"version": matplotlib.__version__, "charts": timing}, open(os.path.join(D, "_mpl.json"), "w"), indent=1)
