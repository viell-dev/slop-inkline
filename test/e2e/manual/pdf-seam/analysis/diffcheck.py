"""Compares original and patched rasters: where they differ, by how much, and
whether every differing pixel lies within 1.5 px of a symbol's box edge.
Usage: python3 -I diffcheck.py <sweep dir> <host> <name> <renderer> <dpi>"""
import json, sys
import numpy as np
from PIL import Image
root, host, name, renderer, dpi = sys.argv[1:6]
dpi = int(dpi)
a = np.asarray(Image.open(f"{root}/orig/{host}/{name}-{renderer}-{dpi}.png").convert("L"), dtype=int)
b = np.asarray(Image.open(f"{root}/patched/{host}/{name}-{renderer}-{dpi}.png").convert("L"), dtype=int)
d = np.abs(a - b)
ys, xs = np.nonzero(d)
boxes = json.load(open(f"{root}/orig/{host}/{name}.boxes.json"))
s = dpi / 72
near = np.zeros_like(d, dtype=bool)
for sym in boxes:
    L, T, R, B = (v * s for v in sym["box"])
    for x in (L, R):
        near[int(T) - 2 : int(B) + 3, max(0, int(x) - 2) : int(x) + 3] = True
    for y in (T, B):
        near[max(0, int(y) - 2) : int(y) + 3, int(L) - 2 : int(R) + 3] = True
print(f"{host} {renderer}-{dpi}: {len(xs)} pixels differ, max {d.max()}, "
      f"{int((d > 0)[~near].sum())} of them away from box edges; "
      f"patched darker anywhere: {int((b < a).sum())}")
