"""Finds each symbol's box, layer and ink in a PDF from `mutool trace`.

Prints JSON, one entry per symbol: the image's pixel size; `image`, the
rectangle its pixels are drawn in; `box`, the bounds of the rounded clip it
is drawn through, which is the img element's box; and `layer`, the bounding
box of the transparency group it is drawn in (text colour only). All in
points from the page's top left.
"""

import json
import re
import subprocess
import sys

NUM = r"-?[\d.]+"


def bounds(lines, t):
    pts = []
    curved = False
    for line in lines:
        for m in re.finditer(r'(x\d?)="(%s)" (y\d?)="(%s)"' % (NUM, NUM), line):
            pts.append(apply(t, float(m.group(2)), float(m.group(4))))
        if "curveto" in line:
            curved = True
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys)), curved


def apply(t, x, y):
    a, b, c, d, e, f = t
    return a * x + c * y + e, b * x + d * y + f


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def main(pdf):
    out = subprocess.run(
        ["mutool", "trace", pdf], capture_output=True, text=True, check=True
    ).stdout.splitlines()
    rounded = []
    groups = []
    images = []
    i = 0
    while i < len(out):
        line = out[i]
        if "<group bbox" in line:
            b = [float(v) for v in re.search(r'bbox="([^"]+)"', line).group(1).split()]
            if b != [0.0, 0.0, 612.0, 792.0]:
                groups.append(tuple(b))
        if "<clip_path" in line:
            t = [float(v) for v in re.search(r'transform="([^"]+)"', line).group(1).split()]
            body = []
            i += 1
            while "</clip_path>" not in out[i]:
                body.append(out[i])
                i += 1
            r, curved = bounds(body, t)
            if curved:
                rounded.append(r)
        elif "<fill_image" in line:
            t = [float(v) for v in re.search(r'transform="([^"]+)"', line).group(1).split()]
            w = int(re.search(r'width="(\d+)"', line).group(1))
            h = int(re.search(r'height="(\d+)"', line).group(1))
            corners = [apply(t, x, y) for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))]
            xs = [p[0] for p in corners]
            ys = [p[1] for p in corners]
            image = (min(xs), min(ys), max(xs), max(ys))
            box = next((c for c in reversed(rounded) if overlaps(c, image)), None)
            layer = next((g for g in reversed(groups) if overlaps(g, image)), None)
            images.append({"width": w, "height": h, "image": image, "box": box, "layer": layer})
        i += 1
    seen = set()
    unique = []
    for im in images:
        key = (im["width"], tuple(round(v, 2) for v in im["box"] or im["image"]))
        if key in seen:
            continue
        seen.add(key)
        unique.append(im)
    json.dump(unique, sys.stdout, indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
