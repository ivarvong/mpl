"""Oracle for src/core/libm.ts: 60-digit log10 and exp, rounded once to double, plus numpy's results.
   /workspace/mplstock/bin/python fixtures/generate_libm.py  ->  fixtures/ref/_libm.json"""
import json, os
from decimal import Decimal as D, getcontext
import numpy as np
getcontext().prec = 60
r = np.random.default_rng(11)
lx = np.concatenate([np.exp(r.uniform(-700, 700, 1500)), r.uniform(0, 1e6, 500), r.uniform(0.9, 1.1, 500),
                     10.0 ** np.arange(-300, 301, 7), np.exp(np.linspace(0, 10, 60)), np.logspace(-3, 12, 40),
                     [5e-324, 1e-310, 1.7e308, 0.6309573444801931, 15848.931924611146]])
ex = np.concatenate([r.uniform(-700, 700, 1500), r.uniform(-30, 30, 1000), r.uniform(-1e-6, 1e-6, 300),
                     np.linspace(-12, 12, 97) * np.log(10), [-0.20000000000000007 * np.log(10), -745.0, 709.7]])
LN10 = D(10).ln()
out = {
    "log10": {"x": lx.tolist(), "cr": [float(D(float(v)).ln() / LN10) for v in lx], "numpy": np.log10(lx).tolist()},
    "exp": {"x": ex.tolist(), "cr": [float(D(float(v)).exp()) for v in ex], "numpy": np.exp(ex).tolist()},
}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "ref", "_libm.json"), "w") as f:
    json.dump(out, f)
print(f"wrote {len(lx)} log10 and {len(ex)} exp cases")
