FROM debian:trixie-slim
RUN apt-get update && apt-get install --yes --no-install-recommends \
    poppler-utils ghostscript mupdf-tools qpdf python3 python3-numpy python3-pil \
    python3-pip python3-venv ca-certificates nodejs npm fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv --system-site-packages /opt/venv && /opt/venv/bin/pip install --no-cache-dir pypdfium2
RUN mkdir /opt/pdfjs && cd /opt/pdfjs && npm init -y >/dev/null && npm install --no-audit --no-fund pdfjs-dist@4 @napi-rs/canvas
ENV PATH=/opt/venv/bin:$PATH
WORKDIR /work
