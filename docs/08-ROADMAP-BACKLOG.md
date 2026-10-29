# Roadmap et backlog — NIATOLIP

| Version | 1.0 — 2026-10-29 |
|---|---|
| Règle | Aucun jalon n'est « terminé » sur une démo : il l'est sur ses critères d'acceptation mesurables, dont la fabrication réelle à partir de M2. |

---

## Jalons

### M0 — Preuve technique et benchmark modèles (avant tout produit)

Objectif : vérifier les hypothèses qui peuvent tuer le projet, sur le plus petit périmètre possible.

| # | Tâche | Critère de sortie |
|---|---|---|
| M0-1 | Page Next.js minimale : chat AI SDK + `RunFrame` affichant un circuit tscircuit codé en dur | La preview PCB/schéma se met à jour quand le `fsMap` change |
| M0-2 | Évaluation `@tscircuit/eval` en WebWorker + extraction erreurs/Circuit JSON résumé | Une erreur de code volontaire s'affiche structurée dans la page |
| M0-3 | Provider Meta via `@ai-sdk/openai-compatible` (`muse-spark-1.3`) + provider OpenAI, modèle commutable par configuration | Le même agent jouet appelle un outil Zod sur les deux fournisseurs |
| M0-4 | Vérifier les contraintes Meta du doc 02 §3.3 : `tool_choice: "auto"` uniquement, appels parallèles, streaming, **envoi d'image** (snapshot) | Checklist du doc 02 §7 intégralement cochée ou écarts documentés en ADR |
| M0-5 | Benchmark : les 3 modèles (Spark 1.3, Wonder 1.0, OpenAI choisi) génèrent la carte jouet « ESP32-C3 + LED + bouton » avec la boucle d'outils minimale | Tableau : taux de builds verts, étapes moyennes, coût/run, latence. Le gagnant devient le modèle par défaut (décision Q3) |

**Porte de sortie M0** : si aucun modèle n'atteint un build vert sur la carte jouet avec les outils de base, arrêter et réévaluer (prompt, conventions doc 04, ou périmètre) avant d'écrire le produit.

### M1 — MVP logiciel (boucle agent complète, sans gate KiCad)

| # | Tâche | Critère de sortie |
|---|---|---|
| M1-1 | Projets + versions + persistance (doc 07, version locale acceptable) | Rouvrir un projet restaure fichiers, historique, preview (FR-12) |
| M1-1b | `docker-compose.yml` : services `web` + `db` dès M1 (le service `worker` KiCad arrive en M2-1 dans la même composition), `.env.example` documenté | Un poste vierge avec Docker lance le produit par `docker compose up --build` sans aucune autre installation (décision Q1/D11) |
| M1-2 | Catalogue d'outils doc 03 §3.1–3.3 (fichiers, composants jlcsearch, évaluation, checks G0–G3, snapshot) | L'agent réalise un run complet en autonomie bornée |
| M1-3 | Gates H1 (plan) et H2 (revue sans export fab) + approbations AI SDK | Aucun run ne se termine « validé » sans clics explicites |
| M1-4 | UX conforme au doc 06 (fil d'exécution, onglets, états d'erreur, Stop, budget) | Revue UX sur le parcours PRD §7 |
| M1-5 | Corpus de régression automatisé v1 : les prompts des cartes R1–R5 exécutés en CI/nuit, métriques consignées | Rapport automatique : builds verts, gates, étapes, coût par carte |
| M1-6 | Garde-fous : budget étapes/coût, arrêt, points de restauration | Tests sur runs volontairement pathologiques |

**Porte de sortie M1** : ≥ 4 cartes du corpus sur 5 atteignent G3 vert sans modification manuelle du code, sur le modèle par défaut.

### M2 — Fabrication réelle et gate KiCad

| # | Tâche | Critère de sortie |
|---|---|---|
| M2-1 | Worker KiCad conteneurisé : export, `kicad-cli` ERC/DRC, gates G4/G5, pack fabrication (doc 05 §4) | Un job complet produit le pack + rapport pour R1 |
| M2-2 | Templates vérifiés T1–T3 (doc 04 §4) construits et utilisés par l'agent | L'agent part des templates quand la demande correspond |
| M2-3 | **Fabrication R1** (ESP32-C3 + BME280 + USB-C) chez JLCPCB, fiche de test écrite avant commande | Carte reçue et testée ; résultat consigné selon doc 05 §6 |
| M2-4 | Fabrication R2 et R3 | Idem ; causes d'échec éventuelles transformées en règles/checks |
| M2-5 | Outil datasheet (`getDatasheetSummary`) si les échecs M2 le justifient | Décision tracée (pas de développement spéculatif) |

**Porte de sortie M2** = critères d'acceptation du MVP du PRD §11 (avec M3 pour l'utilisateur externe).

### M3 — Pilotes externes

| # | Tâche |
|---|---|
| M3-1 | Auth utilisateurs (prérequis au mode hébergé/public, décision Q2), quotas par utilisateur, budgets par défaut |
| M3-2 | 5 à 10 utilisateurs pilotes (persona P1) sur cartes de leur choix dans le périmètre |
| M3-3 | Collecte métriques PRD §10 ; revue des échecs un par un |
| M3-4 | Durcissement : rate limits fournisseurs (429), reprises, files d'attente worker |

### M4 — Après MVP (à prioriser selon les métriques, pas avant)

- Cartes 4 couches dans le périmètre officiel.
- Simulation SPICE ciblée (blocs d'alimentation simples).
- Serveur MCP réexposant les outils.
- Freerouting comme moteur de routage alternatif évaluable sur le corpus.
- Bibliothèque de blocs vérifiés étendue (la croissance du catalogue prime sur l'élargissement du périmètre électrique).

---

## Corpus de cartes de référence (référence pour benchmarks et régressions)

| ID | Carte | Ce qu'elle prouve |
|---|---|---|
| R1 | ESP32-C3 + BME280 (I2C) + USB-C + LED | Chaîne complète : MCU, capteur I2C, alimentation USB-C — **carte de preuve n°1** |
| R2 | RP2040 + flash + USB-C + boutons | Deuxième famille MCU, boot/reset |
| R3 | Nœud capteur ESP32-C3 + connecteur I2C externe + connecteur batterie JST (charge exclue) | Connectique, usage « produit » |
| R4 | Carte relais simple commandée en UART par connecteur externe (partie puissance limitée au périmètre basse tension) | Composant de sortie, pistes d'alimentation dimensionnées |
| R5 | Afficheur simple : MCU + connecteur écran SPI + boutons | Bus SPI, connectique multiple |

Chaque carte du corpus possède : un prompt utilisateur canonique, une fiche de test fonctionnel, et un historique des résultats par version du produit (modèle, prompt, outils).

## Backlog priorisé (extrait prêt à ticket)

| Priorité | Ticket | Doc source |
|---|---|---|
| P0 | Épingler les versions tscircuit/KiCad et les afficher dans les rapports | 01 §6, 05 §3 |
| P0 | Interdire les variantes Meta `-contributor` par configuration (liste d'IDs autorisés) | 02 §1 |
| P0 | Résumés d'outils bornés (jamais de Circuit JSON brut au modèle) | 03 §5 |
| P0 | Refus hors périmètre propre via `reportOutOfScope` | 00 FR-15, 06 §4 |
| P1 | Cache composants avec TTL et revérification stock en G5 | 07 §1, 05 G5 |
| P1 | Points de restauration automatiques à G3 vert | 03 §5 |
| P1 | Rapport de validation téléchargeable dans l'onglet Validation | 06 §3.1 |
| P2 | ADR provider Meta « Responses API » si le benchmark montre un gain | 02 §3.3 point 5 |
| P2 | Mode templates guidé dans l'écran de création de projet | 00 FR-14 |
