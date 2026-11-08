"""Oracle fixtures for ConciseDateFormatter and Figure.autofmt_xdate."""
import contextlib, json, math, os
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

ROOT = os.path.dirname(__file__)
OUT = os.path.join(ROOT, "ref")
INDEX = os.path.join(OUT, "_index.json")
os.makedirs(OUT, exist_ok=True)

def L(v): return np.asarray(v).tolist()
def dates(start, n, step):
    base = np.datetime64(start)
    return {"$dates": [str(base + i * np.timedelta64(*step)) for i in range(n)]}

def decode(a):
    if isinstance(a, dict) and "$dates" in a:
        return np.array(a["$dates"], dtype="datetime64[us]")
    if isinstance(a, list):
        return [decode(v) for v in a]
    return a

def axis_record(axis):
    return dict(lim=[float(v) for v in axis.get_view_interval()],
                ticks=[float(v) for v in axis.get_majorticklocs()],
                labels=[t.get_text() for t in axis.get_majorticklabels()],
                minor=[float(v) for v in axis.get_minorticklocs()],
                minorlabels=[t.get_text() for t in axis.get_minorticklabels()],
                offset=axis.get_offset_text().get_text())

def record(ax, fig):
    return dict(
        xlim=list(ax.get_xlim()), ylim=list(ax.get_ylim()),
        xticks=[float(v) for v in ax.get_xticks()], yticks=[float(v) for v in ax.get_yticks()],
        xticklabels=[t.get_text() for t in ax.get_xticklabels()],
        yticklabels=[t.get_text() for t in ax.get_yticklabels()],
        xoffset=ax.xaxis.get_offset_text().get_text(),
        yoffset=ax.yaxis.get_offset_text().get_text(),
        legend=None,
        x=axis_record(ax.xaxis), y=axis_record(ax.yaxis),
    )

CASES = {}
def case(name, *calls): CASES[name] = [list(c) + [{}] * (3 - len(c)) for c in calls]

# walk data
rng = np.random.default_rng(0)
walk = L(np.cumsum(rng.normal(0, 1, 200)))

# ConciseDateFormatter across spans
case("concise_days", ("plot", [dates("2024-01-01", 30, (1, "D")), walk[:30]]), ("$concise_x", []), ("set_title", ["concise 30 days"]))
case("concise_hours", ("plot", [dates("2024-03-10T00:00", 48, (1, "h")), walk[:48]]), ("$concise_x", []), ("set_title", ["concise 48 hours"]))
case("concise_minutes", ("plot", [dates("2024-03-10T09:00", 90, (1, "m")), walk[:90]]), ("$concise_x", []), ("set_title", ["concise 90 minutes"]))
case("concise_months", ("plot", [dates("2023-01-01", 24, (31, "D")), walk[:24]]), ("$concise_x", []), ("set_title", ["concise months"]))
case("concise_years", ("plot", [dates("1995-01-01", 30, (365, "D")), walk[:30]]), ("$concise_x", []), ("set_title", ["concise years"]))
case("concise_decades", ("plot", [dates("1900-01-01", 120, (365, "D")), walk[:120]]), ("$concise_x", []), ("set_title", ["concise decades"]))
case("concise_show_offset_false", ("plot", [dates("2024-01-01", 30, (1, "D")), walk[:30]]),
     ("$concise_x", [], {"show_offset": False}), ("set_title", ["no offset"]))

# autofmt_xdate (AutoDateFormatter labels, rotated)
case("autofmt_single", ("plot", [dates("2024-01-01", 60, (1, "D")), walk[:60]]),
     ("fig.autofmt_xdate", []), ("set_title", ["autofmt single"]))
case("autofmt_rotation_45", ("plot", [dates("2024-01-01", 60, (1, "D")), walk[:60]]),
     ("fig.autofmt_xdate", [], {"rotation": 45}), ("set_title", ["autofmt 45"]))
case("autofmt_sharex", ("$subplots", [2, 1], {"sharex": True}),
     ("plot", [dates("2024-01-01", 60, (1, "D")), walk[:60]]), ("set_xlabel", ["time"]), ("set_ylabel", ["top"]),
     ("sca", [1]), ("plot", [dates("2024-01-01", 60, (1, "D")), walk[60:120]]), ("set_xlabel", ["time"]), ("set_ylabel", ["bottom"]),
     ("fig.autofmt_xdate", []), ("fig.suptitle", ["autofmt sharex"]))
case("autofmt_concise", ("plot", [dates("2024-01-01", 60, (1, "D")), walk[:60]]),
     ("$concise_x", []), ("fig.autofmt_xdate", []), ("set_title", ["autofmt + concise"]))

# Explicit date locators (RRuleLocator subclasses and YearLocator) with the default AutoDateFormatter (which takes the
# locator's unit), a DateFormatter or a ConciseDateFormatter: ("$date_x", [locator, kwargs, formatter or None]).
W = {"figsize": [8, 3.2]}
case("datelocator_hour_interval12", ("$subplots", [1, 1], W), ("plot", [dates("2013-06-18T06:30", 97, (1, "h")), walk[:97]]),
     ("$date_x", ["HourLocator", {"interval": 12}, {"DateFormatter": "%m-%d %H:%M"}]), ("set_title", ["HourLocator(interval=12)"]))
case("datelocator_hour_byhour", ("$subplots", [1, 1], W), ("plot", [dates("2024-03-10T05:00", 140, (30, "m")), walk[:140]]),
     ("$date_x", ["HourLocator", {"byhour": [0, 12]}, None]), ("set_title", ["HourLocator(byhour=[0, 12]), AutoDateFormatter"]))
case("datelocator_day_interval", ("$subplots", [1, 1], W), ("plot", [dates("2024-01-03T07:00", 40, (1, "D")), walk[:40]]),
     ("$date_x", ["DayLocator", {"interval": 5}, {"DateFormatter": "%a %b %d"}]), ("set_title", ["DayLocator(interval=5)"]))
case("datelocator_day_bymonthday_concise", ("$subplots", [1, 1], W), ("plot", [dates("2023-11-20", 100, (1, "D")), walk[:100]]),
     ("$date_x", ["DayLocator", {"bymonthday": [1, 15]}, {"ConciseDateFormatter": {}}]), ("set_title", ["DayLocator(bymonthday=[1, 15]), concise"]))
case("datelocator_minute_interval", ("$subplots", [1, 1], W), ("plot", [dates("2024-03-10T09:07", 180, (1, "m")), walk[:180]]),
     ("$date_x", ["MinuteLocator", {"interval": 20}, None]), ("set_title", ["MinuteLocator(interval=20)"]))
case("datelocator_second_interval", ("$subplots", [1, 1], W), ("plot", [dates("2024-03-10T09:07:03", 150, (1, "s")), walk[:150]]),
     ("$date_x", ["SecondLocator", {"interval": 15}, None]), ("set_title", ["SecondLocator(interval=15)"]))
case("datelocator_month_interval", ("$subplots", [1, 1], W), ("plot", [dates("2021-02-11", 30, (31, "D")), walk[:30]]),
     ("$date_x", ["MonthLocator", {"interval": 3}, {"DateFormatter": "%Y-%m"}]), ("set_title", ["MonthLocator(interval=3)"]))
case("datelocator_month_bymonth_concise", ("$subplots", [1, 1], W), ("plot", [dates("2018-05-01", 75, (30, "D")), walk[:75]]),
     ("$date_x", ["MonthLocator", {"bymonth": [1, 7]}, {"ConciseDateFormatter": {}}]), ("set_title", ["MonthLocator(bymonth=[1, 7]), concise"]))
case("datelocator_year_base", ("$subplots", [1, 1], W), ("plot", [dates("1931-04-01", 61, (365, "D")), walk[:61]]),
     ("$date_x", ["YearLocator", {"base": 10}, None]), ("set_title", ["YearLocator(10)"]))

def run_case(name, calls):
    with matplotlib.rc_context():
        ver = getattr(ft, "__freetype_version__", "")
        if ver != "2.14.3":
            raise RuntimeError(f"FreeType mismatch: expected 2.14.3, got {ver}")
        matplotlib.rcParams["font.family"] = "DejaVu Sans"
        matplotlib.rcParams["text.hinting"] = "none"
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
            if fn == "$date_x":
                lname, lkw, f = args
                loc = getattr(mdates, lname)(**lkw)
                ax.xaxis.set_major_locator(loc)
                if f is not None and "DateFormatter" in f:
                    ax.xaxis.set_major_formatter(mdates.DateFormatter(f["DateFormatter"]))
                elif f is not None and "ConciseDateFormatter" in f:
                    ax.xaxis.set_major_formatter(mdates.ConciseDateFormatter(loc, **f["ConciseDateFormatter"]))
                continue
            if fn.startswith("fig."):
                getattr(fig, fn[4:])(*args, **kwargs); continue
            getattr(ax, fn)(*args, **kwargs)
        fig.canvas.draw()
        recs = [record(a, fig) for a in axes]
        rec = dict(spec=calls, style=None, rc={}, **recs[0], axes=recs)
        fig.savefig(os.path.join(OUT, f"{name}.svg"))
        fig.savefig(os.path.join(OUT, f"{name}.png"))
        with open(os.path.join(OUT, f"{name}.json"), "w") as f:
            json.dump(rec, f, indent=1)
        plt.close(fig)

def main():
    check_no_literal_newlines(CASES)
    with open(INDEX, "r") as f:
        names = json.load(f)
    new_names = []
    force = os.getenv("FORCE", "") != ""
    for name, calls in CASES.items():
        if not force and name in names:
            continue
        run_case(name, calls)
        if name not in names:
            new_names.append(name)
    all_names = sorted(set(names + new_names))
    with open(INDEX, "w") as f:
        json.dump(all_names, f)
    print(f"wrote {len(new_names)} new cases: {new_names}")

if __name__ == "__main__":
    main()
