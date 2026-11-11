"""Line2D dash patterns (matplotlib 3.11.2): _get_dash_pattern + _scale_dashes for dash-tuple linestyles, the
offset wrapped into one cycle, and Line2D.is_dashed, for test/linestyle.test.ts. Run: python3 fixtures/generate_dash_oracle.py"""
import json, os
import matplotlib
matplotlib.use("Agg")
from matplotlib.lines import Line2D

assert matplotlib.__version__ == "3.11.2", matplotlib.__version__
STYLES = [(0, [1, 2, 4, 2]), (5, [6, 2]), (-3, [1, 2, 4, 2]), (0, [5]), (0, [1, 2, 4]), (0, None), (0, []),
          (17.5, [3, 1.5, 0.5, 1.5]), (-0.1, [0.3, 0.7]), (1e9 + 0.25, [0.1, 0.2]), (2, [0, 3]), "-", "--", "-.", ":"]
out = []
for ls in STYLES:
    for lw in [0.5, 1, 2.5, 3.7]:
        ln = Line2D([0, 1], [0, 1], linestyle=ls, linewidth=lw)
        off, seq = ln._dash_pattern
        out.append(dict(linestyle=list(ls) if isinstance(ls, tuple) else ls, linewidth=lw, offset=float(off),
                        dashes=None if seq is None else [float(v) for v in seq], dashed=bool(ln.is_dashed())))
with open(os.path.join(os.path.dirname(__file__), "dash_oracle.json"), "w") as f:
    json.dump(out, f, indent=0)
print(f"wrote {len(out)} dash cases")
