"""One-time: turn the blank WBL Hours .docx into a fill-in template.

Only underscore characters change: each underscore fragment of a blank (a blank's
underscores are often split across several runs) becomes {{KEY.i:n}} in place,
where i is the fragment's order within the blank and n its underscore count.
Runs, formatting, spacing and every other byte of the file stay exactly as they
were, so a template filled with no values is byte-identical to the original.
"""
import re, sys, zipfile

src, dst = sys.argv[1], sys.argv[2]
NUM = {'ONE': 1, 'TWO': 2, 'THREE': 3, 'FOUR': 4, 'FIVE': 5}
TOKEN = re.compile(r'<w:tab/>|(<w:t(?: [^>]*)?>)(.*?)</w:t>', re.S)

def keys_for(text, state):
    date = re.search(r'DATE \((ONE|TWO|THREE|FOUR|FIVE)\)', text)
    if 'DEVICE:' in text:
        return ['DEVICE']
    if 'SESSION:' in text:
        return ['AM', 'PM']
    if date:
        n = NUM[date.group(1)]
        return [f'DATE{n}', f'START{n}', f'END{n}']
    if 'STUDENT NAME(S)' in text or (state['names'] and '_' in text and not text.replace('_', '').strip()):
        state['names'] += 2
        return [f'NAME{state["names"] - 1}', f'NAME{state["names"]}']
    return None

def templatize(para, state, report):
    toks = list(TOKEN.finditer(para))
    texts = ['\t' if t.group(0) == '<w:tab/>' else t.group(2) for t in toks]
    full = ''.join(texts)
    keys = keys_for(full, state)
    if keys is None:
        return para
    assert '&' not in full, 'entities would break character positions'
    blanks = [m.span() for m in re.finditer(r'_+', full)]
    assert len(blanks) == len(keys), (full, keys)

    def blank_of(pos):
        return next(k for k, (s, e) in enumerate(blanks) if s <= pos < e)

    out, last, pos, frag = [], 0, 0, {}
    for tok, text in zip(toks, texts):
        if tok.group(1) and '_' in text:
            new = ''
            for m in re.finditer(r'_+|[^_]+', text):
                if m.group(0)[0] != '_':
                    new += m.group(0)
                    continue
                k = blank_of(pos + m.start())
                i = frag.get(k, 0)
                frag[k] = i + 1
                new += '{{%s.%d:%d}}' % (keys[k], i, len(m.group(0)))
            out.append(para[last:tok.start(2)] + new)
            last = tok.end(2)
        pos += len(text)
    out.append(para[last:])
    report.append((keys, full.replace('\t', ' ').strip()))
    return ''.join(out)

zin = zipfile.ZipFile(src)
xml = zin.read('word/document.xml').decode('utf-8')
state, report = {'names': 0}, []
xml = re.sub(r'<w:p[ >](?:(?!<w:p[ >]).)*?</w:p>', lambda m: templatize(m.group(0), state, report), xml, flags=re.S)

with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = xml.encode('utf-8') if item.filename == 'word/document.xml' else zin.read(item.filename)
        zout.writestr(item, data)

for keys, text in report:
    print(f'{",".join(keys):<20} {text}')
