#!/bin/sh
# Rasterises PDFs at many resolutions with each renderer, and patched copies.
# Usage: sh sweep.sh <out dir> <pdf>...
set -eu
out=$1
shift
for pdf in "$@"; do
  host=$(basename "$(dirname "$pdf")")
  name=$(basename "$pdf" .pdf)
  for variant in ${VARIANTS:-orig patched}; do
    dir=$out/$variant/$host
    mkdir -p "$dir"
    src=$pdf
    if [ $variant = patched ]; then
      qpdf --qdf --object-streams=disable "$pdf" /tmp/q.pdf
      python3 -I /work/scripts/patch.py /tmp/q.pdf /tmp/p.pdf
      fix-qdf /tmp/p.pdf > "$dir/$name.pdf"
      src=$dir/$name.pdf
    else
      cp "$pdf" "$dir/$name.pdf"
    fi
    python3 -I /work/scripts/boxes.py "$src" > "$dir/$name.boxes.json"
    for dpi in ${DPIS:-72 96 110 120 125 144 150 192 200 240 300 400 600}; do
      b=$dir/$name
      pdftoppm -singlefile -r $dpi -png "$src" "$b-poppler25-$dpi"
      gs -q -dNOPAUSE -dBATCH -dSAFER -sDEVICE=png16m -r$dpi -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -o "$b-gs-$dpi.png" "$src"
      mutool draw -q -r $dpi -o "$b-mupdf-$dpi.png" "$src" 1 2>/dev/null
      python3 -I -c "import sys, pypdfium2 as p; d=p.PdfDocument(sys.argv[1]); d[0].render(scale=int(sys.argv[2])/72).to_pil().save(sys.argv[3])" "$src" $dpi "$b-pdfium-$dpi.png"
    done
  done
done
