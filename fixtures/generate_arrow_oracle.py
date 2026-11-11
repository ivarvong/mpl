"""FancyArrowPatch geometry (matplotlib 3.11.2): ConnectionStyle arc3 then the ArrowStyle transmute, for every
arrowstyle annotate draws, in display px, for test/arrowstyle.test.ts. Run: python3 fixtures/generate_arrow_oracle.py"""
import json, os
import matplotlib
matplotlib.use("Agg")
from matplotlib.patches import ArrowStyle, ConnectionStyle

assert matplotlib.__version__ == "3.11.2", matplotlib.__version__
K = 100 / 72  # points_to_pixels(1) at dpi 100
STYLES = ["-", "->", "-|>", "<-", "<->", "<|-", "<|-|>", "]-", "-[", "]-[", "|-|", "]->", "<-[",
          "simple", "fancy", "wedge", "-|>,head_length=0.8,head_width=0.4", "]-[,widthA=0.5,lengthB=0.6", "<->,head_width=0.5,scaleA=7",
          "simple,tail_width=0.4,head_width=1.2", "fancy,head_length=0.6,tail_width=0.2", "wedge,tail_width=0.7,shrink_factor=0.2"]
GEOMS = [  # posA, posB, rad, shrinkA pt, shrinkB pt, mutation pt, linewidth pt
    ([100.0, 120.0], [310.5, 120.0], 0.0, 2, 2, 10, 1),
    ([80.25, 60.0], [260.0, 233.75], 0.3, 2, 2, 10, 1.5),
    ([300.0, 300.0], [140.0, 80.0], -0.4, 0, 8, 14, 2),
    ([50.0, 50.0], [50.0, 240.0], 0.0, 4, 0, 25, 0.5),
]
out = []
for st in STYLES:
    for posA, posB, rad, sa, sb, ms, lw in GEOMS:
        path = ConnectionStyle(f"arc3,rad={rad}")(posA, posB, shrinkA=sa * K, shrinkB=sb * K)
        paths, fills = ArrowStyle(st)(path, ms * K, lw * K, 1)
        if not isinstance(fills, list):
            paths, fills = [paths], [fills]
        out.append(dict(style=st, posA=posA, posB=posB, rad=rad, shrinkA=sa, shrinkB=sb, mutation=ms, linewidth=lw,
                        pieces=[dict(codes=[int(c) for c in p.codes], vertices=[[float(x), float(y)] for x, y in p.vertices], fillable=bool(f))
                                for p, f in zip(paths, fills)]))
with open(os.path.join(os.path.dirname(__file__), "arrow_oracle.json"), "w") as f:
    json.dump(out, f, indent=0)
print(f"wrote {len(out)} arrow cases")
