#!/bin/bash
# Entrypoint worker : le volume `artifacts` est créé root-owned par Docker au
# premier montage ; le worker tourne en `kicad` (uid 1000, jamais root).
# On rend le volume inscriptible puis on abandonne les privilèges.
set -e
mkdir -p /artifacts
chown -R kicad:kicad /artifacts
exec su kicad -s /bin/bash -c "cd /worker && exec node src/index.js"
