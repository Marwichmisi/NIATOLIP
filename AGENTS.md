# AGENTS.md — NIATOLIP (nom de travail)

Outil web agentique de création de PCB. **Lire `docs/README.md` avant toute décision** : les décisions D1–D15 y sont validées et ne se rouvrent pas sans ADR (`docs/ADR-XXX.md`). Toute contradiction doc ↔ code se corrige dans la même PR.

## État actuel (ne pas confondre prototype et produit)

- Seul l'**écran principal UI** existe : Next.js + données **simulées** (`src/data/mock.ts`, simulation par timers dans `src/app/page.tsx`). Aucun backend, aucun agent, aucun tscircuit réel pour l'instant.
- Prochaine étape : jalon M0 de `docs/08-ROADMAP-BACKLOG.md` (vraie preview tscircuit + benchmark modèles).
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

## Git

- Branche principale `main`, distant `Marwichmisi/NIATOLIP`. Messages de commit préfixés (`docs:`, `feat:`…), en une ligne résumant le changement.
- `.env*`, `projects/` et `artifacts/` sont ignorés : ne jamais commiter de secrets ni de données générées.
