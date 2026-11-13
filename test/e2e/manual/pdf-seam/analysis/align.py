"""Turns captures of Chromium's PDF viewer into page rasters for measure.py.

Usage: python3 -I align.py <capture dir> <pdf dir> <out dir>

A capture `<host>--<name>-chromewindow-<zoom>.png` shows the page at
zoom/100 * 96 px per inch, offset by the viewer's margins and scrolling.
The offset is found by cross-correlating the capture with PDFium's own
render of the page at that resolution. Writes `<name>-chrome<host>-<dpi>.png`
into `<out dir>/<pdf host>/`, with the part not captured left white, and
`.visible.json` beside it giving the captured rectangle in page pixels.
"""
import glob
import json
import os
import re
import shutil
import sys

import numpy as np
import pypdfium2 as pdfium
from PIL import Image

cap_dir, pdf_dir, out_dir = sys.argv[1:4]
viewer_host = os.path.basename(os.path.normpath(cap_dir))
for cap in sorted(glob.glob(os.path.join(cap_dir, "*-chromewindow-*.png"))):
    m = re.match(r"(.+?)--(.+)-chromewindow-(\d+)\.png$", os.path.basename(cap))
    host, name, zoom = m.group(1), m.group(2), int(m.group(3))
    dpi = 96 * zoom / 100
    pdf = os.path.join(pdf_dir, f"{host}--{name}.pdf")
    ref = pdfium.PdfDocument(pdf)[0].render(scale=dpi / 72).to_pil().convert("L")
    R = 255 - np.asarray(ref, dtype=np.float64)
    C = np.asarray(Image.open(cap).convert("L"), dtype=np.float64)
    # The viewer's dark surround (grey 40) would outweigh grey ink.
    C[(C > 30) & (C < 50)] = 255
    C = 255 - C
    # The viewer's grey surround is not ink: count only near-white page.
    capture_grey = np.asarray(Image.open(cap).convert("L"))
    # Search only near the page's white rectangle, found directly.
    mid = capture_grey[capture_grey.shape[0] // 2]
    left = int(np.argmax(mid > 250))
    column = capture_grey[:, left + 5]
    top = int(np.argmax(column > 250))
    best = None
    for dy in range(top - 6, top + 7):
        for dx in range(left - 6, left + 7):
            x0, y0 = max(0, -dx), max(0, -dy)
            x1 = min(R.shape[1], C.shape[1] - dx)
            y1 = min(R.shape[0], C.shape[0] - dy)
            score = float((C[y0 + dy : y1 + dy, x0 + dx : x1 + dx] * R[y0:y1, x0:x1]).sum())
            if best is None or score > best[0]:
                best = (score, dx, dy)
    _, dx, dy = best
    # Page pixel (x, y) is capture pixel (x + dx, y + dy).
    page = np.full(R.shape, 255, dtype=np.uint8)
    x0, y0 = max(0, -dx), max(0, -dy)
    x1 = min(R.shape[1], C.shape[1] - dx)
    y1 = min(R.shape[0], C.shape[0] - dy)
    page[y0:y1, x0:x1] = capture_grey[y0 + dy : y1 + dy, x0 + dx : x1 + dx]
    target = os.path.join(out_dir, host)
    os.makedirs(target, exist_ok=True)
    label = "chrome" + viewer_host.split("-")[0].replace(".", "")
    base = os.path.join(target, name)
    Image.fromarray(page).save(f"{base}-{label}-{int(dpi)}.png")
    with open(f"{base}-{label}-{int(dpi)}.visible.json", "w") as f:
        json.dump([int(x0), int(y0), int(x1), int(y1)], f)
    # How well it matched: mean absolute difference over the captured part.
    diff = np.abs(page[y0:y1, x0:x1].astype(int) - np.asarray(ref)[y0:y1, x0:x1].astype(int))
    print(f"{os.path.basename(cap)}: offset {dx},{dy}, visible {x0},{y0}-{x1},{y1}, mean diff {diff.mean():.2f}")
    boxes = os.path.join(out_dir, host, f"{name}.boxes.json")
    if not os.path.exists(boxes):
        os.system(f"python3 -I /work/scripts/boxes.py {pdf} > {boxes}")
