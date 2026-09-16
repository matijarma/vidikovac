"""Builds docs/prijava/prijedlog-projekta.docx, the written proposal as a Word file,
from the same Markdown masters and figure placement as scripts/build-prijava.mjs.

Figures come in as PNG captures of the rendered HTML (review.local/prijava-doc/docx,
made by review.local/prijava-doc/capture-figs.mjs); tables stay native Word tables.
Document properties name the applicant: author Matija Radeljak, company Aning Film d.o.o.

Run:  node review.local/prijava-doc/capture-figs.mjs && python scripts/build-prijava-docx.py
"""
import io, json, os, re, sys, zipfile, datetime, shutil
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.opc.constants import RELATIONSHIP_TYPE as RT

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIG_DIR = os.path.join(ROOT, "review.local", "prijava-doc", "docx")
OUT = os.path.join(ROOT, "docs", "prijava", "prijedlog-projekta.docx")

INK = RGBColor(0x0C, 0x12, 0x50)
MUTED = RGBColor(0x4A, 0x51, 0x78)
LABEL = RGBColor(0x36, 0x3D, 0x73)
ACCENT = RGBColor(0x03, 0x40, 0x9C)
FONT = "Calibri"
MONO = "Consolas"

def rd(rel):
    return io.open(os.path.join(ROOT, rel), encoding="utf-8").read()

# ---------------------------------------------------------------- markdown
def parse_blocks(md):
    lines = md.replace("\r\n", "\n").split("\n")
    blocks, i = [], 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1; continue
        if line.startswith("<!--"):
            while i < len(lines) and "-->" not in lines[i]: i += 1
            i += 1; continue
        m = re.match(r"^(#{1,6}) (.*)$", line)
        if m:
            blocks.append({"type": "h", "level": len(m.group(1)), "text": m.group(2).strip()}); i += 1; continue
        if line.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"): rows.append(lines[i]); i += 1
            blocks.append({"type": "table", "rows": rows}); continue
        if re.match(r"^- ", line):
            items = []
            while i < len(lines) and re.match(r"^- ", lines[i]): items.append(lines[i][2:]); i += 1
            blocks.append({"type": "ul", "items": items}); continue
        if re.match(r"^\d+\. ", line):
            items = []
            while i < len(lines) and re.match(r"^\d+\. ", lines[i]): items.append(re.sub(r"^\d+\. ", "", lines[i])); i += 1
            blocks.append({"type": "ol", "items": items}); continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#{1,6} |\||- |\d+\. |<!--)", lines[i]):
            buf.append(lines[i]); i += 1
        blocks.append({"type": "p", "lines": buf})
    return blocks

INLINE_RE = re.compile(r"(\*\*\(plan: M\d+[a-z]?\)\*\*|\*\*.+?\*\*|`[^`]+`|https?://[^\s<)]+)")

def add_inline(paragraph, text, base_size=None, color=None):
    """Runs for **strong**, `code`, bare URLs and plan markers; ' -- ' becomes an en dash."""
    text = text.replace(" -- ", " – ")
    pos = 0
    for m in INLINE_RE.finditer(text):
        if m.start() > pos: _run(paragraph, text[pos:m.start()], size=base_size, color=color)
        tok = m.group(0)
        if tok.startswith("**(plan:"):
            r = _run(paragraph, tok[3:-3], size=base_size, color=ACCENT); r.bold = True
        elif tok.startswith("**"):
            r = _run(paragraph, tok[2:-2], size=base_size, color=color); r.bold = True
        elif tok.startswith("`"):
            r = _run(paragraph, tok[1:-1], size=(base_size or 11) - 1, color=color); r.font.name = MONO
            _east_asia(r, MONO)
        else:
            url = tok
            tail = ""
            while url and url[-1] in ".,;:": tail = url[-1] + tail; url = url[:-1]
            _hyperlink(paragraph, url, url, size=base_size)
            if tail: _run(paragraph, tail, size=base_size, color=color)
        pos = m.end()
    if pos < len(text): _run(paragraph, text[pos:], size=base_size, color=color)

def _east_asia(run, name):
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts"); rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"): rfonts.set(qn(attr), name)

def _run(paragraph, text, size=None, color=None, bold=None, italic=None, font=None):
    r = paragraph.add_run(text)
    if size: r.font.size = Pt(size)
    if color is not None: r.font.color.rgb = color
    if bold is not None: r.bold = bold
    if italic is not None: r.italic = italic
    if font: r.font.name = font; _east_asia(r, font)
    return r

def _hyperlink(paragraph, url, text, size=None):
    part = paragraph.part
    r_id = part.relate_to(url, RT.HYPERLINK, is_external=True)
    link = OxmlElement("w:hyperlink"); link.set(qn("r:id"), r_id)
    new_run = OxmlElement("w:r"); rpr = OxmlElement("w:rPr")
    style = OxmlElement("w:rStyle"); style.set(qn("w:val"), "Hyperlink"); rpr.append(style)
    if size:
        sz = OxmlElement("w:sz"); sz.set(qn("w:val"), str(int(size * 2))); rpr.append(sz)
    new_run.append(rpr)
    t = OxmlElement("w:t"); t.text = text; t.set(qn("xml:space"), "preserve"); new_run.append(t)
    link.append(new_run); paragraph._p.append(link)

# ---------------------------------------------------------------- document
def set_style_font(style, name=FONT, size=None, color=None, bold=None):
    style.font.name = name
    rpr = style.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None: rfonts = OxmlElement("w:rFonts"); rpr.append(rfonts)
    for attr in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"): rfonts.set(qn(attr), name)
    for attr in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
        if rfonts.get(qn(attr)) is not None: del rfonts.attrib[qn(attr)]
    lang = rpr.find(qn("w:lang"))
    if lang is None: lang = OxmlElement("w:lang"); rpr.append(lang)
    lang.set(qn("w:val"), "hr-HR"); lang.set(qn("w:eastAsia"), "hr-HR"); lang.set(qn("w:bidi"), "ar-SA")
    if size: style.font.size = Pt(size)
    if color is not None: style.font.color.rgb = color
    if bold is not None: style.font.bold = bold

def shade(cell, hex_fill):
    tcpr = cell._element.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_fill)
    tcpr.append(shd)

def add_field(paragraph, instr, size=9, color=MUTED):
    r = paragraph.add_run()
    for tag, attrs, text in (("w:fldChar", {"w:fldCharType": "begin"}, None), ("w:instrText", {"xml:space": "preserve"}, instr), ("w:fldChar", {"w:fldCharType": "separate"}, None), ("w:t", {}, "1"), ("w:fldChar", {"w:fldCharType": "end"}, None)):
        el = OxmlElement(tag)
        for k, v in attrs.items(): el.set(qn(k), v)
        if text is not None: el.text = text
        r._element.append(el)
    r.font.size = Pt(size); r.font.color.rgb = color

def caption(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2); p.paragraph_format.space_after = Pt(12)
    _run(p, text, size=9, color=MUTED, italic=True)

def figure(doc, fig_id, manifests, warnings, width_cm=16.5):
    path = os.path.join(FIG_DIR, f"{fig_id}.png")
    if not os.path.exists(path):
        warnings.append(f"figure image missing: {fig_id}"); return
    p = doc.add_paragraph(); p.paragraph_format.space_before = Pt(8); p.paragraph_format.keep_with_next = True
    p.add_run().add_picture(path, width=Cm(width_cm))
    meta = manifests.get(fig_id, {})
    if meta.get("caption"): caption(doc, meta["caption"])

def table(doc, rows, font_size=9):
    cells = lambda r: [c.strip() for c in r.strip().strip("|").split("|")]
    head = cells(rows[0]); body = [cells(r) for r in rows[2:]]
    t = doc.add_table(rows=1, cols=len(head)); t.style = doc.styles["Table Grid"]; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = True
    for j, h in enumerate(head):
        c = t.rows[0].cells[j]; c.text = ""; shade(c, "EBE8DF")
        p = c.paragraphs[0]; r = _run(p, h, size=font_size - 0.5, color=LABEL, bold=True)
    for row in body:
        rc = t.add_row().cells
        for j, val in enumerate(row[:len(head)]):
            rc[j].text = ""; p = rc[j].paragraphs[0]
            add_inline(p, val, base_size=font_size, color=INK)
            if j == 0:
                for r in p.runs: r.bold = True
    for row in t.rows:
        for c in row.cells:
            for p in c.paragraphs:
                p.paragraph_format.space_after = Pt(2); p.paragraph_format.space_before = Pt(2)
    doc.add_paragraph().paragraph_format.space_after = Pt(4)

def paragraph(doc, text, style=None, size=11):
    p = doc.add_paragraph(style=style) if style else doc.add_paragraph()
    add_inline(p, text, base_size=size, color=INK)
    p.paragraph_format.space_after = Pt(6)
    return p

def heading(doc, text, level):
    text = text.replace(" -- ", " – ")
    h = doc.add_heading(level=level)
    if text.startswith("Kaj ima"):
        _run(h, text)
    else:
        _run(h, text)
    return h

# ---------------------------------------------------------------- appendix mapping (as in the HTML build)
def appendix_blocks(rel, number, title):
    out = []
    for b in parse_blocks(rd(rel)):
        if b["type"] == "h":
            if b["level"] == 1: b = {"type": "h", "level": 2, "text": f"{number}. {title}"}
            elif b["level"] == 2: b = {**b, "level": 3}
        out.append(b)
    return out

def build():
    warnings = []
    manifests = {}
    fig_root = os.path.join(ROOT, "docs", "prijava", "figures")
    for name in os.listdir(fig_root):
        if name.startswith("manifest-") and name.endswith(".json"):
            for e in json.load(open(os.path.join(fig_root, name), encoding="utf-8")): manifests[e["id"]] = e
    placement = json.load(open(os.path.join(ROOT, "docs", "prijava", "src", "figures.json"), encoding="utf-8"))

    main = parse_blocks(rd("docs/prijava/prijedlog-projekta.md"))
    title = next(b["text"] for b in main if b["type"] == "h" and b["level"] == 1)
    first_p = next(i for i, b in enumerate(main) if b["type"] == "p")
    cover_meta = []
    for line in main[first_p]["lines"]:
        for m in re.finditer(r"\*\*([^*]+?):\*\*\s*([^*]+?)(?=\s*\*\*|$)", line):
            cover_meta.append((m.group(1).strip(), re.sub(r"\s*·\s*$", "", m.group(2).strip())))
    body = [b for i, b in enumerate(main) if i != first_p]
    note_at = next((i for i, b in enumerate(body) if b["type"] == "h" and b["level"] == 2 and b["text"].startswith("Opaska autora")), None)
    appendices = (appendix_blocks("docs/prijava/plan-provedbe.md", 9, "Plan provedbe")
                  + appendix_blocks("docs/prijava/obrazac-3-financijski-plan.md", 10, "Financijski plan (Obrazac 3)")
                  + appendix_blocks("docs/prijava/rizici-i-odgovori.md", 11, "Pitanja koja očekujemo i odgovori ugrađeni u proizvod"))
    blocks = body[:note_at] + appendices + body[note_at:] if note_at is not None else body + appendices

    doc = Document()
    # Page: A4, 2 cm margins
    for s in doc.sections:
        s.page_width = Cm(21.0); s.page_height = Cm(29.7)
        s.left_margin = s.right_margin = Cm(2.0); s.top_margin = Cm(2.0); s.bottom_margin = Cm(1.8)
    # Styles
    set_style_font(doc.styles["Normal"], FONT, 11, INK)
    doc.styles["Normal"].paragraph_format.space_after = Pt(6)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.15
    for lvl, size in ((1, 20), (2, 14.5), (3, 12.5)):
        st = doc.styles[f"Heading {lvl}"]
        set_style_font(st, FONT, size, INK, bold=True)
        st.paragraph_format.space_before = Pt(18 if lvl == 1 else 12); st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.keep_with_next = True
    set_style_font(doc.styles["Title"], FONT, 40, INK, bold=True)
    for name in ("List Bullet", "List Number", "Table Grid", "Header", "Footer"):
        set_style_font(doc.styles[name], FONT, 11 if name.startswith("List") else 9, INK if name.startswith("List") else MUTED)
    # Hyperlink style (default template has none)
    try:
        hl = doc.styles["Hyperlink"]
    except KeyError:
        from docx.enum.style import WD_STYLE_TYPE
        hl = doc.styles.add_style("Hyperlink", WD_STYLE_TYPE.CHARACTER)
    hl.font.color.rgb = ACCENT; hl.font.underline = True

    # Header and footer
    sec = doc.sections[0]
    hp = sec.header.paragraphs[0]; hp.text = ""
    _run(hp, "Kaj ima? · Zagreb, pri ruci. · Prijedlog projekta · Aning Film d.o.o.", size=9, color=MUTED)
    fp = sec.footer.paragraphs[0]; fp.text = ""; fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _run(fp, "Stranica ", size=9, color=MUTED); add_field(fp, "PAGE"); _run(fp, " od ", size=9, color=MUTED); add_field(fp, "NUMPAGES")

    # Cover
    k = doc.add_paragraph(); _run(k, "JAVNI POZIV GRADA ZAGREBA ZA PROJEKTE KORIŠTENJA OTVORENIH PODATAKA 2026. · PISANI PRIJEDLOG PROJEKTA", size=9, color=LABEL, bold=True)
    k.paragraph_format.space_before = Pt(36); k.paragraph_format.space_after = Pt(18)
    t = doc.add_paragraph(style="Title"); _run(t, "Kaj ima", size=40, color=INK, bold=True); _run(t, "?", size=40, color=ACCENT, bold=True)
    t.paragraph_format.space_after = Pt(0)
    sub = doc.add_paragraph(); _run(sub, "Zagreb, pri ruci.", size=18, color=MUTED); sub.paragraph_format.space_after = Pt(18)
    lead = doc.add_paragraph(); _run(lead, "Otvoreni podaci Zagreba kao javni interaktivni info-servis: deset minuta grada na vlastitom uređaju, otključano prisutnošću, bez računa, oglasa i praćenja.", size=13, color=INK)
    lead.paragraph_format.space_after = Pt(18)
    mt = doc.add_table(rows=0, cols=2); mt.autofit = True
    for label, value in cover_meta:
        cells = mt.add_row().cells
        cells[0].text = ""; _run(cells[0].paragraphs[0], label.upper(), size=8.5, color=LABEL, bold=True)
        cells[1].text = ""; add_inline(cells[1].paragraphs[0], value, base_size=10.5, color=INK)
        for c in cells:
            c.paragraphs[0].paragraph_format.space_after = Pt(4); c.paragraphs[0].paragraph_format.space_before = Pt(4)
    for row in mt.rows: row.cells[0].width = Cm(4.2); row.cells[1].width = Cm(12.8)
    sp = doc.add_paragraph(); sp.paragraph_format.space_after = Pt(6)
    live = os.path.join(FIG_DIR, "live-lane.png")
    if os.path.exists(live):
        lk = doc.add_paragraph(); _run(lk, "SADA U ZAGREBU · snimka otvorenih podataka, 15. 9. 2026. 19:51", size=8.5, color=LABEL, bold=True)
        lk.paragraph_format.space_before = Pt(12); lk.paragraph_format.keep_with_next = True
        pp = doc.add_paragraph(); pp.add_run().add_picture(live, width=Cm(16.5))
        caption(doc, "Iste pločice, isti izvori i ista stanja kao u aplikaciji: 275 vozila u pokretu, 39 zatvaranja, 21,4 °C na Maksimiru, tri potresa u 72 sata, DHMZ mirno. Na adresi zagreb.aningfilm.hr/prijava/ isti dokument te vrijednosti osvježava uživo.")
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    # Body with figure placement
    stack = []  # {level, text, pending, seen_p, seen_table}
    def flush(level):
        while stack and stack[-1]["level"] >= level:
            s = stack.pop()
            for pl in s["pending"]:
                if pl["position"] == "end": figure(doc, pl["id"], manifests, warnings)
    for b in blocks:
        if b["type"] == "h":
            if b["level"] == 1: continue
            flush(b["level"])
            pend = [p for p in placement if p["section"] == b["text"]]
            stack.append({"level": b["level"], "text": b["text"], "pending": pend, "seen_p": 0, "seen_table": 0})
            if b["level"] == 2 and not b["text"].startswith("Sažetak"):
                # a page break before every chapter except the first
                doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
            heading(doc, b["text"], 1 if b["level"] == 2 else 2 if b["level"] == 3 else 3)
            continue
        cur = stack[-1] if stack else None
        if b["type"] == "p":
            paragraph(doc, " ".join(b["lines"]))
            if cur is not None:
                cur["seen_p"] += 1
                if cur["seen_p"] == 1:
                    for pl in cur["pending"]:
                        if pl["position"] == "after-first-paragraph": figure(doc, pl["id"], manifests, warnings)
        elif b["type"] == "table":
            table(doc, b["rows"])
            if cur is not None:
                cur["seen_table"] += 1
                if cur["seen_table"] == 1:
                    for pl in cur["pending"]:
                        if pl["position"] == "after-first-table": figure(doc, pl["id"], manifests, warnings)
        elif b["type"] in ("ul", "ol"):
            for it in b["items"]:
                paragraph(doc, it, style="List Bullet" if b["type"] == "ul" else "List Number")
    flush(0)

    # Core properties
    cp = doc.core_properties
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    cp.title = "Kaj ima? Zagreb, pri ruci. Prijedlog projekta"
    cp.subject = "Javni poziv za dodjelu potpora male vrijednosti za financiranje projekata korištenja otvorenih podataka za 2026. (Grad Zagreb)"
    cp.author = "Matija Radeljak"
    cp.last_modified_by = "Matija Radeljak"
    cp.keywords = "Kaj ima?; otvoreni podaci; Grad Zagreb; data.zagreb.hr; javni zaslon; Aning Film d.o.o."
    cp.category = "Prijava na javni poziv"
    cp.comments = "Pisani prijedlog projekta (točka 4. alineja 8. Javnog poziva). Prijavitelj Aning Film d.o.o., Opatovina 25, 10000 Zagreb, OIB 52144444572."
    cp.language = "hr-HR"
    cp.created = now; cp.modified = now
    cp.revision = 1
    cp.identifier = "https://zagreb.aningfilm.hr/prijava/"
    cp.content_status = "Konačno"
    doc.save(OUT)

    # app.xml: Company and Manager, no tooling name
    tmp = OUT + ".tmp"
    with zipfile.ZipFile(OUT) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "docProps/app.xml":
                xml = data.decode("utf-8")
                xml = re.sub(r"<Application>.*?</Application>", "<Application>Microsoft Office Word</Application>", xml)
                # The template's stale counters (0 words, 1 page) go; Word recomputes them on save.
                for tag in ("TotalTime", "Pages", "Words", "Characters", "Lines", "Paragraphs", "CharactersWithSpaces"):
                    xml = re.sub(rf"\s*<{tag}>.*?</{tag}>", "", xml)
                xml = re.sub(r"\s*<Company\s*/>", "", xml); xml = re.sub(r"\s*<Company>.*?</Company>", "", xml)
                xml = re.sub(r"\s*<Manager\s*/>", "", xml); xml = re.sub(r"\s*<Manager>.*?</Manager>", "", xml)
                xml = xml.replace("</Properties>", "<Manager>Matija Radeljak</Manager><Company>Aning Film d.o.o.</Company></Properties>")
                data = xml.encode("utf-8")
            zout.writestr(item, data)
    shutil.move(tmp, OUT)
    return warnings

if __name__ == "__main__":
    w = build()
    print("written", OUT, os.path.getsize(OUT) // 1024, "KB")
    for x in w: print("warning:", x)
