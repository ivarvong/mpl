# Contributing

mpljs reproduces matplotlib's output, and matplotlib 3.11.2 is the oracle. A change is correct when the fixtures say so.

## Setup

Node >= 24. No Python is needed unless you regenerate the oracle.

```sh
npm ci
npm test      # tsc + strict rules + oxlint, then every fixture, fuzz and unit suite (~10 s)
npm run example   # render examples/out/quickstart.{svg,png}
```

## Rules

- Everything is TypeScript run directly by Node 24 (no `.mjs`); `tsc -p .` checks `src/`, `test/`, `tools/`, `scripts/`, `bench/`, `examples/`.
- `src/` is strict, erasable TypeScript (`erasableSyntaxOnly`): no enums, namespaces or parameter properties.
- The modeling rules in the README are enforced by `npm run strict`: no `undefined`/`null`/`?.`/`??`, no optional fields,
  no `any`, no `as T` casts or `!` assertions; every `switch` over a union ends in `assertNever`. Absence is a variant.
- Runtime dependencies stay at zero. `src/core` must not touch the DOM, `fs` or `process`.
- New behaviour comes with an oracle: add a case to `fixtures/generate.py`, regenerate with matplotlib 3.11.2
  (see "Regenerating the oracle" in the README and the FreeType caveat in docs/fixtures.md: do not commit fixtures from a different FreeType), and commit the new files in `fixtures/ref/`.
  Do not hand-edit anything under `fixtures/ref/` or `src/core/data/` (generated).
- Performance claims need numbers from `bench/bench.ts` or `bench/sweep.ts`.

## Pull requests

One focused change per PR, `npm test` green. Describe which fixtures cover it.
By contributing you agree your work is licensed under the repository's ISC license.
