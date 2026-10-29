# Benchmark M0 — choix du modèle par défaut (issue #2)

> Tâches M0-3 à M0-5 (`docs/08-ROADMAP-BACKLOG.md`). Le gagnant devient le modèle par défaut (décision Q3).

## Protocole

- **Tâche** : carte jouet « ESP32-C3 + LED + bouton » (`TOY_TASK_PROMPT` dans `src/lib/toy-agent.ts`).
- **Boucle** : le même agent jouet pour les 3 candidats — outils `write_circuit_file`, `evaluate_circuit` (schémas Zod partagés), `tool_choice: "auto"`, plafond 50 étapes (`AGENT_MAX_STEPS`).
- **Candidats** : `meta-spark` (défaut pressenti, doc 02) et `meta-wonder`. `openai-main` est optionnel : le harnais le teste uniquement si `OPENAI_API_KEY` + `OPENAI_MAIN_MODEL` sont posés (pas de clé OpenAI disponible au M0 — il sera ajouté au tableau quand une clé existera).
- **Métriques par run** : build vert (oui/non, verdict `staticEvaluateCircuit` + contre-vérification WebWorker sur le code final), étapes, appels d'outils, latence totale, tokens in/out, coût estimé (`estimateCost`).
- **Équivalence des verdicts** : `npm run benchmark:models -- --dry-run` vérifie que l'évaluateur statique et le WebWorker `@tscircuit/eval` donnent le même verdict sur les fixtures `good` (vert) et `broken` (1 erreur `source_trace_not_connected_error`).

## Commandes

```bash
cp .env.example .env   # renseigner MODEL_API_KEY (Meta) ; OPENAI_* seulement si dispo
npm run benchmark:models -- --dry-run   # sans clés : valide harnais + checklist locale
npm run benchmark:models                # benchmark réel : spark + wonder (OpenAI ajouté auto si clés)
npm run benchmark:models -- --write-docs  # réel + met à jour le tableau ci-dessous
npm run benchmark:models -- --only meta-spark  # un seul candidat
```

## Checklist doc 02 §7 (M0-4)

| Point | Statut |
|---|---|
| `tool_choice: "auto"` uniquement (jamais `required`/forçage) | ✅ vérifié en réel (boucles complètes sans HTTP 400, 2026-10-29) |
| Appels parallèles (plusieurs appels/tour exécutés, un résultat/appel) | ✅ boucle multi-appels vérifiée (Wonder : 4 appels, 1 résultat/appel, sans erreur ; parallélisme strict même-tour non observé sur la tâche jouet) |
| Arguments streamés jamais parsés en partiel | ✅ par construction (AI SDK ; Zod valide après complétion) |
| Envoi d'image (snapshot) via le provider compatible | ⏳ non vérifié (tâche jouet texte uniquement ; à tester en M1 avec `snapshotBoard`) |
| Même grille pour le modèle OpenAI | ⏳ en attente d'une clé OpenAI (harnais prêt : candidat ajouté automatiquement) |
| Latence moyenne par étape, par fournisseur | ✅ mesurée : ~7,0 s/étape (spark), ~5,4 s/étape (wonder) |

## Résultats (benchmark réel — 2026-10-29, carte jouet, 1 run/candidat)

| Modèle | ID testé | Builds verts / runs | Étapes moy. | Latence moy. | Coût/run estimé | Notes |
|---|---|---|---|---|---|---|
| meta-spark | muse-spark-1.3 | 1/1 | 3 | 20.9s | $0.0190 | build vert, 2 appels d'outils, 4195/3241 tokens |
| meta-wonder | muse-wonder-1.0 | 1/1 | 5 | 27.1s | $0.1128 | build vert, 4 appels d'outils, 10209/3600 tokens |
| openai-main | | / | | | | optionnel — testé quand une clé sera disponible |

**Modèle par défaut retenu : `meta-spark`** — confirmé par le tableau : build vert en moins d'étapes (3 vs 5), ~6× moins cher ($0.019 vs $0.113), latence plus faible. Wonder reste disponible pour planification/revue (statut preview, jamais seule option). Valeur effective : `DEFAULT_MODEL=meta-spark` dans `.env`.

## Dry-run (sans clés, CI)

Le dry-run valide sans appel réseau : liste blanche (variante `-contributor` bloquée par défaut), schémas Zod des outils, verdicts `good`/`broken`, garde serveur-uniquement de `models.ts`. Sortie attendue : `DRY-RUN OK`.
