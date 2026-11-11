"""Colorbar value geometry under LogNorm (matplotlib 3.11.2): boundaries, mesh edges, view limits, colour indices
and the long axis' ticks, for test/colorbar.test.ts. Run: python3 fixtures/generate_colorbar_oracle.py"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LogNorm

assert matplotlib.__version__ == "3.11.2", matplotlib.__version__
CASES = [(10.0, 10000.0, "viridis"), (3.0, 8587.269154529457, "plasma"), (0.02, 1362.4463716590358, "coolwarm"),
         (1e-3, 1.0, "magma"), (2.0, 5.0, "viridis"), (1.0, 1e12, "viridis")]
out = []
for vmin, vmax, cmap in CASES:
    fig, ax = plt.subplots()
    im = ax.imshow([[vmin, vmax]], cmap=cmap, norm=LogNorm(vmin=vmin, vmax=vmax))
    cb = fig.colorbar(im, ax=ax)
    fig.canvas.draw()
    X, Y = cb._mesh()
    n = cb.norm
    idx = (np.ma.filled(n(cb._values), np.nan) * cb.cmap.N).astype(int).clip(0, cb.cmap.N - 1)
    out.append(dict(vmin=vmin, vmax=vmax, cmap=cmap, N=cb.cmap.N,
                    edges=[float(v) for v in Y[:, 0]], lim=[float(v) for v in cb.ax.get_ylim()],
                    index=[int(v) for v in idx],
                    ticks=[float(v) for v in cb.ax.yaxis.get_majorticklocs()],
                    labels=[t.get_text() for t in cb.ax.get_yticklabels()],
                    minor=[float(v) for v in cb.ax.yaxis.get_minorticklocs()]))
    plt.close(fig)
with open(os.path.join(os.path.dirname(__file__), "colorbar_oracle.json"), "w") as f:
    json.dump(out, f, indent=0)
print(f"wrote {len(out)} colorbar cases")
