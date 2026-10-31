// Enforce the modeling rules on src/**/*.ts that tsc cannot express:
//   no undefined / null / ?. / ?? / optional fields `x?:` / any / casts (except `as const`) / non-null `!`
//   every `default:` branch is assertNever(...), return err(...), or throw
// src/core/std.ts is the quarantine where stdlib undefined is lifted into Option; generated data is exempt.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../src/', import.meta.url).pathname;
const EXEMPT = new Set(['core/std.ts']);
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

// Blank out comments and string/template/regex contents so rules see only code.
function codeOnly(src: string): string {
  let out = '', i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], c2 = src.slice(i, i + 2);
    if (c2 === '//') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c2 === '/*') { while (i < n && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; out += q; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        if (q === '`' && src.slice(i, i + 2) === '${') {        // keep template expressions as code
          let depth = 0;
          while (i < n) { const ch = src[i]; out += ch; i++; if (ch === '{') depth++; else if (ch === '}' && --depth === 0) break; }
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += q; i++; continue;
    }
    if (c === '/' && /[=(,:;!&|?{}[\n]\s*$/.test(out.slice(-20)) && src[i + 1] !== '/' && src[i + 1] !== '*') {   // regex literal
      out += '/'; i++;
      let cls = false;
      while (i < n && (src[i] !== '/' || cls)) { if (src[i] === '\\') { out += '  '; i += 2; continue; } if (src[i] === '[') cls = true; if (src[i] === ']') cls = false; out += ' '; i++; }
      out += '/'; i++; continue;
    }
    out += c; i++;
  }
  return out;
}

const RULES: [RegExp, string][] = [
  [/\bundefined\b/, 'undefined: model absence as a variant (Option / { kind: none })'],
  [/\bnull\b/, 'null: model absence as a variant'],
  [/\?\./, 'optional chaining ?.: the value should not be nullable'],
  [/\?\?/, 'nullish coalescing ??: the value should not be nullable'],
  [/\w\s*\?\s*:/, 'optional property/parameter x?: make absence a variant'],
  [/(?<![\w$])any\b(?!\s*\()/, 'any: use unknown and parse it'],
  [/\bas\s+(?!const\b)[A-Za-z{[(]/, 'type assertion `as T`: parse instead of asserting'],
  [/[\w)\]]!(?=[.[;,)\s])(?!=)/, 'non-null assertion `x!`'],
];

let failures = 0;
for (const file of walk(ROOT).filter((f: string) => f.endsWith('.ts'))) {
  const rel = relative(ROOT, file);
  if (EXEMPT.has(rel) || rel.startsWith('core/data/')) continue;
  const lines = codeOnly(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    for (const [re, why] of RULES) if (re.test(line)) { console.log(`src/${rel}:${i + 1}: ${why}\n    ${line.trim()}`); failures++; }
    if (/\bdefault\s*:/.test(line)) {
      const tail = lines.slice(i, i + 2).join(' ');
      if (!/assertNever\(|return err\(|throw\b/.test(tail)) { console.log(`src/${rel}:${i + 1}: default branch must be assertNever(), return err(), or throw\n    ${line.trim()}`); failures++; }
    }
  });
}
console.log(failures === 0 ? 'strict: ok' : `strict: ${failures} violation(s)`);
process.exit(failures === 0 ? 0 : 1);
