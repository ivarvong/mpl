# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's "Report a vulnerability" (Security advisories) on
https://github.com/ivarvong/mpl, or by email to ivar@ivarvong.com. Do not open a public issue for a vulnerability.
Expect an acknowledgement within a few days.

## Scope notes

mpljs is a pure computation library: it parses user-supplied numbers, strings (labels, `.mplstyle` text) and
format strings, and produces SVG or PNG bytes. It does no network or file I/O (except the opt-in
`tracer.flush(path)`). SVG output escapes text content; if you find a case where untrusted label, style or
color input can inject markup or cause pathological CPU/memory use, that is in scope.
