# The end-to-end suite in real Obsidian under a virtual display. Build it from
# the repository root; `npm run test:e2e:docker` builds and runs it.
#
# The image holds the system libraries, Node.js, the dependencies, and a build
# of the plugin. It never holds Obsidian: Obsidian's terms do not allow
# redistributing it, so the tests download it into the volume mounted at /cache.
# Node.js is the major version .nvmrc names, pinned by digest.
FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates fonts-dejavu-core fonts-noto-core herbstluftwm \
    libasound2 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 \
    libnotify4 libnss3 libpango-1.0-0 libsecret-1-0 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxkbcommon0 libxrandr2 libxshmfence1 \
    libxss1 libxtst6 x11-xserver-utils xauth xvfb \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir /cache /out \
  && chown node:node /cache /out

USER node
WORKDIR /home/node/inkline
COPY --chown=node:node package.json package-lock.json .npmrc ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

ENV OBSIDIAN_CACHE_DIR=/cache E2E_OUTPUT_DIR=/out
ENTRYPOINT ["sh", "test/e2e/session.sh"]
