"""Issue #70 oracle: Figure.colorbar(ax=[...]) (Colorbar.make_axes) under matplotlib 3.11.2.

For each case, every Axes' get_position(original=True) and drawn bbox (px), in fig.axes order, plus whether it
has a SubplotSpec. Writes fixtures/colorbar_axes_oracle.json; test/colorbar-axes.test.ts replays the same cases.
"""
import json, os
import matplotlib
matplotlib.use("agg")
import matplotlib.pyplot as plt

matplotlib.rcParams["font.family"] = "DejaVu Sans"
matplotlib.rcParams["text.hinting"] = "none"
IM = [[0, 1, 2], [3, 4, 5], [6, 7, 8]]
HEAT = [[(i * 7 + j * 3) % 11 for j in range(12)] for i in range(8)]


def joint(kw):
    fig, axs = plt.subplots(2, 2, gridspec_kw={"height_ratios": [1, 3], "width_ratios": [3, 1]})
    top, heat = axs[0][0], axs[1][0]
    top.plot(range(12), [3, 5, 4, 6, 8, 7, 5, 6, 9, 8, 6, 7])
    im = heat.imshow(HEAT, aspect="auto")
    fig.colorbar(im, ax=[heat, top], **kw)
    return fig


def row(n, kw, aspect="equal"):
    fig, axs = plt.subplots(1, n, squeeze=False)
    axs = axs[0]
    im = None
    for a in axs:
        im = a.imshow(IM, aspect=aspect)
    fig.colorbar(im, ax=list(axs), **kw)
    return fig


def nested(kw):
    fig, axs = plt.subplots(2, 2)
    im = axs[1][1].imshow(IM)
    fig.colorbar(im, ax=axs, **kw)  # an ndarray of Axes: .flat
    return fig


def twice():
    fig, axs = plt.subplots(2, 2)
    axs = list(axs.flat)
    im = axs[0].imshow(IM)
    fig.colorbar(im, ax=[axs[0], axs[1]])
    im2 = axs[3].imshow(IM)
    fig.colorbar(im2, ax=[axs[0], axs[2], axs[3]], location="bottom")
    return fig


def twin():
    fig, axs = plt.subplots(1, 2)
    axs[0].plot([0, 1, 2], [0, 1, 0])
    axs[0].twinx().plot([0, 1, 2], [5, 3, 4])
    im = axs[1].imshow(IM)
    fig.colorbar(im, ax=[axs[0], axs[1]], location="top", shrink=0.5)
    return fig


def adjusted():
    fig, axs = plt.subplots(1, 2)
    im = axs[0].imshow(IM)
    fig.colorbar(im, ax=list(axs))
    fig.subplots_adjust(left=0.05, wspace=0.3)
    return fig


CASES = {
    "joint": lambda: joint({}),
    "joint_pad_shrink": lambda: joint({"pad": 0.02, "shrink": 0.8, "aspect": 30}),
    "joint_left": lambda: joint({"location": "left"}),
    "joint_top": lambda: joint({"location": "top", "fraction": 0.1}),
    "joint_bottom_anchor": lambda: joint({"location": "bottom", "shrink": 0.5, "anchor": (0.0, 1.0), "panchor": (0.5, 0.5)}),
    "row3_bottom": lambda: row(3, {"location": "bottom", "shrink": 0.6, "aspect": 30}),
    "row2_right": lambda: row(2, {}),
    "row2_auto": lambda: row(2, {"fraction": 0.2, "pad": 0.1}, "auto"),
    "one_top": lambda: row(1, {"location": "top"}),
    "nested_right": lambda: nested({}),
    "twice": twice,
    "twinx": twin,
    "subplots_adjust": adjusted,
}


def record(fig):
    fig.canvas.draw()
    return [{"pos": a.get_position(original=True).extents.tolist(), "bbox": a.bbox.extents.tolist(),
             "subplotspec": a.get_subplotspec() is not None} for a in fig.axes]


out = {}
for name, make in CASES.items():
    fig = make()
    out[name] = record(fig)
    plt.close(fig)
with open(os.path.join(os.path.dirname(__file__), "colorbar_axes_oracle.json"), "w") as f:
    json.dump(out, f, indent=1)
print(f"wrote {len(out)} cases")
