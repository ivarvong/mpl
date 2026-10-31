"""Replay a fixture in matplotlib and print every Agg text draw call (s, x, y, angle).
   python3 tools/agg_trace.py <fixture>"""
import contextlib, json, sys
import numpy as np, matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_agg import RendererAgg

name = sys.argv[1]
fx = json.load(open(f"fixtures/ref/{name}.json"))
def decode(a):
    if isinstance(a, dict) and "$dates" in a: return np.array(a["$dates"], dtype="datetime64[us]")
    return a
orig = RendererAgg.draw_text
def spy(self, gc, x, y, s, prop, angle, ismath=False, mtext=None):
    print(json.dumps(dict(s=s, x=x, y=y, angle=angle, size=prop.get_size_in_points())))
    return orig(self, gc, x, y, s, prop, angle, ismath=ismath, mtext=mtext)
RendererAgg.draw_text = spy
with plt.style.context(fx["style"]) if fx["style"] else contextlib.nullcontext():
    matplotlib.rcParams["font.family"] = "DejaVu Sans"
    matplotlib.rcParams.update(fx.get("rc", {}))
    fig, ax = plt.subplots(); axes = [ax]
    for fn, args, kwargs in fx["spec"]:
        args = [decode(a) for a in args]
        if fn == "twinx": ax = ax.twinx(); axes.append(ax); continue
        if fn == "sca": ax = axes[args[0]]; continue
        kwargs = {k: (ax.transAxes if isinstance(v, dict) and v.get("$transform") == "axes" else v) for k, v in kwargs.items()}
        getattr(ax, fn)(*args, **kwargs)
    fig.canvas.draw()
