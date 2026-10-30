# Roadmap et backlog — NIATOLIP

| Version | 2.0 — 2026-10-30 (réécriture complète ; la version 1.0 du 2026-10-29 décrivait des jalons M0–M4 qui ne correspondent plus à l'état réel) |
|---|---|
| Source de vérité V2 | `15-PLAN-REFONTE-V2.md` (diagnostic, décisions D16–D20, chantiers A–D) |
| Règle | Aucune phase n'est « terminée » sur une démo : elle l'est sur ses critères d'acceptation mesurables. La fabrication réelle est le critère de P1. |

---

## État réel au 2026-10-30 (point de départ)

- **Livré et fonctionnel** : preview tscircuit réelle (RunFrame + eval WebWorker), agent complet (21 outils, H1/H2, streaming, 50 étapes), projets/versions/messages (Postgres ou fichiers JSON), worker KiCad Docker (ERC/DRC réels, pack Gerber/BOM/PnP), harnais corpus, templates T1–T3. Build vert.
- **Non prouvé** : corpus R1–R5 à **0/5** (seul R1 exécuté, G3 rouge — probablement faux positif des gates maison) ; **0 carte fabriquée** ; modèle par défaut choisi sur un benchmark jouet à n=1 (ancien doc 11, supprimé).
- **Connu faux** : gates G1/G3 maison (audit `12-RAPPORT-AUDIT-GATES.md`), migration native décidée mais non implémentée.

L'ancien découpage M0–M4 est abandonné : M0 et l'infrastructure M1/M2 sont livrés, mais leurs portes de sortie probantes (corpus, fabrication) ne le sont pas. Les phases ci-dessous repartent de ce constat.

## Phases V2

### P0 — Jauges vraies (prérequis de tout)

| # | Tâche | Critère de sortie |
|---|---|---|
| P0-1 | Migration G1–G3 vers `@tscircuit/checks` natif épinglé, suppression des heuristiques maison (`src/lib/agent-gates.ts`) | Cas Graetz de doc 12 vert sans contournement ; fixtures gates (sains + fautifs connus) vertes |
| P0-2 | G5 scindée G5-PCB / G5-PCBA, PnP sans coordonnées = échec, couverture BOM ↔ composants comparée | Aucun faux vert PnP/stock reproduit sur fixtures |
| P0-3 | Séquence imposée côté serveur : `g0g3` recalculé, H2 vérifiée avant export « validé », artefacts rouges non étiquetés « validé » | Appel API direct mensonger rejeté par test |
| P0-4 | Clé de cache d'évaluation incluant les versions tscircuit/checks | Un changement de version invalide les verdicts |
| P0-5 | PnP officiel `circuit-json-to-pnp-csv` dans le worker en remplacement du fallback maison sans coordonnées ; évaluation `@tscircuit/fabricator-drc` + `jlcpcb-manufacturing-specs` pour G5 (doc 15 §11) | PnP toujours coordonné ou échec explicite ; G5 appuyée sur les specs fabricant |

### P1 — Preuve par le corpus et la fabrication

| # | Tâche | Critère de sortie |
|---|---|---|
| P1-1 | Corpus R1–R5 complet sur jauges natives, historique doc 13 rempli, plafond coût appliqué au harnais | ≥ 4/5 cartes G0–G3 vertes |
| P1-2 | Commande R1 chez JLCPCB, réception, test fonctionnel, registre doc 14 rempli | Une carte fabriquée qui fonctionne, consignée avec dates et résultats |
| P1-3 | Mise à jour `00-PRD.md` (critères d'acceptation), `09-RISKS.md` (risques matérialisés) | Docs alignés sur les résultats réels, y compris négatifs |

### P2 — Liberté de l'agent (prompt en couches, sourcing découplé)

| # | Tâche | Critère de sortie |
|---|---|---|
| P2-1 | Prompt cœur ≤ ~30 lignes + guidance outils générée + overlays modèle ; suppression du « processus obligatoire » | Corpus sans régression vs P1 |
| P2-2 | Modes `plan`/`build` + sous-agents `review`/`explore`, permissions `allow/ask/deny` | Un run plan n'écrit aucun fichier ; l'export exige toujours `ask` |
| P2-3 | Skills domaine (`tscircuit-syntax`, `sourcing-jlc`, `placement-routage`, `structuration`, `composants-custom`, `revue-fabrication`) chargés à la demande | Chaque skill chargé uniquement quand pertinent ; doc 04 devient source du skill syntaxe |
| P2-4 | Statuts de sourcing `parts.json` (`verified/out_of_stock/generic/custom/missing`), mode d'assemblage par projet, échelle de repli | Un run avec composant hors stock aboutit à un export PCB nu correctement étiqueté ; réécriture de `03-AGENT-TOOLS-LOOP.md` et mise à jour de `02-MODELS-AI-SDK.md` |
| P2-5 | Retrait ou refonte du benchmark jouet (`scripts/benchmark-models.ts`, `src/lib/toy-agent.ts`) | Plus aucun verdict produit fondé sur l'évaluateur statique jouet |
| P2-6 | Catalogue jlcsearch complet (~55 tables servies vs 20 exposées) en donnée déclarative ; évaluation `digikeysearch.tscircuit.com` comme 2e source (doc 15 §11) | Les familles aujourd'hui absentes (capteurs, connecteurs, modules) sont cherchables ; décision 2e source consignée |

### P3 — Mains de l'utilisateur (multi-fichiers, dossier projet, UI honnête)

| # | Tâche | Critère de sortie |
|---|---|---|
| P3-1 | `resolveEntrypoint()` partagé (corrige la preview alphabétique), convention multi-fichiers, spike fixture 2 fichiers | Fixture vert navigateur + serveur |
| P3-2 | Dossier projet source de vérité (`project.json`, `src/`, `versions/`, `reports/`, `artifacts/`, `conversation.jsonl`), index Postgres, script de migration des JSON existants, verrou par projet | Projet migré sans perte (égalité vérifiée), ouvrable dans un éditeur externe |
| P3-3 | UI : éditeur de code + diff, onglet Validation branché sur les jobs réels, BOM réelle depuis `parts.json`, suppression des surfaces simulées | Zéro donnée simulée affichée ; un spécialiste corrige le code de l'agent sans passer par le chat |
| P3-4 | Réécriture de `07-DATA-API.md`, mise à jour de `01-ARCHITECTURE.md` et `06-UX-SPEC.md` ; décision worker ↔ base (question ouverte doc 15 §10) | Docs = code |
| P3-5 | Import KiCad via `kicad-to-circuit-json` / `circuit-json-to-tscircuit` (+ convertisseurs de footprints EasyEDA/KiCad) — avancé de P4 (doc 15 §11) | Un projet KiCad existant s'importe en projet NIATOLIP évaluable |

### P4 — Ouverture (publication open source)

| # | Tâche | Critère de sortie |
|---|---|---|
| P4-1 | LICENSE, nom public (D14), README d'installation complet et honnête, CI (build + fixtures + dry-runs), dépendances `"latest"` épinglées, script `lint` réparé | Un tiers installe depuis le README seul ; CI verte |
| P4-2 | Auth + quotas (avant toute instance partagée), durcissement worker (egress, jobs orphelins, secrets par défaut) | Aucune route sensible sans contrôle d'accès |
| P4-3 | Provider générique compatible OpenAI | Un modèle local se configure sans modifier le code |

## Backlog (non phasé, par valeur décroissante)

- Outil datasheet : récupération + extraction pinout, confirmation visuelle pin 1 avant H2.
- Catalogue composants élargi au-delà des 20 catégories actuelles ; équivalents automatiques multi-sources.
- Freerouting en option si l'autorouteur tscircuit plafonne sur le corpus (critères doc 09).
- Cartes 4 couches (aujourd'hui `layers` est un littéral dans types et templates).
- SPICE sur les blocs analogiques simples (dépendances déjà présentes, jamais utilisées).
- i18n de l'UI (aujourd'hui français codé en dur) — condition d'une communauté internationale.
