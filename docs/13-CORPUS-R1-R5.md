# Corpus de régression R1–R5 (issue #6)

| Version | 1.0 — 2026-10-30 |
|---|---|
| Source des prompts | `src/lib/corpus.ts` (canonique — toute modification repasse le corpus avant merge) |
| Harnais | `scripts/corpus.ts` → `npm run corpus` |

## 1. Principe

Chaque modification du system prompt, du catalogue d'outils ou des versions tscircuit épinglées se mesure au lieu de s'imaginer : les 5 cartes de référence sont régénérées par le **même agent complet** que `/api/chat` (mêmes outils, même prompt, mêmes gates G0–G3). Sans humain dans la boucle : H1/H2 s'auto-approuvent dans le harnais, **seuls les verdicts G0–G3 comptent**.

Porte de sortie M1 (doc 08) : **≥ 4 cartes sur 5 atteignent G3 vert** sans modification manuelle du code.

## 2. Commandes

```bash
npm run corpus -- --dry-run        # sans clés : valide harnais + prompts (CI)
npm run corpus                      # réel : R1–R5 sur le modèle par défaut
npm run corpus -- --only R1         # une seule carte (mise au point, coût réduit)
npm run corpus -- --model meta-wonder
npm run corpus -- --write-docs      # réel + historise le tableau ci-dessous + JSON
```

Fichiers produits : `corpus/results/corpus-<date>-<id>.json` (détail par carte : gates, étapes, outils, tokens, coût, snapshots, `projectId` traçable). Exit `3` si la porte de sortie n'est pas atteinte (complet uniquement) ; exit `2` si clés manquantes.

## 3. Les 5 cartes

| ID | Carte | Ce qu'elle prouve | Fiche de test fonctionnel |
|---|---|---|---|
| R1 | ESP32-C3 + BME280 (I2C) + USB-C + LED | Chaîne complète : MCU, capteur I2C, alimentation USB-C — carte de preuve n°1 | 3,3 V ±5 % en sortie LDO ; LED allumée ; BME280 détecté au scan I2C (temp/humidité/pression) ; pas de court VCC/GND avant mise sous tension |
| R2 | RP2040 + flash + USB-C + boutons | Deuxième famille MCU, boot/reset, flash externe | 3,3 V ±5 % ; flash lisible (JEDEC ID) ; BOOT+RESET → mode bootloader (disque USB) ; LED pilotable |
| R3 | Nœud capteur ESP32-C3 + I2C externe + JST batterie | Connectique « produit » (charge exclue) | 3,3 V via JST ±5 %, sérigraphie polarité ; pull-ups I2C à 3,3 V ; capteur externe détecté ; LED pilotable |
| R4 | Carte relais pilotée en UART (basse tension) | Sortie de puissance, pistes dimensionnées | Relais colle/décolle sur ordre UART (NO/NC vérifiés) ; roue libre orientée ; courant bobine compatible ; pas d'échauffement après 10 cycles |
| R5 | MCU + connecteur écran SPI + boutons | Bus SPI, connectique multiple | 3,3 V ±5 % ; SCK/MOSI/CS observés ; écran initialisé par firmware de test ; 2 boutons lus |

Prompts canoniques complets : `src/lib/corpus.ts` (`CORPUS_CARDS`).

## 4. Historique des exécutions

> **P1-1 (issue #15)** : harnais avec plafond coût aligné chat (`AGENT_RUN_BUDGET_USD`, défaut 2 USD/carte, `--no-budget`/`--budget` pour outrepasser), `resolveEntrypoint` aligné sur `sequence.ts`, labels `difficulty`/`topics` façon benchmark officiel gelés dans `src/lib/corpus.ts`, `maxCostUsd` + `cardsMeta` inscrits dans chaque JSON. Décision versionning : **tout versionner** — `corpus/results/*.json` commités comme preuves (pas d'ignoré). Quarantaine versionnée par `CHECKS_VERSION` (P0-4, preuve `npm run versions:check`).

<!-- HISTORY-START -->
<!-- HISTORY-END -->

| Date | Modèle | Prompt | tscircuit | R1 | R2 | R3 | R4 | R5 | Vertes | Porte | Coût | Latence max |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-31 | meta-spark (muse-spark-1.3) | 1.4 | tscircuit 0.0.3036 | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 | ✅ porte M1 | $4.84 | 256s |

## 5. Règle de régression

- Toute montée de version tscircuit/KiCad ou modification du system prompt repasse `npm run corpus` avant merge (PRD §12, doc 08 M1-5).
- Les versions (modèle, prompt, tscircuit) sont inscrites dans chaque JSON — un verdict n'est comparable qu'à versions égales.
- Après migration des gates vers le natif (issue #10), re-baseliner le corpus : les faux positifs maison (T-jonctions punies, `pcb_trace_id` parsés) doivent disparaître du tableau.
