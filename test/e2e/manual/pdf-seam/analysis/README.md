# Analysis for #255

Local investigation tools, not part of the suite. They run in a scratch image
built from `tools.Dockerfile` (Poppler, Ghostscript, MuPDF, qpdf, PDFium through
pypdfium2), with this folder and the PDFs mounted at `/work`.

1. `pdf-seam.e2e.ts` exports the notes; `pdf-viewers.e2e.ts` shows the PDFs in
   `pdfs/` in Obsidian's PDF view (pdf.js) and Chromium's viewer.
2. `render.sh` and `sweep.sh` rasterise the PDFs at chosen resolutions;
   `sweep.sh` also writes copies with Skia's inverted first pass removed by
   `patch.py`. `align.py` turns Chromium viewer captures into page rasters.
3. `boxes.py` finds each symbol's box, image and group from `mutool trace`;
   `measure.py` finds the darkest line along each box edge; `summary.py`,
   `pivot.py`, `edges.py` and `compare.py` tabulate it; `diffcheck.py` checks
   that the patch changes only box-edge pixels.

Scripts take `/work/...` paths; run Python with `-I`.
