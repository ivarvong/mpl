"""Bake font faces into typed tables for mpljs: build/fonts/<slug>.json, which scripts/encode_fonts.ts
then packs losslessly into the per-face modules src/fonts/<slug>.ts (mpljs/fonts/<slug>)

Each face carries what matplotlib 3.11's text path needs, keyed by glyph id:
  cmap      char -> gid for the supported character set
  glyphs    gid -> [advance, xMin, xMax, yMin, yMax] (font units; control-point cbox)
  outlines  gid -> contours, each flat [x, y, tag, ...] with FreeType tags
            (1 on-curve, 0 conic control, 2 cubic control); a composite glyph's contours are
            in their components' units, and
  offsets   gid -> per contour, the component offsets [dx, dy, ...] to add after scaling
  kern      "gidL,gidR" -> x-advance adjustment (GPOS 'kern' pair positioning, or the 'kern' table)
  gsub      the default-feature lookups HarfBuzz applies to Latin text (ccmp, locl, rlig,
            calt, clig, liga), restricted to the glyph closure of the character set
Only lookup types 1, 4, 5 (format 3) and 6 (formats 1–3) are emitted; others are reported.

Run: python3 scripts/gen_fonts.py
"""
import json, os, sys
import matplotlib
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.boundsPen import ControlBoundsPen

OUT = os.path.join(os.path.dirname(__file__), "..", "build", "fonts")
os.makedirs(OUT, exist_ok=True)
MPL_TTF = os.path.join(os.path.dirname(matplotlib.__file__), "mpl-data", "fonts", "ttf")
INTER = os.environ.get("INTER_DIR", "/usr/share/fonts/opentype/inter")  # dir with Inter-{Regular,Medium,SemiBold,Bold}.otf
FACES = [
    ("dejavu-sans", "DejaVu Sans", 400, os.path.join(MPL_TTF, "DejaVuSans.ttf")),
    ("dejavu-sans-bold", "DejaVu Sans", 700, os.path.join(MPL_TTF, "DejaVuSans-Bold.ttf")),
    ("dejavu-serif", "DejaVu Serif", 400, os.path.join(MPL_TTF, "DejaVuSerif.ttf")),
    ("dejavu-serif-bold", "DejaVu Serif", 700, os.path.join(MPL_TTF, "DejaVuSerif-Bold.ttf")),
    ("inter-regular", "Inter", 400, os.path.join(INTER, "Inter-Regular.otf")),
    ("inter-medium", "Inter", 500, os.path.join(INTER, "Inter-Medium.otf")),
    ("inter-semibold", "Inter", 600, os.path.join(INTER, "Inter-SemiBold.otf")),
    ("inter-bold", "Inter", 700, os.path.join(INTER, "Inter-Bold.otf")),
]
CHARS = [chr(c) for c in range(0x20, 0x7F)] + list("−×µ²³√°±·—–…→←↑↓•’‘“”")
# DejaVu faces also carry these whole Unicode blocks (every code point the font maps), so labels
# with accents, Greek letters, typographic punctuation, arrows, math, box drawing (tree views:
# └ ├ │), blocks and geometric shapes render as matplotlib draws them. Characters outside the baked
# set fall back to .notdef with matplotlib's "Glyph N missing from font(s)" warning.
DEJAVU_BLOCKS = [
    (0x00A0, 0x017F),  # Latin-1 Supplement, Latin Extended-A
    (0x0391, 0x03C9),  # Greek letters
    (0x2000, 0x206F),  # General Punctuation
    (0x2070, 0x209F),  # Superscripts and Subscripts
    (0x20A0, 0x20CF),  # Currency Symbols
    (0x2190, 0x21FF),  # Arrows
    (0x2200, 0x22FF),  # Mathematical Operators
    (0x2500, 0x257F),  # Box Drawing
    (0x2580, 0x259F),  # Block Elements
    (0x25A0, 0x25FF),  # Geometric Shapes
    (0x2713, 0x2718),  # Dingbats: check marks and ballot x
]
DEJAVU_CHARS = list(dict.fromkeys(CHARS + [chr(c) for a, b in DEJAVU_BLOCKS for c in range(a, b + 1)]))
FEATURES = ["ccmp", "locl", "rlig", "calt", "clig", "liga"]


def langsys_lookups(table, features):
    """Lookup indices for `features` under latn (else DFLT) default language system."""
    recs = {s.ScriptTag: s.Script for s in table.ScriptList.ScriptRecord}
    script = recs.get("latn") or recs.get("DFLT")
    if script is None or script.DefaultLangSys is None:
        return []
    feats = table.FeatureList.FeatureRecord
    idx = set()
    for fi in script.DefaultLangSys.FeatureIndex:
        if feats[fi].FeatureTag in features:
            idx.update(feats[fi].Feature.LookupListIndex)
    return sorted(idx)


def subtables(lookup):
    for st in lookup.SubTable:
        if lookup.LookupType in (7, 9):
            yield st.ExtensionLookupType, st.ExtSubTable
        else:
            yield lookup.LookupType, st


def bake(slug, family, weight, path):
    t = TTFont(path)
    order = t.getGlyphOrder()
    gid = {n: i for i, n in enumerate(order)}
    cmap = t.getBestCmap()
    chars = [c for c in (DEJAVU_CHARS if slug.startswith("dejavu") else CHARS) if ord(c) in cmap]
    gsub = t["GSUB"].table if "GSUB" in t else None
    roots = langsys_lookups(gsub, FEATURES) if gsub else []

    # glyph closure under every reachable substitution (nested lookups included)
    closure = {cmap[ord(c)] for c in chars} | {".notdef"}
    def nested(st):
        for rs in ("SubstLookupRecord",):
            for r in getattr(st, rs, []) or []:
                yield r.LookupListIndex
        for rsname in ("ChainSubRuleSet", "ChainSubClassSet", "SubRuleSet", "SubClassSet"):
            for rset in getattr(st, rsname, []) or []:
                if rset is None:
                    continue
                for rule in (getattr(rset, "ChainSubRule", None) or getattr(rset, "ChainSubClassRule", None)
                             or getattr(rset, "SubRule", None) or getattr(rset, "SubClassRule", None) or []):
                    for r in rule.SubstLookupRecord:
                        yield r.LookupListIndex
    used = set()
    stack = list(roots)
    while stack:
        li = stack.pop()
        if li in used:
            continue
        used.add(li)
        for ty, st in subtables(gsub.LookupList.Lookup[li]):
            if ty in (5, 6):
                stack.extend(nested(st))
    changed = True
    while changed:
        changed = False
        for li in used:
            for ty, st in subtables(gsub.LookupList.Lookup[li]):
                outs = []
                if ty == 1:
                    outs = [o for i, o in st.mapping.items() if i in closure]
                elif ty == 4:
                    for first, ligs in st.ligatures.items():
                        if first in closure:
                            outs += [l.LigGlyph for l in ligs if all(c in closure for c in l.Component)]
                for o in outs:
                    if o not in closure:
                        closure.add(o); changed = True
    G = lambda names: sorted(gid[n] for n in names if n in closure)
    cov = lambda c: [gid[n] for n in c.glyphs if n in closure] if c is not None else []
    cdef = lambda cd: {str(gid[n]): k for n, k in (cd.classDefs.items() if cd else []) if n in closure}
    recs = lambda rs: [[r.SequenceIndex, r.LookupListIndex] for r in rs]

    lookups, skipped = {}, []
    for li in sorted(used):
        L = gsub.LookupList.Lookup[li]
        subs = []
        for ty, st in subtables(L):
            fmt = getattr(st, "Format", None)
            if ty == 1:
                subs.append({"t": 1, "map": [[gid[i], gid[o]] for i, o in st.mapping.items() if i in closure]})
            elif ty == 4:
                ligs = []
                for first, lst in st.ligatures.items():
                    if first not in closure:
                        continue
                    for l in lst:
                        if all(c in closure for c in l.Component):
                            ligs.append([gid[first]] + [gid[c] for c in l.Component] + [gid[l.LigGlyph]])
                subs.append({"t": 4, "ligs": ligs})
            elif ty == 5 and fmt == 3:
                subs.append({"t": 5, "f": 3, "inp": [cov(c) for c in st.Coverage], "recs": recs(st.SubstLookupRecord)})
            elif ty == 6 and fmt == 1:
                rules = []
                for g, rset in zip(st.Coverage.glyphs, st.ChainSubRuleSet):
                    if g not in closure or rset is None:
                        continue
                    for r in rset.ChainSubRule:
                        rules.append({"g": gid[g], "bt": [gid.get(n, -1) for n in r.Backtrack], "inp": [gid.get(n, -1) for n in r.Input],
                                      "la": [gid.get(n, -1) for n in r.LookAhead], "recs": recs(r.SubstLookupRecord)})
                subs.append({"t": 6, "f": 1, "rules": rules})
            elif ty == 6 and fmt == 2:
                sets = []
                for c, cset in enumerate(st.ChainSubClassSet or []):
                    if cset is None:
                        continue
                    for r in cset.ChainSubClassRule:
                        sets.append({"c": c, "bt": list(r.Backtrack), "inp": list(r.Input), "la": list(r.LookAhead), "recs": recs(r.SubstLookupRecord)})
                subs.append({"t": 6, "f": 2, "cov": cov(st.Coverage), "bcd": cdef(st.BacktrackClassDef), "icd": cdef(st.InputClassDef),
                             "lcd": cdef(st.LookAheadClassDef), "rules": sets})
            elif ty == 6 and fmt == 3:
                subs.append({"t": 6, "f": 3, "bt": [cov(c) for c in st.BacktrackCoverage], "inp": [cov(c) for c in st.InputCoverage],
                             "la": [cov(c) for c in st.LookAheadCoverage], "recs": recs(st.SubstLookupRecord)})
            else:
                skipped.append((li, ty, fmt))
        lookups[str(li)] = {"flag": L.LookupFlag, "subs": subs}

    gdef = t["GDEF"].table if "GDEF" in t else None
    gclass = {str(gid[n]): k for n, k in (gdef.GlyphClassDef.classDefs.items() if gdef and gdef.GlyphClassDef else []) if n in closure}

    # kerning: GPOS 'kern' (pair positioning) under latn/DFLT, else the legacy 'kern' table
    kern = {}
    gpos = t["GPOS"].table if "GPOS" in t else None
    kl = langsys_lookups(gpos, ["kern"]) if gpos else []
    for li in kl:
        for ty, st in subtables(gpos.LookupList.Lookup[li]):
            if ty != 2:
                continue
            if st.Format == 1:
                for g1, ps in zip(st.Coverage.glyphs, st.PairSet):
                    if g1 not in closure:
                        continue
                    for pvr in ps.PairValueRecord:
                        if pvr.SecondGlyph in closure and pvr.Value1 is not None:
                            kern.setdefault(f"{gid[g1]},{gid[pvr.SecondGlyph]}", getattr(pvr.Value1, "XAdvance", 0) or 0)
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs if st.ClassDef1 else {}
                c2 = st.ClassDef2.classDefs if st.ClassDef2 else {}
                for g1 in st.Coverage.glyphs:
                    if g1 not in closure:
                        continue
                    row = st.Class1Record[c1.get(g1, 0)].Class2Record
                    for g2 in sorted(closure, key=gid.get):
                        v = row[c2.get(g2, 0)].Value1
                        x = getattr(v, "XAdvance", 0) if v is not None else 0
                        # a class match applies even when zero: HarfBuzz stops at the first subtable that covers the pair
                        kern.setdefault(f"{gid[g1]},{gid[g2]}", x or 0)
    if not kl and "kern" in t:
        for st in t["kern"].kernTables:
            for (l, r), v in st.kernTable.items():
                if l in closure and r in closure:
                    kern.setdefault(f"{gid[l]},{gid[r]}", v)
    kern = {k: v for k, v in kern.items() if v != 0}

    # outlines and metrics
    gs = t.getGlyphSet()
    is_tt = "glyf" in t
    glyphs, outlines, offsets = {}, {}, {}

    def tt_parts(name):
        """Contours of a TrueType glyph in each simple glyph's own units, with the component offsets
        above it: FreeType scales a composite's points per component and adds each FT_MulFix'd
        offset (TT_Process_Composite_Component; unhinted, so ROUND_XY_TO_GRID does not apply)."""
        gl = t["glyf"][name]
        if gl.isComposite():
            out = []
            for c in gl.components:
                if hasattr(c, "transform") or not hasattr(c, "x"):
                    sys.exit(f"{slug}: {name}: scaled or point-matched components are not supported")
                out += [(flat, offs + [c.x, c.y]) for flat, offs in tt_parts(c.glyphName)]
            return out
        if gl.numberOfContours == 0:
            return []
        coords, ends, flags = gl.getCoordinates(t["glyf"])
        res, start = [], 0
        for e in ends:
            flat = []
            for i in range(start, e + 1):
                flat += [int(coords[i][0]), int(coords[i][1]), int(flags[i] & 1)]
            res.append((flat, []))
            start = e + 1
        return res

    for name in sorted(closure, key=gid.get):
        g = gid[name]
        adv = t["hmtx"][name][0]
        contours = []
        local = None
        if is_tt:
            parts = tt_parts(name)
            # resolved contours for the control box; local ones + offsets for rendering
            for flat, offs in parts:
                dx, dy = sum(offs[0::2]), sum(offs[1::2])
                contours.append([v + (dx if i % 3 == 0 else dy if i % 3 == 1 else 0) for i, v in enumerate(flat)])
            if any(offs for _, offs in parts):
                local = [flat for flat, _ in parts]
                offsets[str(g)] = [offs for _, offs in parts]
        else:
            pen = RecordingPen(); gs[name].draw(pen)
            cur = None
            for op, args in pen.value:
                if op == "moveTo":
                    cur = [int(args[0][0]), int(args[0][1]), 1]
                elif op == "lineTo":
                    cur += [int(args[0][0]), int(args[0][1]), 1]
                elif op == "curveTo":
                    (a, b, c) = args
                    cur += [int(a[0]), int(a[1]), 2, int(b[0]), int(b[1]), 2, int(c[0]), int(c[1]), 1]
                elif op in ("closePath", "endPath"):
                    # FreeType's CFF builder drops a closing point equal to the first one
                    if len(cur) > 3 and cur[-3:-1] == cur[0:2] and cur[-1] == 1:
                        cur = cur[:-3]
                    contours.append(cur); cur = None
                else:
                    sys.exit(f"{slug}: unexpected pen op {op}")
        xs = [c[i] for c in contours for i in range(0, len(c), 3)]
        ys = [c[i + 1] for c in contours for i in range(0, len(c), 3)]
        box = [min(xs), max(xs), min(ys), max(ys)] if xs else [0, 0, 0, 0]
        glyphs[str(g)] = [adv, *box]
        outlines[str(g)] = local if local is not None else contours

    # Text._get_layout's minimum ascent/descent/line gap: OS/2 typo metrics, else hhea
    if "OS/2" in t:
        typo = [t["OS/2"].sTypoAscender, -t["OS/2"].sTypoDescender, t["OS/2"].sTypoLineGap]
    else:
        typo = [t["hhea"].ascent, -t["hhea"].descent, t["hhea"].lineGap]
    # every code point the font maps, as [first, last] runs: tells "not in this font" (matplotlib's
    # missing-glyph warning) apart from "in the font but not baked into mpljs"
    cover = []
    for cp in sorted(cmap):
        if cover and cover[-1][1] == cp - 1:
            cover[-1][1] = cp
        else:
            cover.append([cp, cp])
    data = dict(family=family, weight=weight, upm=t["head"].unitsPerEm, typo=typo,
                cmap={c: gid[cmap[ord(c)]] for c in chars}, cover=cover, glyphs=glyphs, outlines=outlines, offsets=offsets, kern=kern,
                gsub=dict(order=sorted(int(i) for i in roots), lookups=lookups, gclass=gclass))
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT, f"{slug}.json"), "w") as f:
        f.write(body)
    print(f"{slug:18} {len(chars)} chars, {len(closure)} glyphs, {len(kern)} kern pairs, {len(lookups)} gsub lookups"
          + (f", skipped {skipped}" if skipped else "") + f", {len(body) / 1024:.0f} KiB")


# python3 scripts/gen_fonts.py [slug ...]   (no slugs: every face)
only = set(sys.argv[1:])
for face in FACES:
    if not only or face[0] in only:
        bake(*face)
# pack the baked JSON into src/fonts/<slug>.ts (and check that it round-trips exactly)
import subprocess
subprocess.run(["node", os.path.join(os.path.dirname(__file__), "encode_fonts.ts"), OUT], check=True)
