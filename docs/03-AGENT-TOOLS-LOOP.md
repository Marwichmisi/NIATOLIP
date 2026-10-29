# Agent — boucle, outils et garde-fous

| Version | 1.0 — 2026-10-29 |
|---|---|
| Dépend de | `01-ARCHITECTURE.md`, `02-MODELS-AI-SDK.md`, `04-TSCIRCUIT-RULES.md`, `05-VALIDATION-FABRICATION.md` |

---

## 1. Philosophie

L'agent n'est pas un générateur de texte : c'est un **opérateur d'outils déterministes**. Sa fiabilité vient des outils et des gates, pas de la longueur du prompt. Le modèle propose ; les outils disposent ; les gates décident ce qui est « vrai ».

Règles absolues :

1. L'agent ne déclare jamais un circuit correct : seuls les checks (doc 05) le déclarent.
2. L'agent ne choisit jamais un composant sans l'avoir cherché dans le catalogue réel (outil `searchComponents`).
3. L'agent ne contourne jamais une gate humaine (H1 plan, H2 design final).
4. Après **2 échecs consécutifs sur la même erreur**, l'agent change de stratégie (autre composant, autre placement, simplification) ou demande à l'utilisateur — il ne répète pas la même correction en boucle.

## 2. Boucle de travail

```
[Message utilisateur]
      │
      ▼
1. PLAN ────────────────► Gate H1 : approbation utilisateur
      │                    (outil requestPlanApproval, exécution suspendue)
      ▼
2. ITÉRATION (boucle ToolLoopAgent, stopWhen: 50 étapes par itération)
      ├─ searchComponents / getComponentDetails
      ├─ writeFile / patchFile  → preview se met à jour (client)
      ├─ evaluateCircuit        → Circuit JSON résumé + erreurs (client WebWorker)
      ├─ runChecks (netlist / placement / routing)
      ├─ snapshotBoard          → image PCB/schéma (client)
      └─ corrections…
      │
      ▼
3. GATE FABRICATION (G4/G5, worker KiCad asynchrone)
      │
      ▼
4. REVUE ───────────────► Gate H2 : approbation utilisateur
      │                    (BOM, image, rapport DRC présentés)
      ▼
5. EXPORT (outil avec toolApproval) → pack fabrication téléchargeable
```

Arrêts de la boucle : `isStepCount(50)`, appel à l'outil de gate, budget coût atteint, annulation utilisateur, ou réponse finale sans outil.

**Atteinte des 50 étapes** : le run se termine proprement — fichiers et historique sauvegardés, dernière version valide conservée — et l'interface propose à l'utilisateur de **continuer pour une nouvelle itération** (bouton dédié, voir `06-UX-SPEC.md` §4). La nouvelle itération repart du même projet, du même modèle et du contexte résumé ; elle n'est jamais lancée automatiquement.

## 3. Catalogue d'outils (contrat MVP)

Chaque outil : nom, exécution (serveur/client), schéma d'entrée Zod, résultat **structuré et borné en taille**. Les résultats renvoyés au modèle sont toujours des résumés — jamais de fichiers entiers ni de Circuit JSON brut.

### 3.1 Fichiers projet

| Outil | Où | Entrée | Résultat | Notes |
|---|---|---|---|---|
| `listFiles` | serveur | — | liste des chemins + tailles | |
| `readFile` | serveur | `path` | contenu (tronqué à 8k caractères avec marqueur) | Ne relire que si nécessaire |
| `writeFile` | serveur | `path`, `content` | `{ ok, path, bytes }` | Écriture complète ; déclenche la réévaluation côté client |
| `patchFile` | serveur | `path`, `oldString`, `newString` | `{ ok }` ou erreur si 0/plusieurs occurrences | Préféré à `writeFile` pour les corrections locales |

Chemins autorisés : uniquement dans le projet courant, extensions `.tsx`, `.ts`, `.json`, `.md`. Point d'entrée par défaut : `main.tsx` (ou `index.tsx` — un seul, fixé à la création du projet).

### 3.2 Composants et sourcing

| Outil | Où | Entrée | Résultat | Notes |
|---|---|---|---|---|
| `searchComponents` | serveur | `query`, filtres optionnels (`basicOnly`, `inStockOnly`, `package`) | jusqu'à 10 candidats : `{ lcscId, mpn, description, package, stock, price, basic/preferred }` | Source : jlcsearch (JLCPCB). **Obligatoire avant tout choix de composant principal** |
| `getComponentDetails` | serveur | `lcscId` | détails + footprint tscircuit recommandé + attributs clés | Met en cache (doc 07) |
| `getDatasheetSummary` | serveur | `mpn` ou `lcscId`, `question` | résumé ciblé (pinout, tensions, valeurs recommandées) | Should au MVP ; Must dès qu'un composant actif non trivial est utilisé |

### 3.3 Évaluation et checks (client WebWorker)

| Outil | Où | Entrée | Résultat | Notes |
|---|---|---|---|---|
| `evaluateCircuit` | client | — (état courant) | `{ success, errors[], warnings[], stats: { components, traces, boardSize } }` | Erreurs normalisées : `{ type, message, component?, file?, line? }` |
| `checkNetlist` | client/serveur | — | connexions attendues vs réalisées, nets non connectés | Gate G1 |
| `checkPlacement` | client | — | chevauchements, hors-carte, espacements | Gate G2 ; à passer **avant** tout routage |
| `checkRouting` | client | — | traces non routées, violations de routage | Gate G3 |
| `snapshotBoard` | client | `view: pcb\|schematic`, `format: png` | image + métadonnées | Envoyée au modèle multimodal pour auto-revue (doc 05) |
| `getCircuitSummary` | client | — | netlist lisible compacte + liste des composants et pins connectés | Format « lisible par IA », jamais le JSON brut |

### 3.4 Fabrication (worker asynchrone)

| Outil | Où | Entrée | Résultat | Notes |
|---|---|---|---|---|
| `requestManufacturingValidation` | serveur → worker | `version` | `jobId` | Lance export KiCad + ERC/DRC (gates G4/G5) |
| `getValidationResult` | serveur | `jobId` | rapport structuré : violations ERC/DRC par sévérité, nets non connectés | L'agent doit corriger et relancer si violations bloquantes |
| `exportManufacturingPack` | serveur → worker | `version` | URLs des artefacts (Gerber.zip, BOM.csv, PnP.csv, KiCad.zip, rapport) | **`toolApproval: 'user-approval'` obligatoire** |

### 3.5 Gates humaines et contrôle

| Outil | Comportement |
|---|---|
| `requestPlanApproval` | Présente le plan (architecture, composants principaux, dimensions, couches) et suspend le run jusqu'à décision utilisateur (approuver / modifier) |
| `requestFinalApproval` | Présente image PCB, BOM chiffrée et rapport de validation ; suspend le run ; conditionne l'export |
| `reportOutOfScope` | Utilisé quand la demande sort du périmètre D8 : explique la limite et propose l'alternative la plus proche dans le périmètre |

## 4. System prompt (structure — le texte vit dans `lib/prompts/`)

Le system prompt est assemblé en couches stables (pour bénéficier du prompt caching) :

1. **Rôle et périmètre** : agent de conception PCB, périmètre D7/D8, refus explicités.
2. **Processus obligatoire** : plan → H1 → composants réels → code → évaluation → checks dans l'ordre G0→G3 → snapshot → revue → gate fabrication → H2 → export.
3. **Conventions tscircuit** : le contenu normatif de `04-TSCIRCUIT-RULES.md`.
4. **Discipline d'outils** : chercher avant de choisir ; évaluer après chaque écriture significative ; ne jamais ignorer une erreur ; résumer les résultats à l'utilisateur en langage non technique quand c'est possible.
5. **Honnêteté** : signaler incertitudes (composant non vérifié, contrainte non checkable), ne jamais prétendre qu'un check non exécuté a été passé.

Règles de rédaction : pas de prompt « méga-bloc » fourre-tout ; chaque règle doit correspondre soit à un échec observé, soit à une gate. Toute modification du prompt passe par le corpus de régression (doc 08).

## 5. Gestion du contexte

- Historique de conversation : géré par AI SDK (`UIMessage[]`), persisté par projet (doc 07).
- Résumés d'outils bornés : erreurs limitées aux 20 premières + compteur ; netlist compacte ; jamais plus de ~8k caractères par résultat d'outil sans troncature explicite.
- Après chaque version de fichier validée (checks verts), créer un **point de restauration** nommé (ex. `v3 — netlist OK`) utilisable par l'utilisateur et par l'agent en cas de régression.
- Si le contexte approche la limite : résumer les étapes anciennes (fichiers finaux + décisions) plutôt que de tronquer aveuglément.

## 6. Garde-fous d'exécution

| Garde-fou | Valeur par défaut |
|---|---|
| Étapes max par itération | 50 (`AGENT_MAX_STEPS`) — puis arrêt propre et proposition de continuer (nouvelle itération lancée par l'utilisateur) |
| Échecs identiques consécutifs avant changement de stratégie | 2 |
| Temps max d'un run | 15 min |
| Coût max par run | Configurable ; alerte à 80 %, arrêt propre à 100 % avec résumé |
| Outils en écriture simultanée | Sérialisés (jamais deux écritures de fichiers en parallèle) |
| Annulation | Bouton Stop : termine le run, conserve la dernière version valide, journalise l'annulation |

## 7. Format de compte rendu à l'utilisateur

À la fin de chaque phase, l'agent écrit un résumé court et factuel :

- **Plan** : ce qui va être construit, composants principaux, dimensions.
- **Pendant l'itération** : étapes visibles dans l'UI (pas de pavé de texte) ; le chat reste lisible.
- **Revue finale** : image, tableau BOM (référence, LCSC, stock, prix), résultat des gates, limites et points à vérifier humainement (ex. orientation d'un connecteur).

## 8. Évolutions explicitement reportées

- Multi-agent (planificateur / routeur / reviewer séparés) : seulement si les métriques du MVP montrent que la boucle unique plafonne.
- MCP : réexposer ce catalogue d'outils en serveur MCP une fois le produit stable.
- Exécution des outils client remplacée/complétée par une exécution serveur sous bac à sable si le besoin « run sans navigateur ouvert » apparaît.
