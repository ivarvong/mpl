"""Input checks shared by the fixture generators.

A Python source string written "a\\nb" is the four characters a, backslash, n, b: matplotlib draws a
backslash and an n, not a line break. That mistake made multi_line_texts test nothing for a while.
Generation fails on any string argument containing a literal backslash-n unless the case is listed
in INTENTIONAL_BACKSLASH_N (a case that deliberately draws the two characters).
"""

INTENTIONAL_BACKSLASH_N = {
    # draws the characters backslash and n on purpose: text with escapes must not be reinterpreted
    "api_multiline_texts",
}


def _strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from _strings(x)
    elif isinstance(v, (list, tuple)):
        for x in v:
            yield from _strings(x)


def check_no_literal_newlines(cases):
    bad = []
    for name, calls in cases.items():
        if name in INTENTIONAL_BACKSLASH_N:
            continue
        for call in calls:
            for s in _strings(list(call[1:])):
                if "\\n" in s:
                    bad.append(f"{name}: {call[0]}(...) has a literal backslash-n in {s!r}; use a real newline, or allowlist the case in fixtures/fixture_guard.py")
    if bad:
        raise SystemExit("\n".join(bad))
