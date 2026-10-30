# NIATOLIP — Documentation produit et technique

> Nom de travail : **NIATOLIP**. Produit : outil web agentique de création de cartes PCB, sur le modèle de Bolt/OpenCode, spécialisé électronique.
> Statut : décisions MVP validées le 2026-10-29. Ce dossier est la source de vérité avant développement.

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

## Documents

| Doc | Contenu | À lire par |
|---|---|---|
| [00-PRD.md](./00-PRD.md) | Produit : problème, personas, scope, user stories, exigences FR/NFR, métriques, critères d'acceptation | Tous |
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | Architecture système, composants, flux, déploiement, choix techniques | Dev |
| [02-MODELS-AI-SDK.md](./02-MODELS-AI-SDK.md) | Intégration Meta Model API + OpenAI via AI SDK, routing de modèles, config, coûts | Dev |
| [03-AGENT-TOOLS-LOOP.md](./03-AGENT-TOOLS-LOOP.md) | Boucle agentique, contrat de chaque outil, system prompt, garde-fous, gates humaines | Dev |
| [04-TSCIRCUIT-RULES.md](./04-TSCIRCUIT-RULES.md) | Conventions de génération tscircuit imposées à l'agent, exemples, anti-patterns | Dev + agent (injecté en contexte) |
| [05-VALIDATION-FABRICATION.md](./05-VALIDATION-FABRICATION.md) | Gates G0–G5, checks, exports Gerber/BOM/PnP, procédure de fab | Dev |
| [06-UX-SPEC.md](./06-UX-SPEC.md) | Spécification d'interface panneau agent + preview, états, interactions | Dev front + design |
| [07-DATA-API.md](./07-DATA-API.md) | Modèle de données, API routes, persistance des runs et artefacts | Dev |
| [08-ROADMAP-BACKLOG.md](./08-ROADMAP-BACKLOG.md) | Jalons M0–M4, backlog priorisé prêt à développer, corpus de cartes de référence | Tous |
| [09-RISKS.md](./09-RISKS.md) | Risques, sécurité, conformité, plans de mitigation | Tous |
| [10-WEBGPU.md](./10-WEBGPU.md) | Activation WebGPU (requis pour les viewers PCB/3D) : vérification, flags Linux, fallback sans GPU | Tous |
| [11-BENCHMARK-M0.md](./11-BENCHMARK-M0.md) | Benchmark M0 (issue #2) : protocole, checklist providers, tableau et modèle par défaut | Tous |
| [12-RAPPORT-AUDIT-GATES.md](./12-RAPPORT-AUDIT-GATES.md) | Audit des gates G0–G3 (cas Graetz réel) : verdicts prouvés, inventaire des checks natifs tscircuit, décision de migration complète vers le natif (issue #10), protocole anti-« gate menteuse » | Dev |

## Règle d'usage

- Toute contradiction entre un document et le code se règle en corrigeant **le document ou le code dans la même PR**.
- Toute décision structurante nouvelle (changement de moteur PCB, de framework agent, de provider) fait l'objet d'un ADR ajouté à ce dossier (`ADR-XXX.md`).
- Les IDs d'exigences (`FR-…`, `NFR-…`) et de gates (`G0`–`G5`) sont référencés dans les tickets et les tests.
