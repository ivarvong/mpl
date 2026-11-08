"""Oracle fuzz for the RRuleLocators (Month/Day/Hour/Minute/SecondLocator) and YearLocator with the default
AutoDateFormatter: random locator parameters (intervals, by-lists) over random views; records matplotlib's tick date
numbers and labels. (A by-list below the rule's frequency comes with interval 1: dateutil drops by-values the
interval can't reach from dtstart and raises when none is left, and the locator's first dtstart is datetime.now().)
An RRuleLocator's dtstart is vmin - relativedelta(vmax, vmin), so with interval > 1 the tick phase
follows the view; this pins that down."""
import json, os, random
import matplotlib; matplotlib.use("Agg"); matplotlib.rcdefaults()
import matplotlib.dates as mdates
import matplotlib.pyplot as plt

N = int(os.environ.get("N", 600)); SEED = int(os.environ.get("SEED", 23))
rng = random.Random(SEED)
fig, ax = plt.subplots()
ax.xaxis_date()

def subset(lo, hi, k):
    return sorted(rng.sample(range(lo, hi + 1), k))

def pick():
    kind = rng.choice(["HourLocator", "DayLocator", "MinuteLocator", "SecondLocator", "MonthLocator", "YearLocator"])
    kw = {}
    if kind == "YearLocator":
        kw = {"base": rng.choice([1, 2, 5, 10, 25]), "month": rng.randint(1, 12), "day": rng.choice([1, 15, 28])}
        unit, per = 365.25 * kw["base"], 1
    elif kind == "MonthLocator":
        if rng.random() < 0.5: kw["bymonth"] = subset(1, 12, rng.randint(1, 6))
        if rng.random() < 0.5: kw["bymonthday"] = rng.choice([1, 15, 28, [1, 15]])
        kw["interval"] = rng.randint(1, 4)
        unit, per = 30.4 * kw["interval"], 12 / len(kw.get("bymonth", range(12)))
    elif kind == "DayLocator":
        if rng.random() < 0.4: kw["bymonthday"] = subset(1, 31, rng.randint(1, 5))
        kw["interval"] = rng.randint(1, 9)
        unit, per = kw["interval"], 31 / len(kw.get("bymonthday", range(31)))
    elif kind == "HourLocator":
        if rng.random() < 0.4: kw["byhour"] = subset(0, 23, rng.randint(1, 6))
        kw["interval"] = 1 if "byhour" in kw else rng.randint(1, 13)
        unit, per = kw["interval"] / 24, 24 / len(kw.get("byhour", range(24)))
    elif kind == "MinuteLocator":
        if rng.random() < 0.3: kw["byminute"] = subset(0, 59, rng.randint(1, 8))
        kw["interval"] = 1 if "byminute" in kw else rng.randint(1, 30)
        unit, per = kw["interval"] / 1440, 60 / len(kw.get("byminute", range(60)))
    else:
        if rng.random() < 0.3: kw["bysecond"] = subset(0, 59, rng.randint(1, 8))
        kw["interval"] = 1 if "bysecond" in kw else rng.randint(1, 30)
        unit, per = kw["interval"] / 86400, 60 / len(kw.get("bysecond", range(60)))
    return kind, kw, unit * min(per, 12)

cases = []
for i in range(N):
    kind, kw, unit = pick()
    start = rng.uniform(-20000, 25000)
    span = unit * rng.uniform(0.5, 25)
    lo, hi = start, start + span
    if rng.random() < 0.15: lo, hi = hi, lo                    # an inverted view
    ax.set_xlim(lo, hi)
    loc = getattr(mdates, kind)(**kw)
    ax.xaxis.set_major_locator(loc)
    fmt = ax.xaxis.get_major_formatter()
    ticks = [float(t) for t in loc()]
    fmt.set_locs(ticks)
    cases.append(dict(kind=kind, kw=kw, lo=lo, hi=hi, ticks=ticks, labels=[fmt(t) for t in ticks]))
json.dump(dict(seed=SEED, cases=cases), open(os.path.join(os.path.dirname(__file__), "ref", "_rrule_dates_fuzz.json"), "w"))
print("wrote", len(cases), "rrule date cases")
