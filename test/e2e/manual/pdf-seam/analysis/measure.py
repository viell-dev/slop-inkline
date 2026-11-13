"""Measures lines along symbols' box edges in rasters of exported PDFs.

Usage: python3 -I measure.py <raster root> <out.json>

For every `<name>.boxes.json` under the root and every raster
`<name>-<renderer>-<dpi>.png` beside it, and for each symbol and each edge
of its box, finds the darkest line of pixels within a pixel or two of the
edge, along the edge's length, away from its rounded corners and from any
symbol's ink, and records that line's mean grey (255 is white: no line) and
its darkest pixel. The page around a box is white, so anything darker there
is a mark.
"""

import glob
import json
import math
import os
import re
import sys

import numpy as np
from PIL import Image

# Where each synthetic symbol's ink is, as fractions of its image.
INK = {
    64: (8 / 64, 48 / 192, 56 / 64, 144 / 192),
    192: (16 / 192, 136 / 192, 176 / 192, 144 / 192),
    4000: (8 / 4000, 0.0, 3992 / 4000, 144 / 192),
}
NAMES = {64: "block", 192: "bar", 4000: "wide"}


def ink_rect(sym):
    x0, y0, x1, y1 = sym["image"]
    fx0, fy0, fx1, fy1 = INK[sym["width"]]
    w, h = x1 - x0, y1 - y0
    return (x0 + fx0 * w, y0 + fy0 * h, x0 + fx1 * w, y0 + fy1 * h)


def measure(grey, syms, dpi):
    height, width = grey.shape
    # The raster's own scale: a viewer may round its canvas down.
    sx, sy = width / 612, height / 792
    s = sx
    half = 1 if dpi < 200 else 2
    grow = 2 if dpi < 200 else 4
    keep = np.ones_like(grey, dtype=bool)
    for sym in syms:
        x0, y0, x1, y1 = (v * k for v, k in zip(ink_rect(sym), (sx, sy, sx, sy)))
        keep[
            max(0, math.floor(y0) - grow) : min(height, math.ceil(y1) + grow),
            max(0, math.floor(x0) - grow) : min(width, math.ceil(x1) + grow),
        ] = False
    results = []
    for index, sym in enumerate(syms):
        box = sym["box"] or sym["image"]
        L, T, R, B = (v * k for v, k in zip(box, (sx, sy, sx, sy)))
        r = 3 * s + 1
        edges = {}
        for edge in ("top", "bottom", "left", "right"):
            if edge in ("top", "bottom"):
                at = T if edge == "top" else B
                lo, hi = math.ceil(L + r), math.floor(R - r)
                lines = range(math.floor(at) - half, math.floor(at) + half + 1)
                samples = [(y, grey[y, lo:hi], keep[y, lo:hi]) for y in lines]
            else:
                at = L if edge == "left" else R
                lo, hi = math.ceil(T + r), math.floor(B - r)
                lines = range(math.floor(at) - half, math.floor(at) + half + 1)
                samples = [(x, grey[lo:hi, x], keep[lo:hi, x]) for x in lines]
            best = None
            for pos, values, ok in samples:
                values = values[ok]
                if values.size < 3:
                    continue
                mean = float(values.mean())
                if best is None or mean < best[0]:
                    best = (mean, int(values.min()), pos - at, int(values.size))
            if best is not None:
                edges[edge] = {
                    "mean": round(best[0], 1),
                    "min": best[1],
                    "offset": round(best[2], 2),
                    "length": best[3],
                }
        entry = {"index": index, "symbol": NAMES[sym["width"]], "box": box, "edges": edges}
        if sym.get("layer"):
            entry["gaps_pt"] = {
                "left": round(box[0] - sym["layer"][0], 3),
                "top": round(box[1] - sym["layer"][1], 3),
                "right": round(sym["layer"][2] - box[2], 3),
                "bottom": round(sym["layer"][3] - box[3], 3),
            }
        results.append(entry)
    return results


def main(root, out):
    rows = []
    for boxes_file in sorted(glob.glob(os.path.join(root, "**", "*.boxes.json"), recursive=True)):
        base = boxes_file[: -len(".boxes.json")]
        host = os.path.basename(os.path.dirname(base))
        name = os.path.basename(base)
        with open(boxes_file) as f:
            syms = json.load(f)
        for raster in sorted(glob.glob(base + "-*-*.png")):
            if raster.endswith(".visible.json"):
                continue
            m = re.match(r".*-([a-z0-9]+)-(\d+)\.png$", raster)
            renderer, dpi = m.group(1), int(m.group(2))
            img = np.asarray(Image.open(raster).convert("RGB"), dtype=np.float32)
            grey = img.mean(axis=2)
            visible_file = raster[: -len(".png")] + ".visible.json"
            symbols = syms
            if os.path.exists(visible_file):
                vx0, vy0, vx1, vy1 = json.load(open(visible_file))
                s = dpi / 72
                symbols = [
                    sym for sym in syms
                    if (sym["box"] or sym["image"])[0] * s - 4 > vx0
                    and (sym["box"] or sym["image"])[1] * s - 4 > vy0
                    and (sym["box"] or sym["image"])[2] * s + 4 < vx1
                    and (sym["box"] or sym["image"])[3] * s + 4 < vy1
                ]
            rows.append(
                {
                    "host": host,
                    "name": name,
                    "renderer": renderer,
                    "dpi": dpi,
                    "symbols": measure(grey, symbols, dpi),
                }
            )
    with open(out, "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
