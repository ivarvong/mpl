// Generate docs/api.md from src/api.ts: every public method of Axes and Figure (and the free
// functions), its doc comment, and the keyword arguments it reads through KwReader (aliases
// grouped as matplotlib spells them). test/api-docs.test.ts fails when docs/api.md is stale, so a
// new public method or kwarg cannot ship undocumented.
//   node scripts/gen_api_docs.ts          write docs/api.md
//   node scripts/gen_api_docs.ts --check  exit 1 if docs/api.md is out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { FACE_CATALOG } from '../src/core/fontcodec.ts';

const ROOT = new URL('../', import.meta.url);
const SRC = readFileSync(new URL('src/api.ts', ROOT), 'utf8');
const OUT = new URL('docs/api.md', ROOT);

type Member = { readonly name: string; readonly sig: string; readonly doc: string; readonly body: string; readonly isPrivate: boolean };

/** The members of `class Name { ... }`: two-space-indented lines start a member. */
function members(cls: string): readonly Member[] {
  const start = SRC.indexOf(`export class ${cls} {`);
  if (start < 0) throw new Error(`class ${cls} not found in src/api.ts`);
  const end = SRC.indexOf('\n}\n', start);
  const lines = SRC.slice(start, end).split('\n').slice(1);
  const out: Member[] = [];
  let doc: string[] = [], inDoc = false, overloadDoc: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^ {2}\/\*\*/.test(line)) { inDoc = true; doc = []; }
    if (inDoc) {
      doc.push(line.trim().replace(/^\/\*\*\s?|^\*\/|^\*\s?|\s*\*\/$/g, ''));
      if (line.includes('*/')) inDoc = false;
      continue;
    }
    const m = /^ {2}(private |readonly |static )*(get )?([A-Za-z_]\w*)\s*(<[^>]*>)?\(([^)]*)\)/.exec(line);
    if (m === null || m[3] === 'constructor') { if (!/^ {2}\s/.test(line) && line.trim() !== '') doc = []; continue; }
    // an overload signature (no body): its doc comment carries over to the implementation
    if (line.trimEnd().endsWith(';')) { if (doc.length > 0) overloadDoc = doc; doc = []; continue; }
    if (doc.length === 0 && overloadDoc.length > 0) doc = overloadDoc;
    overloadDoc = [];
    // the body runs until the next line at member indentation
    let j = i + 1;
    while (j < lines.length && !/^ {2}\S/.test(lines[j])) j++;
    const isPrivate = (m[1] ?? '').includes('private');
    out.push({ name: m[3], sig: `${m[2] ? 'get ' : ''}${m[3]}(${m[5].replace(/: [^,=]+(?=[,=]|$)/g, '').replace(/\s*=\s*[^,]+/g, '?').replace(/\s+/g, ' ').trim()})`,
               doc: doc.join(' ').replace(/\s+/g, ' ').trim(), body: [line, ...lines.slice(i + 1, j)].join('\n'), isPrivate });
    doc = [];
  }
  return out;
}

/** KwReader names read by a body, following calls into private helpers of the same class. */
function kwargs(m: Member, all: readonly Member[], seen: Set<string> = new Set()): readonly string[] {
  if (seen.has(m.name)) return [];
  seen.add(m.name);
  const own = [...m.body.matchAll(/kw\.(?:read|get)\(\[([^\]]*)\]/g)].map((x) => x[1].replace(/['\s]/g, '').split(',').join(' | '));
  const helpers = [...m.body.matchAll(/this\.([A-Za-z_]\w*)\(/g)].map((x) => x[1]);
  const viaHelpers = all.filter((h) => h.isPrivate && helpers.includes(h.name)).flatMap((h) => kwargs(h, all, seen));
  return [...new Set([...own, ...viaHelpers])];
}

function section(cls: string, intro: string): string {
  const all = members(cls);
  const pub = all.filter((m) => !m.isPrivate);
  const rows = pub.map((m) => {
    const kws = kwargs(m, all);
    return `### \`${cls}.${m.sig}\`\n\n${m.doc === '' ? '_No description._' : m.doc}\n` +
      (kws.length > 0 ? `\nKeyword arguments (unknown keys throw): ${kws.map((k) => `\`${k}\``).join(', ')}\n` : '');
  });
  return `## ${cls}\n\n${intro}\n\n${rows.join('\n')}`;
}

function functions(): string {
  const fns = [...SRC.matchAll(/(\/\*\*(?:(?!\*\/)[^])*\*\/)\s*\nexport function (\w+)\(([^)]*)\)/g)];
  return fns.map((f) => `### \`${f[2]}(${f[3].replace(/: [^,=]+(?=[,=]|$)/g, '').replace(/\s*=\s*[^,]+/g, '?').trim()})\`\n\n${f[1].replace(/^\/\*\*\s?|\s*\*\/$/g, '').replace(/\s*\n\s*\*\s?/g, ' ').trim()}\n`).join('\n');
}

/** The font faces: one module each, generated from FACE_CATALOG. */
function fonts(): string {
  return [
    '## Fonts',
    '',
    'Each face is its own module, so a bundle carries only the faces you import. DejaVu Sans (matplotlib\'s',
    'default) is always registered; register any other face before rendering text that selects it:',
    '',
    '```ts',
    "import { registerFonts, subplots } from 'mpljs';",
    "import { dejavuSansBold } from 'mpljs/fonts/dejavu-sans-bold';",
    '',
    'registerFonts(dejavuSansBold);',
    "const [fig, ax] = subplots();",
    "ax.set_title('Bold title', { fontweight: 'bold' });",
    '```',
    '',
    'Font selection is matplotlib\'s (the first family in `font.family` that mpljs ships, then the nearest',
    'weight), always over every shipped face, so registering faces never changes which face a text gets. If',
    'the selected face is not registered, rendering throws `FontNotLoadedError` (fields `face`, `family`,',
    '`weight`, `module`, `binding`; the message names the import to add). It never draws another face instead.',
    'A family mpljs does not ship falls through to the next family in the list, as in matplotlib.',
    '',
    '| face | `font.family` | weight | import |',
    '|---|---|---|---|',
    ...FACE_CATALOG.map((e) => `| \`${e.id}\` | ${e.family}${e.family === 'DejaVu Sans' ? ' (`sans-serif`)' : e.family === 'DejaVu Serif' ? ' (`serif`)' : ''} | ${e.weight} | ${e.id === 'DejaVu Sans:400' ? 'built in' : `\`import { ${e.binding} } from 'mpljs/fonts/${e.module}'\``} |`),
    '',
    '`import { allFonts } from \'mpljs/fonts/all\'` and `registerFonts(...allFonts)` registers every face, for when',
    'size does not matter (Node, tests). `registeredFonts()` lists the registered face ids; `FACE_CATALOG` lists',
    'every shipped face. A face decodes on first use (a `font.decode` span when tracing); `FACE_LOADS` records when.',
    '',
  ].join('\n');
}

export function render(): string {
  return [
    '# API reference',
    '',
    '<!-- Generated by scripts/gen_api_docs.ts from src/api.ts. Do not edit; run `node scripts/gen_api_docs.ts`. -->',
    '',
    'mpljs mirrors matplotlib\'s object-oriented API. Positional arguments come first; keyword arguments',
    'go in a trailing plain object (`ax.plot(x, y, { color: "C1", lw: 2 })`). Aliases are listed as',
    '`name | alias`. A keyword mpljs does not support is an error, never silently ignored.',
    '',
    '## Functions',
    '',
    functions(),
    fonts(),
    section('Figure', 'Create one with `subplots()` or `new Figure({ style, rc, figsize, dpi })`.'),
    section('Axes', 'Returned by `subplots()`, `fig.add_subplot()` and `ax.twinx()`.'),
  ].join('\n').replace(/\n{3,}/g, '\n\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const md = render();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== md) { console.log('docs/api.md is stale: run node scripts/gen_api_docs.ts'); process.exitCode = 1; }
  } else { writeFileSync(OUT, md); console.log(`wrote docs/api.md (${md.length} bytes)`); }
}
