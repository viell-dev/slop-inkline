#!/bin/sh
# Rasterises every PDF under $1 with each renderer at 96 and 300 DPI into $2.
# Usage: sh render.sh <pdf dir> <raster dir>
set -eu
src=$1
dst=$2
for pdf in $(find "$src" -name '*.pdf' | sort); do
  rel=${pdf#$src/}
  base=$dst/${rel%.pdf}
  mkdir -p "$(dirname "$base")"
  for dpi in 96 300; do
    pdftoppm -singlefile -r $dpi -png "$pdf" "$base-poppler25-$dpi"
    gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r$dpi -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -o "$base-gs-$dpi.png" "$pdf"
    mutool draw -q -r $dpi -o "$base-mupdf-$dpi.png" "$pdf" 1 2>/dev/null
    python3 -I -c "import sys, pypdfium2 as p; d=p.PdfDocument(sys.argv[1]); d[0].render(scale=int(sys.argv[2])/72).to_pil().save(sys.argv[3])" "$pdf" $dpi "$base-pdfium-$dpi.png"
  done
  # Poppler 22.12's rasters, from the test image, where the run made them.
  for dpi in 96 300; do
    if [ -f "${pdf%.pdf}-poppler22-$dpi.png" ]; then cp "${pdf%.pdf}-poppler22-$dpi.png" "$base-poppler22-$dpi.png"; fi
  done
  python3 -I /work/scripts/boxes.py "$pdf" > "$base.boxes.json"
done
