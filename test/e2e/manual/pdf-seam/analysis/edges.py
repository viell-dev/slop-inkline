"""Per-edge detail: python3 -I edges.py <measure.json> <host> <name> <renderer> <dpi>"""
import json, sys
rows = json.load(open(sys.argv[1]))
for row in rows:
    if (row["host"], row["name"], row["renderer"], str(row["dpi"])) != tuple(sys.argv[2:6]):
        continue
    for sym in row["symbols"]:
        g = sym.get("gaps_pt", {})
        cells = []
        for edge in ("top", "bottom", "left", "right"):
            e = sym["edges"].get(edge)
            gap = g.get(edge)
            gp = "" if gap is None else f" gap {gap * int(sys.argv[6]) / 72:.2f}px"
            cells.append(f"{edge} " + ("-" if e is None else f"{e['mean']:.0f}/{e['min']}") + gp)
        print(f"{sym['symbol']}{sym['index']}: " + "; ".join(cells))
