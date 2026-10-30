# Skill officiel tscircuit — copie épinglée NIATOLIP

| Champ | Valeur |
|---|---|
| Source | https://github.com/tscircuit/skill (MIT, voir `LICENSE` dans ce dossier) |
| Commit épinglé | `ccfd1afbefa0` (2026-10-09) |
| Copié le | 2026-10-30 — mise à jour = recopier depuis l'upstream, relire le diff, repasser le corpus (P1) |
| Contenu | `SKILL.md`, `SYNTAX.md`, `WORKFLOW.md`, `CHECKLIST.md`, `FOOTPRINTS.md`, `CLI.md`, `BUS_LANES.md`, `SAVED_FANOUT_PATHS.md`, `elements/` (80+ fiches), `templates/` (4 gabarits). Non copiés : `scripts/` et `docs/` de l'upstream (outillage CLI sans usage dans l'agent web). |

> Note build : ce dossier est exclu du type-check (`tsconfig.json` → `exclude: ["src/lib/skills"]`) car les `templates/*.tsx` officiels importent des packages non installés (`@tscircuit/common`…). Ce sont des références à charger comme texte par l'agent (P2), pas du code de l'application.

## Statut

**Non branché à l'agent à ce jour.** Le branchement (chargement à la demande, décision D16) est la tâche P2-3 du plan `docs/15-PLAN-REFONTE-V2.md`. Tant qu'il n'est pas fait, ce dossier est une référence versionnée pour les humains et les futures sessions — ne pas décrire le skill comme « utilisé par l'agent ».

## Adaptations nécessaires (agent web NIATOLIP ≠ agent CLI)

Le skill officiel suppose un agent disposant de la CLI `tsci`, de Bash et d'un accès fichiers local. L'agent NIATOLIP tourne côté serveur web, sans shell. Correspondances à appliquer au branchement :

| Skill officiel (CLI) | Équivalent NIATOLIP (cible P0–P2) |
|---|---|
| `tsci check netlist / schematic-placement / placement / routing…` | Appels programmatiques `@tscircuit/checks` (`runAllNetlistChecks`, `runAllPlacementChecks`, `runAllRoutingChecks`…) exposés par les outils de checks existants — migration P0 |
| `tsci check shorts`, `tsci check pcb-style`, `tsci check pin_specification` | Checks natifs correspondants (`@tscircuit/checks`) ; exposition à l'agent à décider en P0 selon les diagnostics disponibles dans la version épinglée |
| `tsci build`, `tsci build --pcb-png`, `--autorouter-debug` | `evaluateCircuit` (éval serveur) + preview ; pas d'équivalent PNG/debug autorouteur à ce jour (shims `resvg`/`gltf` actifs, voir AGENTS.md) |
| `tsci search "<query>"`, `tsci import`, `tsci add` | Outil `searchComponents` (jlcsearch) ; pas d'import de packages du registre dans le bac à sable d'évaluation à ce jour |
| `tsci search --digikey / --mouser` | Non disponible ; `digikeysearch.tscircuit.com` à évaluer comme 2e source en P2 |
| Lecture des fichiers du repo (`Read`, `Grep`, `Glob`) | Outils projet `listFiles` / `readFile` / `patchFile` / `writeFile` |
| `templates/` du skill | Gabarits copiés dans `templates/` de ce dossier ; les templates NIATOLIP T1–T3 (`src/lib/templates.ts`) restent spécifiques au produit (BOM présourcées) |

## Règles NIATOLIP qui priment sur le skill

En cas de conflit, `docs/04-TSCIRCUIT-RULES.md` (overlay produit) et les invariants du prompt font foi : sourcing vérifié par outil avec statuts D17, gates G0–G5 et approbations H1/H2, périmètre D7/D8 (2 couches basse vitesse), jamais de publication ni de commande sans demande explicite de l'utilisateur.
