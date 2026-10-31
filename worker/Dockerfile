# NIATOLIP — worker validation KiCad (issue #7, doc 05 G4/G5, doc 01 §3.3).
# Image : kicad/kicad:9.0 (kicad-cli épinglé 9.x, Debian bookworm) + Node 22
# copié depuis node:22-bookworm-slim. Construit via `docker compose up --build`
# (service `worker`). Docker-only strict : sans ce service, les jobs restent
# `queued` et le web le dit honnêtement.
#
# Boucle : réclame un job `queued` (SKIP LOCKED) → snapshot → CircuitRunner →
# export KiCad → kicad-cli sch erc / pcb drc (JSON + exit codes) → si G4 vert :
# Gerber/perçage/positions, BOM + revérification stock, pack + rapport → artefacts.
#
# Quotas/isolement (doc 01 §3.3, doc 09) : mem_limit + cpus + pids_limit dans
# docker-compose, timeouts fermes par étape et 10 min par job, aucun secret lu
# (DATABASE_URL seule). Durcissement egress complet : jalon M3 (risques).
FROM kicad/kicad:9.0 AS kicad
FROM node:22-bookworm-slim AS nodebin
FROM kicad AS runner

# Node 22 (même base Debian bookworm que l'image KiCad) + vérification versions.
COPY --from=nodebin /usr/local /usr/local
RUN node --version && npm --version && kicad-cli --version

WORKDIR /worker
COPY package.json package-lock.json ./
# Dépendances EXPLICITES dont transitives (R5 revue #13) : le worker tourne avec
# --legacy-peer-deps (pas d'auto-install des peers) dans une image qui ne
# contient QUE worker/node_modules — chaque peer importé à l'exécution par
# @tscircuit/eval ou @tscircuit/core DOIT donc être épinglé dans package.json
# (math-utils, kicad-to-circuit-json, debug, sucrase, comlink, react,
# footprinter, minicssgrid, bpc, spice… — constatés un par un en E2E #13).
# Ne JAMAIS « nettoyer » cette liste au grep : vérifier par
# `npm run g5:fixtures` (bloc G5-8, fermeture des imports) + un job E2E réel.
RUN --mount=type=cache,target=/home/kicad/.npm,uid=1000,gid=1000 npm ci --omit=dev --legacy-peer-deps --no-audit --no-fund \
  --fetch-retries=10 --fetch-retry-mintimeout=30000 --fetch-retry-maxtimeout=180000
COPY src ./src

ENV NODE_ENV=production \
    ARTIFACTS_DIR=/artifacts \
    POLL_INTERVAL_MS=5000 \
    JOB_TIMEOUT_MS=600000

# Volume `artifacts` root-owned au premier montage : entrypoint (root) le rend
# à `kicad` puis abandonne les privilèges (jamais de Node en root).
USER root
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
