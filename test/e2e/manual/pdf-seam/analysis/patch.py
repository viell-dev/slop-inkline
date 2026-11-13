"""Removes Skia's first, inverted-shape pass from every masked symbol.

Usage: python3 -I patch.py <in.qdf.pdf> <out.qdf.pdf>
Run fix-qdf on the output afterwards. Each masked symbol's form draws its
content twice: under an SMask whose transfer function inverts the alpha of
a rectangle filling the form's bounding box, and under the image's own alpha.
This drops the first draw only, and checks that its graphics state is the
inverted one.
"""
import re
import sys

data = open(sys.argv[1], "rb").read()
# Graphics states whose soft mask has a transfer function.
inverted = set()
for m in re.finditer(rb"\n(\d+) 0 obj\n<<\n  /SMask <<(.*?)>>\n  /Type /ExtGState\n>>", data, re.S):
    if b"/TR" in m.group(2):
        inverted.add(m.group(1))
# Resource names to objects, as /G13 13 0 R.
names = dict(re.findall(rb"/(G\d+) (\d+) 0 R", data))
pattern = re.compile(rb"/(G\d+) gs\n/(X\d+) Do\n(/G\d+ gs\n)(/G\d+ gs\n/\2 Do\n)")
count = 0


def drop(m):
    global count
    if names.get(m.group(1)) in inverted:
        count += 1
        return m.group(3) + m.group(4)
    return m.group(0)


data = pattern.sub(drop, data)
open(sys.argv[2], "wb").write(data)
print(f"dropped {count} inverted passes; inverted states {sorted(inverted)}")
