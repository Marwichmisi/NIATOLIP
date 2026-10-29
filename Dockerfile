# NIATOLIP — image web (Next.js). Construite via `docker compose up --build`.
# Note npm (voir AGENTS.md) : la dép `github:` (circuit-json-to-altium) exige
# npm 10 pour l'install (npm 11.12 casse le re-resolve), et l'arbre React
# demande --legacy-peer-deps (peer exact de @tscircuit/3d-viewer).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Cache BuildKit : un rebuild après échec reprend les tarballs déjà
# téléchargés au lieu de tout re-fetcher (registre lent).
RUN --mount=type=cache,target=/root/.npm npx -y npm@10.9.3 ci --legacy-peer-deps --no-audit --no-fund

FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN useradd -m -u 1001 appuser
COPY --from=builder --chown=appuser /app/.next ./.next
COPY --from=builder --chown=appuser /app/node_modules ./node_modules
COPY --from=builder --chown=appuser /app/package.json ./package.json
USER appuser
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/models').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
