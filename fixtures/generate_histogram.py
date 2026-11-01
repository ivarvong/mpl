"""numpy.histogram / histogram_bin_edges oracle for src/core/histogram.ts (test/histogram.test.ts).

Writes fixtures/histogram_oracle.json: inputs and numpy's exact outputs (floats as repr strings).
Run with the oracle venv (numpy 2.5.x): python generate_histogram.py
"""
import json, os
import numpy as np

rng = np.random.default_rng(20261101)
def f(v): return [repr(float(x)) for x in np.asarray(v, float).ravel()]
data = {
    "normal200": rng.normal(3.0, 2.0, 200).tolist(),
    "bimodal2000": np.concatenate([rng.normal(0, 1, 1000), rng.normal(5, 2, 1000)]).tolist(),
    "skewed500": rng.lognormal(0, 0.8, 500).tolist(),
    "uniform37": rng.uniform(-4, 9, 37).tolist(),
    "tiny3": [0.5, 1.25, 4.0],
    "ints300": rng.integers(0, 12, 300).tolist(),
    "ints20000": rng.integers(-50, 50, 20000).tolist(),
    "const": [2.0] * 9,
    "with_nan": [1.0, float("nan"), 3.5, 2.0],
}
cases = []
def add(name, bins, rng_=None, density=False, weights=None):
    a = np.asarray(data[name])
    try:
        if weights is None:
            n, e = np.histogram(a, bins=bins, range=rng_, density=density)
        else:
            n, e = np.histogram(a, bins=bins, range=rng_, density=density, weights=np.asarray(weights))
        out = dict(counts=f(n), edges=f(e))
    except (ValueError, TypeError) as ex:
        out = dict(error=str(ex))
    cases.append(dict(data=name, bins=bins, range=rng_, density=density, weights=None if weights is None else f(weights), **out))

for name in data:
    for est in ["auto", "fd", "doane", "scott", "stone", "rice", "sturges", "sqrt"]:
        add(name, est)
    add(name, 10); add(name, 7, density=True)
for name in ["normal200", "skewed500", "ints300"]:
    add(name, "auto", (0.0, 6.0)); add(name, 13, (-1.0, 5.5))
    add(name, [-2.0, 0.0, 0.5, 3.0, 4.75, 10.0])
    add(name, [-2.0, 0.0, 0.5, 3.0, 4.75, 10.0], density=True)
w200 = rng.uniform(0.05, 2.0, 200).tolist()
add("normal200", 12, weights=w200); add("normal200", 12, density=True, weights=w200)
add("normal200", [-3.0, 0.0, 1.0, 2.5, 6.0, 9.0], weights=w200, density=True)
add("normal200", "auto", weights=w200)
add("normal200", 0); add("normal200", 5, (3.0, 1.0)); add("normal200", [3.0, 1.0, 2.0])
add("with_nan", 4, (0.0, 4.0)); add("normal200", 3, (1.0, 1.0))
out = dict(numpy=np.__version__, data={k: f(v) for k, v in data.items()}, integer=[k for k, v in data.items() if all(isinstance(x, int) for x in v)], cases=cases)
with open(os.path.join(os.path.dirname(__file__), "histogram_oracle.json"), "w") as fh:
    json.dump(out, fh)
print(len(cases), "cases")
