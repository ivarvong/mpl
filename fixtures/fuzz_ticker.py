"""Oracle fuzz corpus for MaxNLocator/ScalarFormatter: seeded random view
intervals across 20 orders of magnitude, with matplotlib's ticks, labels and
offset text. Consumed by test/fuzz-ticker.mjs."""
import json, os, random, math
import matplotlib; matplotlib.use("Agg"); matplotlib.rcdefaults(); matplotlib.rcParams["font.family"] = "DejaVu Sans"
import matplotlib.pyplot as plt

N = int(os.environ.get("N", 500)); SEED = int(os.environ.get("SEED", 20261019))
rng = random.Random(SEED)
fig, ax = plt.subplots()
cases = []
for i in range(N):
    mag = 10 ** rng.uniform(-9, 11)
    kind = rng.choice(["zero", "offset", "neg", "straddle", "tiny", "wide"])
    if kind == "zero":      lo, hi = 0.0, mag
    elif kind == "offset":  base = mag * rng.uniform(1, 1000); lo, hi = base, base + mag * rng.uniform(0.001, 1)
    elif kind == "neg":     lo, hi = -mag * rng.uniform(1, 10), -mag * rng.uniform(0, 1)
    elif kind == "straddle": lo, hi = -mag * rng.uniform(0, 1), mag * rng.uniform(0, 1) + 1e-300
    elif kind == "tiny":    base = mag; lo, hi = base, base * (1 + 10 ** rng.uniform(-12, -2))
    else:                   lo, hi = -mag, mag * rng.uniform(1, 100)
    if not (hi > lo): hi = lo + mag
    for axis, setter in (("x", ax.set_xlim), ("y", ax.set_ylim)):
        setter(lo, hi)
        a = ax.xaxis if axis == "x" else ax.yaxis
        locs = a.get_majorticklocs()
        f = a.get_major_formatter(); f.set_locs(locs)
        cases.append(dict(axis=axis, lo=lo, hi=hi, kind=kind, ticks=[float(t) for t in locs], labels=[f(t) for t in locs], offset=f.get_offset(), tickspace=a.get_tick_space()))
out = os.path.join(os.path.dirname(__file__), "ref", "_ticker_fuzz.json")
json.dump(dict(seed=SEED, n=len(cases), cases=cases), open(out, "w"))
print("wrote", len(cases), "cases to", out)
