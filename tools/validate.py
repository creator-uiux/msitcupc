"""Validation: HTML well-formedness, for/id pairs, dead internal links, script refs."""
import html.parser, os, sys, re, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
fail = 0

class P(html.parser.HTMLParser):
    VOID = {'meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'col', 'area', 'base', 'embed', 'param', 'track', 'wbr'}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.ids, self.fors, self.hrefs, self.srcs, self.errors = [], [], [], [], [], []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if 'id' in d: self.ids.append(d['id'])
        if 'for' in d: self.fors.append(d['for'])
        if 'href' in d: self.hrefs.append(d['href'])
        if 'src' in d: self.srcs.append(d['src'])
        if tag not in self.VOID: self.stack.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in self.VOID: return
        if not self.stack:
            self.errors.append('stray </%s> at %s' % (tag, self.getpos())); return
        if self.stack[-1][0] == tag:
            self.stack.pop()
        else:
            # look back for match (implicit close tolerance)
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    self.errors.append('implicitly closed %s before %s at %s' %
                                       ([t for t, _ in self.stack[i + 1:]], tag, self.getpos()))
                    del self.stack[i:]
                    return
            self.errors.append('unexpected </%s> at %s' % (tag, self.getpos()))

files = sorted(glob.glob(os.path.join(ROOT, '*.html')))
# skip transient harness files the QA tools drop next to the pages
files = [f for f in files if not os.path.basename(f).startswith('__')]
for f in files:
    name = os.path.basename(f)
    src = open(f, encoding='utf-8').read()
    p = P(); p.feed(src)
    errs = list(p.errors)
    for tag, pos in p.stack:
        errs.append('unclosed <%s> opened at %s' % (tag, pos))
    # duplicate ids
    seen = set()
    for i in p.ids:
        if i in seen: errs.append('duplicate id: %s' % i)
        seen.add(i)
    # for -> id
    for fr in p.fors:
        if fr not in p.ids: errs.append('label for missing id: %s' % fr)
    # internal links
    for h in p.hrefs:
        if h.startswith(('http', '#', 'mailto')): continue
        target = h.split('?')[0].split('#')[0]
        if not target or ':' in target: continue
        # "/x" is web-root-absolute; the site root is this folder.
        if not os.path.exists(os.path.join(ROOT, target.lstrip('/'))):
            errs.append('dead href: %s' % h)
    for s in p.srcs:
        t = s.split('?')[0].split('#')[0]
        if t and not t.startswith(('http', 'data:')) and not os.path.exists(os.path.join(ROOT, t.lstrip('/'))):
            errs.append('dead src: %s' % s)
    if errs:
        fail += 1
        print('FAIL %s' % name)
        for e in errs: print('     %s' % e)
    else:
        print('  ok %s  (%d ids, %d links)' % (name, len(p.ids), len(p.hrefs) + len(p.srcs)))

# ids referenced from JS getElementById must exist in the same page (best effort: literal string check)
js_id_pat = re.compile(r"getElementById\('([^']+)'\)")
for f in files:
    name = os.path.basename(f)
    src = open(f, encoding='utf-8').read()
    ids_in_js = set(js_id_pat.findall(src))
    static = set(re.findall(r'id="([^"]+)"', src))
    missing = ids_in_js - static
    # ids created dynamically inside JS strings (id="..." appears in JS too) are caught by same regex above
    if missing:
        fail += 1
        print('FAIL %s references missing ids: %s' % (name, ', '.join(sorted(missing))))
    else:
        print('  ok %s all getElementById targets exist' % name)

print()
print('VALIDATION', 'FAILED (%d)' % fail if fail else 'PASSED')
sys.exit(1 if fail else 0)
