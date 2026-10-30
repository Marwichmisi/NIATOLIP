# NIATOLIP — Documentation produit et technique

> Nom de travail : **NIATOLIP**. Produit : outil web agentique de création de cartes PCB, sur le modèle de Bolt/OpenCode, spécialisé électronique.
> Statut : MVP validé le 2026-10-29, **refonte V2 validée le 2026-10-30** — lire [15-PLAN-REFONTE-V2.md](./15-PLAN-REFONTE-V2.md) avant toute décision. Ce dossier est la source de vérité ; quand un document décrit une cible non implémentée, il le dit explicitement.

## Décisions validées (ne pas rouvrir sans ADR)

| # | Décision | Choix retenu |
|---|---|---|
| D1 | Langage de description PCB | **tscircuit** (TypeScript/TSX → Circuit JSON) |
| D2 | Framework agent | **Vercel AI SDK** (`ToolLoopAgent` / `streamText` + outils Zod), pas LangGraph pour le MVP |
| D3 | Modèles | **Meta Model API** (`https://api.meta.ai/v1`) + **OpenAI**, derrière une abstraction provider unique |
| D4 | Preview | `@tscircuit/runframe` (panneau droit), exécution via `@tscircuit/eval` en WebWorker |
| D5 | Juge final fabrication | Export KiCad + `kicad-cli` ERC/DRC dans un worker Docker **côté serveur uniquement** : l'utilisateur n'installe ni KiCad ni Docker en mode hébergé (jamais sur le runtime serverless, jamais sur le PC de l'utilisateur) |
| D10 | Interface | **shadcn/ui** (composants Radix + Tailwind) + icônes **Lucide** : boutons d'action iconographiques avec tooltip et `aria-label` (voir `06-UX-SPEC.md`) |
| D11 | Lancement MVP | **Docker auto-hébergé d'abord** (`docker compose up --build` = web + base + worker KiCad) ; le SaaS hébergé réutilisera la même composition plus tard |
| D12 | Comptes utilisateurs | **Aucun compte au prototype** ; auth email/OAuth ajoutée avant tout lancement public/hébergé |
| D13 | Fabricant MVP | **JLCPCB uniquement** (composants LCSC, BOM/PnP au format JLCPCB) |
| D14 | Nom public | À chercher — NIATOLIP est uniquement le nom de travail interne |
| D15 | Direction artistique | SaaS moderne sombre (type Linear/Vercel), accent **orange/ambre**, thèmes sombre+clair, Space Grotesk (titres) + Inter (texte) + JetBrains Mono (données), densité intermédiaire — voir `06-UX-SPEC.md` §7. Exit l'UI verte « outil électronique » |
| D6 | Autoroutage MVP | Autorouteur tscircuit intégré ; Freerouting seulement en option ultérieure |
| D7 | Périmètre MVP | Cartes 2 couches (4 max), 20–100 composants, basse vitesse : ESP32-C3/S3, RP2040, STM32 simples, capteurs I2C/SPI/UART, USB-C basse vitesse |
| D8 | Hors périmètre MVP | BGA dense, DDR, RF, USB3/PCIe, impédance contrôlée critique, secteur/haute tension, médical/automobile |
| D9 | Données utilisateur Meta | Mode **Standard** uniquement par défaut. Les variantes `-contributor` (données utilisées pour l'entraînement Meta) sont interdites sans opt-in explicite |
| D16 | Prompt et agents (V2) | Prompt **en couches** façon OpenCode : cœur court de principes (pas de processus numéroté), guidance outils générée, overlays modèle, modes `plan`/`build` + sous-agents `review`/`explore`, permissions `allow/ask/deny`, skills domaine chargés à la demande. Les garde-fous vivent dans le code (gates serveur), pas seulement dans le prompt — détail doc 15 §3 |
| D17 | Sourcing découplé (V2) | Design et approvisionnement séparés : **mode d'assemblage par projet** (PCBA JLCPCB / PCB seul / autre fabricant / indécis) et statuts `parts.json` (`verified`, `out_of_stock`, `generic`, `custom`, `missing`). Le stock ne bloque que le PCBA, jamais la conception ni l'export PCB nu. Échelle de repli avant tout blocage — détail doc 15 §4 |
| D18 | Multi-fichiers (V2) | `main.tsx` = assemblage du board ; modules fonctionnels et `components/` pour les composants custom ; `resolveEntrypoint()` unique partagé agent/preview/worker — détail doc 15 §5 |
| D19 | Stockage projet (V2) | **Le dossier projet est la source de vérité des fichiers** (`project.json`, `src/`, `versions/`, `reports/`, `artifacts/`, `conversation.jsonl`) ; Postgres ne garde que l'index. Migration des blobs JSON actuels — détail doc 15 §6.2 |
| D20 | Vérité des gates (V2) | G1–G3 sur diagnostics natifs tscircuit uniquement ; G5 scindée **G5-PCB / G5-PCBA** ; séquence G0→export imposée **côté serveur** (`g0g3` recalculé, jamais déclaré) — détail doc 15 §6.1 |

## Documents

| Doc | Contenu | À lire par |
|---|---|---|
| [00-PRD.md](./00-PRD.md) | Produit : problème, personas, scope, user stories, exigences FR/NFR, métriques, critères d'acceptation | Tous |
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | Architecture système, composants, flux, déploiement, choix techniques | Dev |
| [02-MODELS-AI-SDK.md](./02-MODELS-AI-SDK.md) | Intégration Meta Model API + OpenAI via AI SDK, routing de modèles, config, coûts | Dev |
| [03-AGENT-TOOLS-LOOP.md](./03-AGENT-TOOLS-LOOP.md) | Boucle agentique, contrat de chaque outil, system prompt, garde-fous, gates humaines | Dev |
| [04-TSCIRCUIT-RULES.md](./04-TSCIRCUIT-RULES.md) | Overlay produit NIATOLIP : sourcing D17, correspondance checks ↔ gates G0–G5, périmètre, checklist H2. La syntaxe/les éléments viennent du skill officiel épinglé `src/lib/skills/tscircuit/` | Dev + agent (skill chargé à la demande, P2) |
| [05-VALIDATION-FABRICATION.md](./05-VALIDATION-FABRICATION.md) | Gates G0–G5, checks, exports Gerber/BOM/PnP, procédure de fab | Dev |
| [06-UX-SPEC.md](./06-UX-SPEC.md) | Spécification d'interface panneau agent + preview, états, interactions | Dev front + design |
| [07-DATA-API.md](./07-DATA-API.md) | Modèle de données, API routes, persistance des runs et artefacts | Dev |
| [08-ROADMAP-BACKLOG.md](./08-ROADMAP-BACKLOG.md) | Roadmap V2 : état réel au 2026-10-30, phases P0–P4 et backlog (remplace les jalons M0–M4) | Tous |
| [09-RISKS.md](./09-RISKS.md) | Risques, sécurité, conformité, plans de mitigation | Tous |
| [10-WEBGPU.md](./10-WEBGPU.md) | Activation WebGPU (requis pour les viewers PCB/3D) : vérification, flags Linux, fallback sans GPU | Tous |
| [12-RAPPORT-AUDIT-GATES.md](./12-RAPPORT-AUDIT-GATES.md) | Audit des gates G0–G3 (cas Graetz réel) : verdicts prouvés, inventaire des checks natifs tscircuit, décision de migration complète vers le natif (issue #10), protocole anti-« gate menteuse ». **À archiver après la phase P0** | Dev |
| [13-CORPUS-R1-R5.md](./13-CORPUS-R1-R5.md) | Corpus de régression R1–R5 (issue #6) : prompts canoniques, fiches de test, harnais `npm run corpus`, historique des exécutions | Tous |
| [14-TEMPLATES-PREUVE-FABRICATION.md](./14-TEMPLATES-PREUVE-FABRICATION.md) | Templates T1–T3 (issue #8) : BOM présourcées, procédure packs JLCPCB R1–R3, fiches de test, registre des fabrications | Tous |
| [15-PLAN-REFONTE-V2.md](./15-PLAN-REFONTE-V2.md) | **Plan de refonte V2** : diagnostic 4/10, décisions D16–D20, chantiers prompt/sourcing/multi-fichiers/dossier projet, séquencement P0–P4, nettoyage documentaire | Tous |

> Documents supprimés : `11-BENCHMARK-M0.md` (2026-10-30) — benchmark jouet à n=1 par modèle, OpenAI jamais testé, contredit par le corpus réel ; il ne doit plus fonder le choix du modèle par défaut (voir doc 15 §8). Récupérable dans l'historique Git.

## Règle d'usage

- Toute contradiction entre un document et le code se règle en corrigeant **le document ou le code dans la même PR**.
- Toute décision structurante nouvelle (changement de moteur PCB, de framework agent, de provider) fait l'objet d'un ADR ajouté à ce dossier (`ADR-XXX.md`).
- Les IDs d'exigences (`FR-…`, `NFR-…`) et de gates (`G0`–`G5`) sont référencés dans les tickets et les tests.
