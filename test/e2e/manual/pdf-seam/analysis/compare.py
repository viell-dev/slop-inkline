"""Compares 0.9.2's and 0.9.3's exports edge by edge in measure.py output.
Usage: python3 -I compare.py <measure.json>"""
import json, sys
rows = json.load(open(sys.argv[1]))
index = {(r["host"], r["name"], r["renderer"], r["dpi"]): r for r in rows}
same = diff = 0
for (host, name, renderer, dpi), row in sorted(index.items()):
    if "0.9.2" not in name:
        continue
    other = index.get((host, name.replace("0.9.2", "0.9.3"), renderer, dpi))
    if other is None:
        continue
    for a, b in zip(row["symbols"], other["symbols"]):
        for edge in ("top", "bottom", "left", "right"):
            ea, eb = a["edges"].get(edge), b["edges"].get(edge)
            va = None if ea is None else ea["mean"]
            vb = None if eb is None else eb["mean"]
            if va == vb or (va is not None and vb is not None and abs(va - vb) <= 1):
                same += 1
            else:
                diff += 1
                print(f"{host} {name.replace('styles-0.9.2-', '')} {renderer}-{dpi} {a['symbol']}{a['index']}.{edge}: 0.9.2 {va} 0.9.3 {vb}")
print(f"{same} edges agree within 1 level, {diff} differ")
