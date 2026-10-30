# AGENTS.md — NIATOLIP (nom de travail)

Outil web agentique de création de PCB. **Lire `docs/README.md` avant toute décision** : les décisions D1–D15 y sont validées et ne se rouvrent pas sans ADR (`docs/ADR-XXX.md`). Toute contradiction doc ↔ code se corrige dans la même PR.

## État actuel (mis à jour le 2026-10-30 — ne pas confondre livré et prouvé)

- **Livré et fonctionnel** : preview tscircuit réelle (RunFrame + eval WebWorker), agent complet (21 outils, gates H1/H2, streaming, plafond 50 étapes — `src/lib/agent-run.ts`), projets/versions/messages (Postgres ou fichiers JSON — `src/lib/projects.ts`), worker KiCad Docker avec ERC/DRC réels (`worker/`), harnais corpus (`scripts/corpus.ts`), templates T1–T3 (`src/lib/templates.ts`). Build vert.
- **Non prouvé — c'est le manque central** : corpus R1–R5 à **0/5** (seul R1 exécuté, G3 rouge probablement faux positif), **aucune carte fabriquée** (registre `docs/14` vide). Aucun template n'est « vérifié » au sens de `docs/04`/`docs/05`.
- **Connu faux** : gates G1/G3 maison (`src/lib/agent-gates.ts`) — migration native `@tscircuit/checks` décidée (`docs/12`) mais **non implémentée**. Ne pas optimiser prompt ou modèle avant cette migration.
- **Surfaces encore simulées dans l'UI** : BOM d'aperçu (`src/data/mock.ts` via `src/components/preview-panel.tsx`), onglet Validation figé, badge « Checks OK » permanent. Ne pas les présenter comme réelles.
- **Refonte V2 validée le 2026-10-30** : lire `docs/15-PLAN-REFONTE-V2.md` (décisions D16–D20 : prompt en couches, sourcing découplé, multi-fichiers, dossier projet source de vérité). Prochaine étape : **phase P0** de `docs/08-ROADMAP-BACKLOG.md` (jauges vraies), pas de nouvelle fonctionnalité avant.
- `Sans-titre-2026-10-27-0122.png` = la maquette d'origine du produit.

## Commandes

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # seule vérification disponible : doit être vert avant commit
```

- Il n'y a **ni suite de tests ni CI** à ce jour. Ne pas prétendre avoir « lancé les tests ».
- Le dépôt vit sur un montage `/media/...` : le warning Turbopack sur un `package-lock.json` hors dépôt est connu et sans effet.

## Piège build critique

- **Jamais `next/font/google`** : le téléchargement Google Fonts au build peut boucler indéfiniment (`socket hang up` constaté, build bloqué 1 h). Les polices sont auto-hébergées via `@fontsource-variable/*`, importées dans `src/app/layout.tsx` ; les familles sont définies dans `src/app/globals.css` (`--font-inter`, `--font-display`, `--font-mono`).
- **`package.json` = JSON strict, sans commentaires** : un `//` casse toutes les commandes npm (`JSON.parse ... must be actual JSON`). Documenter les choix dans `AGENTS.md` ou les docs, pas dans le JSON.
- **tscircuit publie en 0.0.x** (chaque mineur casse la compat) : `overrides` force une version unique de `@tscircuit/core`/`@tscircuit/eval` dans tout l'arbre, sinon RunFrame résout un core différent de celui du paquet `tscircuit` (doublons imbriqués → 439 erreurs `Module not found` au build). Ne jamais retirer ces `overrides` sans rebuilder.
- RunFrame/Viewers : `@tscircuit/runframe` n'embarque que 5 dépendances — ses viewers (`pcb-viewer`, `schematic-viewer`, `3d-viewer`…), `cmdk`, les `@radix-ui/*` et une vingtaine d'autres sont en `devDependencies` upstream et doivent être installés comme dépendances directes. Leurs classes Tailwind sont déclarées via `@source` dans `globals.css` (sinon preview non stylée).
- Build Next 16 = Turbopack uniquement : la clé de config est `turbopack` au premier niveau (`experimental.turbo` est ignoré en silence). Trois shims assumés pour le périmètre M0 (voir `src/lib/*-stub.ts`) : `resvg-stub.ts` (PNG natif `resvg-js`), `gltf-stub.ts` (`circuit-json-to-gltf` → occt WASM `?url` + resvg), `transpilePackages` pour `circuit-json-to-altium` (publié en `.ts` sans dist). Ne jamais exposer d'export PNG/STEP/GLB dans l'UI sans retirer le shim correspondant.
- npm 11.12 ne sait pas installer les dépendances `github:`/`codeload` (bug pacote `--prefer-offline/--prefer-online`) : utiliser `npx -y npm@10.9.3 install …` pour celles-là uniquement.

## Conventions UI (décision D15, détail `docs/06-UX-SPEC.md`)

- Composants type shadcn/ui dans `src/components/ui/` (style new-york, voir `components.json`), utilitaire `cn()` dans `src/lib/utils.ts`, alias `@/*` → `./src/*`.
- Icônes **Lucide uniquement**, jamais d'emoji d'interface. Actions évidentes = icône seule + `title`/tooltip + `aria-label` (envoyer `ArrowUp`, arrêter `Square`…).
- Identité : SaaS moderne, accent **orange/ambre** (`--primary`), thèmes sombre **et** clair via `next-themes` (classe `.dark`). Interdit : l'UI verte « outil électronique ». Le vert ne sert qu'à l'état « succès ».
- Typographies : Space Grotesk (titres), Inter (texte), JetBrains Mono (données techniques uniquement).
- Preview : la zone canvas utilise la classe `.preview-canvas` de `globals.css` (beige grillé en clair, anthracite grillé en sombre). Ne pas recoder de fond en dur type `bg-[#101114]` ; tout élément SVG de preview doit avoir ses variantes `dark:`.
- Textes d'interface et documentation en **français**.

## Contraintes produit à ne jamais violer (détails dans `docs/`)

- **Un run = un seul modèle**, choisi par l'utilisateur avant le run (Meta Model API `https://api.meta.ai/v1` ou OpenAI). Aucun changement de modèle en cours de run.
- Boucle agent : **50 étapes max par itération**, puis arrêt propre et reprise uniquement par clic utilisateur (« Continuer l'itération »).
- Meta Model API : `tool_choice` vaut toujours `"auto"` (le reste renvoie HTTP 400) ; variantes de modèles `-contributor` **interdites** (données d'entraînement Meta). Clés API uniquement côté serveur (`docs/02-MODELS-AI-SDK.md` §6 pour les variables).
- `kicad-cli` ne vit **que** dans le worker Docker côté serveur — jamais sur le PC de l'utilisateur, jamais dans l'image Next.js. Lancement cible : `docker compose up --build` (`docs/01-ARCHITECTURE.md` §3.4).
- Périmètre MVP : cartes 2 couches basse vitesse, composants **JLCPCB/LCSC vérifiés par outil** — un agent ne doit jamais inventer une référence LCSC, un MPN ou un footprint (`docs/04-TSCIRCUIT-RULES.md`). Aucun export « validé » sans les gates G0–G5 (`docs/05-VALIDATION-FABRICATION.md`).
- **Cible V2 (doc 15, non encore implémentée — ne pas la décrire comme acquise)** : le stock JLCPCB ne bloque que l'assemblage PCBA, jamais la conception ni l'export PCB nu (décision D17) ; les projets passeront en dossiers source de vérité (D19). Tant que le code n'a pas bougé, le comportement actuel fait foi.

## Git

- Branche principale `main`, distant `Marwichmisi/NIATOLIP`. Messages de commit préfixés (`docs:`, `feat:`…), en une ligne résumant le changement.
- `.env*`, `projects/` et `artifacts/` sont ignorés : ne jamais commiter de secrets ni de données générées.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
