"""Oracle fuzz for AutoDateLocator + AutoDateFormatter: random view intervals from
seconds to centuries; records matplotlib's tick date numbers and label strings."""
import json, os, random
import matplotlib; matplotlib.use("Agg"); matplotlib.rcdefaults()
import matplotlib.dates as mdates
import matplotlib.pyplot as plt

N = int(os.environ.get("N", 400)); SEED = int(os.environ.get("SEED", 11))
rng = random.Random(SEED)
fig, ax = plt.subplots()
ax.xaxis_date()
cases = []
for i in range(N):
    start = rng.uniform(-20000, 25000)                       # ~1915 .. 2038
    span = 10 ** rng.uniform(-4.5, 4.6)                       # ~3 seconds .. ~110 years, in days
    lo, hi = start, start + span
    ax.set_xlim(lo, hi)
    loc = ax.xaxis.get_major_locator(); fmt = ax.xaxis.get_major_formatter()
    ticks = [float(t) for t in loc()]
    fmt.set_locs(ticks)
    cases.append(dict(lo=lo, hi=hi, ticks=ticks, labels=[fmt(t) for t in ticks]))
json.dump(dict(seed=SEED, cases=cases), open(os.path.join(os.path.dirname(__file__), "ref", "_dates_fuzz.json"), "w"))
print("wrote", len(cases), "date cases")
