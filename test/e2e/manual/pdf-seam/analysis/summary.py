"""Summarises measure.py's output as tables.

Usage: python3 -I summary.py <measure.json> [<filter regex on name>]

For each export and renderer: the darkest edge line among all symbols' box
edges, as its mean grey (255: none), and how many of the edges have a line
at least 3 levels darker than white.
"""

import json
import re
import sys
from collections import defaultdict


def main(path, pattern=".*"):
    rows = json.load(open(path))
    table = defaultdict(dict)
    renderers = set()
    for row in rows:
        if not re.search(pattern, row["name"]):
            continue
        darkest = 255.0
        where = ""
        count = 0
        total = 0
        for sym in row["symbols"]:
            for edge, e in sym["edges"].items():
                total += 1
                if e["mean"] <= 252:
                    count += 1
                if e["mean"] < darkest:
                    darkest = e["mean"]
                    where = f"{sym['symbol']}{sym['index']}.{edge}"
        key = (row["host"], row["name"])
        col = f"{row['renderer']}-{row['dpi']}"
        renderers.add(col)
        table[key][col] = (darkest, count, total, where)
    cols = sorted(renderers)
    print("| host | export | " + " | ".join(cols) + " |")
    print("|---|---|" + "---|" * len(cols))
    for key in sorted(table):
        cells = []
        for col in cols:
            v = table[key].get(col)
            cells.append("" if v is None else f"{v[0]:.0f} ({v[1]}/{v[2]})")
        print(f"| {key[0]} | {key[1]} | " + " | ".join(cells) + " |")


if __name__ == "__main__":
    main(*sys.argv[1:])
