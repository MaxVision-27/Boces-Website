"""Builds forms/help-desk-template.docx from the school's blank Help Desk
Ticket. After each field label it adds a run holding {{KEY}}, copying the
label's formatting; js/main.js swaps the keys for the ticket's values.
Two fixes so the page renders the same in a browser (docx-preview) as in
Word: the consent checkboxes use a character only Word draws as a box, so
they become a standard box (☐), and the header's content control is
unwrapped (docx-preview skips them), keeping its text and formatting.
Nothing else changes. Rerun when the school's form changes:

    python3 scripts/make-help-desk-template.py "BLANK Help Desk Ticket.docx"
"""
import html
import re
import sys
import zipfile

SOURCE = sys.argv[1] if len(sys.argv) > 1 else 'BLANK Help Desk Ticket.docx'
OUT = 'forms/help-desk-template.docx'

# (label as it reads in the document, key). Order doesn't matter; a label
# that appears twice (Date:, Intake) gets the key both times.
FIELDS = [
    ('INTAKE NUMBER:', 'INTAKE'), ('Intake Number:', 'INTAKE'),
    ('Customer Name:', 'CUSTOMER'), ('Customer’s Name (Please Print):', 'CUSTOMER'),
    ('Contact Number:', 'CONTACT'), ('Class Name:', 'CLASS'), ('Room Number:', 'ROOM'),
    ('Computer Make/Model:', 'MODEL'), ('Serial Tag:', 'SERIAL'), ('Computer Password:', 'PASSWORD'),
    ('Problem Description:', 'PROBLEM'), ('Receiving Tech:', 'TECH'), ('Date:', 'DATE'),
]

RUN = re.compile(r'<w:r(?:\s[^>]*)?>.*?</w:r>', re.S)
TEXT = re.compile(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', re.S)
RPR = re.compile(r'<w:rPr>.*?</w:rPr>', re.S)
SDT = re.compile(r'<w:sdt>.*?<w:sdtContent>(.*?)</w:sdtContent></w:sdt>', re.S)
WORD_ONLY_BOX = '\U000E01B9'


def fill_paragraph(p):
    runs = [(m.start(), m.end(), m.group(0)) for m in RUN.finditer(p)]
    # Where each run's text sits in the paragraph's plain text
    spans, text = [], ''
    for start, end, run in runs:
        t = html.unescape(''.join(TEXT.findall(run)))
        spans.append((len(text), len(text) + len(t)))
        text += t

    inserts = []  # (position in p, run xml)
    for label, key in FIELDS:
        for m in re.finditer(re.escape(label), text):
            last = m.end() - 1
            i = next(i for i, (a, b) in enumerate(spans) if a <= last < b)
            rpr = RPR.search(runs[i][2])
            inserts.append((runs[i][1], f'<w:r>{rpr.group(0) if rpr else ""}<w:t xml:space="preserve"> {{{{{key}}}}}</w:t></w:r>'))
    for pos, run in sorted(inserts, reverse=True):
        p = p[:pos] + run + p[pos:]
    return p, len(inserts)


with zipfile.ZipFile(SOURCE) as src:
    xml = src.read('word/document.xml').decode('utf8')
    total = 0

    def repl(m):
        global total
        p, n = fill_paragraph(m.group(0))
        total += n
        return p

    xml = re.sub(r'<w:p[ >].*?</w:p>', repl, xml, flags=re.S).replace(WORD_ONLY_BOX, '☐')
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as out:
        for item in src.infolist():
            if item.filename == 'word/document.xml':
                data = xml.encode('utf8')
            elif re.fullmatch(r'word/(header|footer)\d+\.xml', item.filename):
                data = SDT.sub(r'\1', src.read(item.filename).decode('utf8')).encode('utf8')
            else:
                data = src.read(item.filename)
            out.writestr(item, data)

print(f'{OUT}: {total} fields')
