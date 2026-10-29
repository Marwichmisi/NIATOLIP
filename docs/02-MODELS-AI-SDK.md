# Modèles IA — Meta Model API + OpenAI via Vercel AI SDK

| Version | 1.0 — 2026-10-29 |
|---|---|
| Sources vérifiées | dev.meta.ai/docs (models, tool-calling, pricing) ; AI SDK (`/vercel/ai` sur Context7) |

---

## 1. Faits établis sur Meta Model API

| Fait | Valeur |
|---|---|
| Base URL | `https://api.meta.ai/v1` |
| Authentification | Bearer token, clé d'API Model API (variable `MODEL_API_KEY` dans les exemples officiels) |
| Protocoles | Responses API (recommandée par Meta pour les agents), Chat Completions (compatible OpenAI), Messages (compatible Anthropic) |
| Compatibilité SDK | Présentée comme drop-in avec le SDK OpenAI et les clients compatibles OpenAI |
| Tool calling | Supporté, appels parallèles supportés, arguments streamés |
| Restriction importante | `tool_choice` : **seul `"auto"` est accepté** (`"none"`, `"required"` et le forçage d'une fonction renvoient HTTP 400) |
| Validation des arguments | Le modèle est guidé par le schéma mais **sans garantie** : toujours valider côté application (Zod) |
| Contexte | 1 048 576 tokens pour Muse Wonder et Muse Spark |

### Modèles Meta pertinents

| Modèle | ID | Usage prévu dans NIATOLIP |
|---|---|---|
| Muse Spark 1.3 | `muse-spark-1.3` | **Défaut agent** : boucle code + outils, coût maîtrisé. Recommandé par Meta pour le nouveau travail agentique |
| Muse Wonder | `muse-wonder-1.0` | Planification complexe, revue finale, cas où Spark échoue. **Statut preview** — jamais l'unique option |
| Muse Spark 1.2 / 1.1 | `muse-spark-1.2`, `muse-spark-1.1` | Repli uniquement |
| Muse Image / Voice / SAM | — | Hors périmètre agent PCB (non utilisés) |

### Tarifs Meta vérifiés (par 1M tokens, mode Standard)

| Modèle | Input | Input caché | Output |
|---|---|---|---|
| `muse-spark-1.3` | $1.25 | $0.15 | $4.25 |
| `muse-wonder-1.0` | $4.00 | $0.20 | $20.00 |

Rate limits Meta (plafonds imposés par Meta, **par compte/équipe Meta et par modèle** — pas par utilisateur de NIATOLIP) : 3 000 **RPM** (requêtes par minute) et 4M **TPM** (tokens par minute) pour Spark 1.3 et Wonder. Concrètement : c'est le débit maximal que notre serveur peut envoyer à Meta avant de recevoir des erreurs HTTP 429. À l'échelle du MVP, ce plafond est très au-dessus de notre usage ; il ne concerne ni l'interface ni les limites par utilisateur (nos propres quotas sont un autre sujet, voir doc 09). Seule action requise : gérer HTTP 429 avec backoff exponentiel + jitter, en respectant `Retry-After`.

### Mode Contributor — INTERDIT par défaut (décision D9)

Les variantes `muse-spark-1.3-contributor` / `muse-spark-1.2-contributor` sont très bon marché (ex. $0.10 / $0.20 par 1M) **parce que Meta peut utiliser les contenus envoyés pour entraîner ses modèles**. Les projets PCB des utilisateurs sont des données de conception sensibles :

- ne jamais les activer pour des projets utilisateur sans opt-in explicite et informé ;
- usage éventuel réservé aux tests internes sur données synthétiques ;
- le mode par défaut du produit est **Standard**.

## 2. OpenAI

- Intégration via le provider officiel AI SDK : `@ai-sdk/openai`, clé `OPENAI_API_KEY` côté serveur.
- L'ID du modèle principal **n'est pas figé dans ce document** : il sera choisi au jalon M0 par benchmark (doc 08) puis défini par configuration. Raison : les noms de modèles OpenAI évoluent vite ; le code ne doit contenir aucun ID en dur.
- Rôle prévu : **autre choix utilisateur de même niveau** que Muse Wonder (l'utilisateur choisit son fournisseur en début de run) et terme de comparaison systématique dans le benchmark. Aucun basculement de modèle en cours de run n'est prévu (voir §4).

## 3. Intégration AI SDK (pattern validé)

### 3.1 Meta via le provider OpenAI-compatible

L'AI SDK fournit `createOpenAICompatible` (`@ai-sdk/openai-compatible`) pour toute API compatible Chat Completions — c'est la voie d'intégration Meta :

```ts
// lib/models.ts — SEUL fichier autorisé à connaître les providers
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

const meta = createOpenAICompatible({
  name: 'meta',
  baseURL: 'https://api.meta.ai/v1',
  apiKey: process.env.MODEL_API_KEY,
  includeUsage: true,
});

export type ModelChoice =
  | 'meta-spark'    // défaut boucle agent
  | 'meta-wonder'   // planification / revue
  | 'openai-main';  // choix OpenAI de l'utilisateur

export function getModel(choice: ModelChoice): LanguageModel {
  switch (choice) {
    case 'meta-spark':
      return meta(process.env.META_SPARK_MODEL ?? 'muse-spark-1.3');
    case 'meta-wonder':
      return meta(process.env.META_WONDER_MODEL ?? 'muse-wonder-1.0');
    case 'openai-main':
      return openai(process.env.OPENAI_MAIN_MODEL!); // défini au benchmark M0
  }
}
```

### 3.2 Boucle agent

```ts
// app/api/chat/route.ts (squelette — contrat complet dans doc 03)
import { ToolLoopAgent, isStepCount, hasToolCall } from 'ai';

const agent = new ToolLoopAgent({
  model: getModel(choice),
  instructions: SYSTEM_PROMPT, // versionné, voir doc 03
  tools: pcbTools,
  stopWhen: [
    isStepCount(50),                    // plafond par itération (FR-07), reprise par l'utilisateur ensuite
    hasToolCall('requestFinalApproval') // gate H2
  ],
  toolApproval: {
    exportManufacturingPack: 'user-approval',
  },
});
```

Avec `useChat` côté client (`@ai-sdk/react`, transport vers `/api/chat`), le même agent peut aussi être piloté via `streamText` + `toUIMessageStream`. Choisir **une** des deux formes au M1 et s'y tenir ; `ToolLoopAgent` est la forme recommandée par la documentation actuelle pour les agents à outils.

### 3.3 Contraintes Meta à respecter dans le code

1. **Ne jamais forcer un appel d'outil** avec Meta : pas de `toolChoice: 'required'` ni de forçage nommé — HTTP 400 garanti. L'agent doit être conçu pour fonctionner avec `tool_choice: "auto"`, donc le system prompt doit rendre les appels d'outils naturels et obligatoires par instruction, pas par contrainte API.
2. **Toujours valider les arguments d'outils avec Zod** avant exécution (Meta le recommande explicitement).
3. **Appels parallèles** : le modèle peut émettre plusieurs appels par tour ; exécuter chacun et renvoyer un résultat par appel.
4. **Streaming des arguments** : ne jamais essayer de parser un JSON d'arguments partiel.
5. La surface utilisée via `@ai-sdk/openai-compatible` est **Chat Completions**. La Responses API Meta (raisonnement préservé entre tours d'outils, recommandé par Meta pour les agents longs) n'est pas la surface par défaut de ce provider : si le benchmark M0 montre un écart de qualité significatif, ouvrir un ADR pour un provider Meta « Responses » dédié. Ne pas coder cette complexité avant de l'avoir mesurée.

### 3.4 Capacités multimodales

Muse Spark et Muse Wonder acceptent texte + image en entrée : le snapshot PCB/schéma (doc 03, outil `snapshotBoard`) peut être envoyé au **même** modèle que celui de la boucle. Pas de modèle vision séparé requis au MVP. Vérifier au M0 que le provider OpenAI-compatible transmet correctement les images dans le format attendu par Meta ; sinon, passer l'étape vision par le modèle OpenAI.

## 4. Stratégie de routing (MVP — garder simple)

| Étape de la boucle | Modèle par défaut | Raison |
|---|---|---|
| Clarification + plan | Même modèle que la boucle (choix utilisateur) | Éviter les changements de modèle en cours de run |
| Boucle génération/correction | **Muse Spark 1.3** ou OpenAI selon choix utilisateur | Coût et latence sur beaucoup d'itérations |
| Revue visuelle pré-H2 | Le modèle courant (multimodal) | Évite une dépendance supplémentaire |

**Règle ferme : un run = un seul modèle, du début à la fin.** L'utilisateur choisit le fournisseur (Meta ou OpenAI) et le modèle **avant** le run (FR-11). Il n'y a :

- aucun changement de modèle en cours de run, ni automatique ni proposé comme « escalade » ;
- aucune proposition de bascule après des échecs : après 2 échecs consécutifs sur la même erreur, l'agent change de **stratégie technique** (autre composant, autre placement, simplification du design) ou demande une décision à l'utilisateur — avec le même modèle.

Si l'utilisateur veut un autre modèle, il le sélectionne lui-même pour l'itération ou le run suivant ; ce choix est visible et journalisé.

## 5. Coûts et budgets

- Budget par itération : **50 étapes max** + plafond de coût estimé affiché à l'utilisateur (NFR-06). À l'atteinte du plafond d'étapes, le run se termine proprement (état sauvegardé) et l'utilisateur peut lancer une nouvelle itération en un clic — voir `06-UX-SPEC.md` §4.
- Activer le **prompt caching** côté Meta (préfixe système stable : instructions + conventions tscircuit) pour bénéficier du tarif « cached input ».
- Journaliser par run : modèle, tokens in/out (via `includeUsage` et les métadonnées AI SDK), coût estimé, nombre d'étapes.
- Ne pas envoyer le Circuit JSON brut au modèle : résumés uniquement (doc 03) — c'est le premier poste d'économie.

## 6. Variables d'environnement (serveur uniquement)

```bash
MODEL_API_KEY=            # Meta Model API
META_SPARK_MODEL=muse-spark-1.3
META_WONDER_MODEL=muse-wonder-1.0
OPENAI_API_KEY=
OPENAI_MAIN_MODEL=        # figé après benchmark M0
AGENT_MAX_STEPS=50
AGENT_RUN_BUDGET_USD=     # plafond souple avec alerte à 80 %
```

## 7. Points à vérifier au M0 (avant de coder le produit)

- [ ] Qualité tool-calling de `muse-spark-1.3` via `@ai-sdk/openai-compatible` sur nos outils réels (pas sur un exemple météo).
- [ ] Transmission d'images (snapshots) via le provider compatible.
- [ ] Comportement en `tool_choice: "auto"` : l'agent appelle-t-il les bons outils sans forçage ?
- [ ] Même grille pour le modèle OpenAI choisi ; tableau comparatif coût/réussite sur les 3 cartes de référence.
- [ ] Latence moyenne par étape sur les deux fournisseurs.
