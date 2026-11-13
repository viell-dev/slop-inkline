"""Darkest edge line per renderer and resolution, as a Markdown table.
Usage: python3 -I pivot.py <measure.json> <name regex> [renderer order]"""
import json, re, sys
from collections import defaultdict
rows = json.load(open(sys.argv[1]))
pat = re.compile(sys.argv[2])
cells = defaultdict(dict)
dpis = set()
for r in rows:
    if not pat.search(r["name"]):
        continue
    vals = [e["mean"] for s in r["symbols"] for e in s["edges"].values()]
    n = sum(v <= 252 for v in vals)
    key = (r["renderer"], r["host"].split("-")[0], r["name"].split("-")[-1])
    cells[key][r["dpi"]] = f"{min(vals):.0f} ({n})" if n else "none"
    dpis.add(r["dpi"])
dpis = sorted(dpis)
print("| Renderer | PDF from | Note | " + " | ".join(str(d) for d in dpis) + " |")
print("| --- | --- | --- | " + " | ".join("---:" for _ in dpis) + " |")
for key in sorted(cells):
    print(f"| {key[0]} | {key[1]} | {key[2]} | " + " | ".join(cells[key].get(d, "") for d in dpis) + " |")
