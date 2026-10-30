# Plan de refonte V2 — agent PCB libre, sourcing découplé, projets en dossiers

| Champ | Valeur |
|---|---|
| Version | 1.0 — 2026-10-30 |
| Statut | **Validé par le porteur le 2026-10-30 — aucun code V2 n'est encore écrit.** Ce document décrit la cible ; en cas de contradiction avec le code actuel, le code actuel fait foi jusqu'à l'implémentation de la phase concernée. |
| Déclencheur | Revue approfondie du 2026-10-30 : produit évalué 4/10. Infrastructure réelle (agent, preview, worker KiCad, persistance), mais 0/5 cartes vertes au corpus, 0 carte fabriquée, jauges G1/G3 connues fausses, utilisateur spécialiste sans accès au code généré. |
| Nouvelles décisions | D16–D20 (voir `README.md`). Elles complètent D1–D15 sans les rouvrir, sauf mention explicite. |

## 1. Diagnostic en 5 points (faits vérifiés, pas opinions)

1. **Les jauges mentent.** G1/G3 maison sont prouvées fausses par l'audit Graetz (`12-RAPPORT-AUDIT-GATES.md`) ; la migration vers `@tscircuit/checks` natif est décidée depuis le 2026-10-30 mais non implémentée (`@tscircuit/checks` absent de `package.json`, `runAllGates` appelle toujours les heuristiques de `src/lib/agent-gates.ts:360-367`). Le corpus R1 échoue en G3 après 50 étapes et 3,34 $ (`corpus/results/corpus-2026-10-30-mvure2tu.json`) sans qu'on sache quelle part revient à l'agent et quelle part à la jauge.
2. **Aucune preuve par fabrication.** Registre R1–R3 vide (`14-TEMPLATES-PREUVE-FABRICATION.md:87-93`), templates « en-validation » à brochage indicatif, T2 (RP2040) sans quartz ni flash.
3. **Le prompt est un script, pas un agent.** `src/lib/prompts/agent-system.ts` impose un « PROCESSUS OBLIGATOIRE » numéroté en 8 étapes. OpenCode fait l'inverse (référence §3) : un cœur de ~15 lignes de principes, des connaissances chargées à la demande, des garde-fous dans le code.
4. **Design et approvisionnement sont fusionnés.** Si un composant est hors stock ou hors des 20 catégories JLCPCB exposées (`src/lib/jlc.ts:16-64`), l'agent doit s'arrêter (« signaler au lieu d'inventer », prompt actuel ligne 43) — alors qu'un PCB nu ne demande aucun stock. Le stock ne concerne que l'assemblage PCBA.
5. **L'utilisateur est prisonnier du chat.** Aucun éditeur de code dans l'UI alors que `PUT /api/projects/[id]/files` existe ; BOM d'aperçu encore simulée (`src/components/preview-panel.tsx:240-258`) ; onglet Validation figé sur « pending » (`:282-305`) ; un projet = un blob JSON unique (fichiers + versions + conversation).

## 2. Principes directeurs V2

- **Liberté de chemin, invariants de destination.** L'agent choisit son ordre de travail ; seuls comptent les résultats vérifiés par les checks et les approbations humaines. Les interdits vivent dans le code (permissions, gates serveur), pas seulement dans la prose du prompt.
- **Vérité des jauges avant optimisation.** Aucun travail de prompt, de modèle ou de corpus n'a de sens tant que G1–G3 ne mesurent pas le réel.
- **Preuve par fabrication avant promesse.** Aucune carte, aucun template n'est dit « vérifié » sans commande, réception et test consignés (règle déjà écrite en doc 05 §6 et doc 14 — elle devient bloquante pour toute communication externe).
- **Le spécialiste garde la main.** Tout ce que l'agent produit est lisible, éditable et récupérable hors de l'outil (dossier projet, exports KiCad).
- **Extensible par la communauté.** Skills, modes et providers s'ajoutent sans modifier le cœur (modèle OpenCode : fichiers Markdown + configuration, pas de code).

## 3. Chantier A — Prompt en couches, modes, skills (décision D16)

### 3.1 Référence OpenCode (vérifiée sur le code source, branche `dev`)

- Prompt cœur : `packages/core/src/session/runner/prompt/system.txt` — 15 lignes, 756 octets. Rôle, principes de vérification, communication. Aucune étape numérotée.
- Guidance outils générée dynamiquement selon les outils présents (`packages/core/src/session/system-prompt.ts:9-27`).
- Overlays courts par famille de modèle (`gpt.txt`, `meta.txt`, `anthropic.txt` dans `packages/core/src/plugin/system-prompt/`).
- Agents = profils Markdown/JSON : prompt + modèle + permissions ordonnées `allow/ask/deny` par action et ressource, `steps` optionnel. Modes `primary`/`subagent`. Builtins : `build` (défaut), `plan` (n'écrit pas), `explore`/`general` (sous-agents).
- Skills : dossiers `SKILL.md` ; seul `id + description` est annoncé au modèle, le corps est chargé à la demande par l'outil `skill`. Les fichiers d'appui restent à côté, non chargés par défaut.
- Instructions projet (`AGENTS.md`) découvertes et injectées par-dessus le tout.
- Dernière étape : les outils sont retirés, le modèle résume en texte.

### 3.2 Cible NIATOLIP

**Couche 1 — cœur (~20 lignes, stable, versionné).** Rôle, invariants (jamais inventer une référence ; jamais déclarer vert un check non exécuté ; toute limite déclarée), autonomie (ordre libre, changement de stratégie après 2 échecs), destination (définition d'une carte « terminée »). Aucune numérotation de processus.

**Couche 2 — guidance outils.** Générée depuis le catalogue d'outils réellement exposé au run (une règle courte par outil présent), comme OpenCode. Supprime la ligne « DISIPLINE D'OUTILS » générique actuelle.

**Couche 3 — overlay modèle.** Un court texte par famille (Meta / OpenAI), limité aux particularités provider (dont `tool_choice: "auto"` côté Meta, déjà imposé par le code `src/lib/models.ts:30-36`).

**Couche 4 — modes (profils).**

| Mode | Type | Écrit ? | Usage |
|---|---|---|---|
| `plan` | primaire | Non (sourcing et lecture seuls) | Explorer, sourcer, proposer une architecture. Remplace l'étape H1 scriptée : la gate H1 devient l'approbation de sortie du mode plan. |
| `build` | primaire (défaut) | Oui | Conception complète jusqu'aux exports. |
| `review` | sous-agent | Non | Relecture en contexte frais : netlist, BOM, statuts de sourcing, avant H2. |
| `explore` | sous-agent | Non | Recherche composants/datasheets à gros volume de résultats, résumé seul remonté au parent. |

Permissions par mode (action × ressource × `allow/ask/deny`) : `writeFile/patchFile` en `ask` hors mode build, `exportManufacturingPack` toujours en `ask`, recherches et évaluations en `allow`. Les 4 `toolApproval` actuels (`src/app/api/chat/route.ts:243-251`) deviennent la première instance de ce système, pas un cas particulier.

**Couche 5 — skills domaine (chargés à la demande).** Chaque skill = un dossier avec `SKILL.md` + références. Contenu initial :

| Skill | Contenu | Source actuelle |
|---|---|---|
| `tscircuit-syntax` | Syntaxe, éléments, workflow, checklist | **Skill officiel tscircuit épinglé** (`src/lib/skills/tscircuit/`, voir §11) chargé à la demande ; `04-TSCIRCUIT-RULES.md` ne contient plus que l'overlay produit |
| `sourcing-jlc` | Familles, unités SI, équivalents, échelle de repli §4.3 | Prompt actuel §processus 2 + doc 14 §catalogue |
| `placement-routage` | Stratégies quand G2/G3 rougissent, lecture des diagnostics natifs | `12-RAPPORT-AUDIT-GATES.md` (enseignements) |
| `structuration` | Quand et comment passer en multi-fichiers (§5) | Nouveau |
| `composants-custom` | Créer un composant hors catalogue depuis datasheet (§4.3) | Nouveau |
| `revue-fabrication` | Checklist pré-H2, limites à déclarer | Doc 05 §6, doc 14 |

**Couche 6 — instructions projet.** Un fichier d'instructions par projet (dans le dossier projet, §6) : contraintes utilisateur persistantes (mode d'assemblage, fabricant, budget, connecteurs imposés). Injecté à chaque run du projet.

**Fin de run.** À la dernière étape, outils retirés, résumé texte obligatoire (comportement OpenCode) — en plus du plafond 50 étapes existant.

### 3.3 Ce qui est supprimé

Le « PROCESSUS OBLIGATOIRE » en 8 étapes et la redondance `evaluateCircuit` puis checks séparés (le prompt actuel demande les deux alors que `evaluateCircuit` exécute déjà G0–G3). La séquence H1 → G0–G3 → G4/G5 → H2 → export reste la **destination par défaut suggérée**, pas un script : les gates serveur (chantier D) en imposent les points de passage réels.

## 4. Chantier B — Sourcing découplé du design (décision D17)

### 4.1 Mode d'assemblage par projet

Choisi à H1, stocké dans le manifeste du projet, modifiable ensuite : `pcba-jlcpcb` / `pcb-seul` (soudure manuelle) / `autre-fabricant` / `indecis`. Il conditionne les gates d'export (§4.4), jamais le droit de concevoir.

### 4.2 Statuts de sourcing dans `parts.json`

Chaque ligne porte un statut explicite (remplace le binaire tracé/non-tracé actuel de `getCircuitSummary`) :

| Statut | Signification | Bloque le schéma ? | Bloque le PCB nu ? | Bloque le PCBA ? |
|---|---|---|---|---|
| `verified` | LCSC cherché dans le run, footprint vérifié | Non | Non | Non |
| `out_of_stock` | LCSC réel, stock 0 à `stock_checked_at` | Non | Non | Oui (sauf dérogation §4.4) |
| `generic` | Footprint standard (footprinter : 0603/0805, SOT-23, SOIC…), pas de LCSC | Non | Non | Oui (à sourcer avant commande) |
| `custom` | Défini par l'utilisateur/datasheet, pinout déclaré | Non | Non | Oui (confirmation pinout exigée) |
| `missing` | Ni footprint ni référence | **Oui** | Oui | Oui |

Le stock est une donnée datée (`stock`, `price`, `stock_checked_at` par ligne), revérifiée à l'export. Un stock périmé produit un avertissement, pas un verdict éternel.

### 4.3 Échelle de repli quand un composant est introuvable ou hors stock

L'agent ne s'arrête plus sur « pas de table » (prompt actuel, ligne 43). Il descend l'échelle et déclare où il s'est arrêté :

1. Équivalent en stock, même footprint et même valeur → proposition de substitution à l'utilisateur.
2. Footprint générique + valeur → statut `generic`, carte entièrement réalisable, sourcing reporté et listé au rapport.
3. Composant custom : l'utilisateur fournit MPN + datasheet (ou tableau de brochage) → fichier `components/<ref>.tsx` (§5), statut `custom`, pin 1/orientation à confirmer visuellement avant H2.
4. Aucune option : question explicite à l'utilisateur avec les options chiffrées — jamais de blocage silencieux, jamais d'invention.

### 4.4 Gates d'export scindées (avec le chantier D)

- **G5-PCB** : Gerber + BOM de design cohérents → export « PCB nu » possible dès G4 vert, quel que soit le stock.
- **G5-PCBA** : stock, PnP complet (coordonnées obligatoires), couverture BOM ↔ composants du circuit, `footprintVerified` → exigée seulement en mode `pcba-jlcpcb`.
- **Dérogation tracée** : en mode PCBA, l'utilisateur peut signer « je sourcerai/souderai moi-même les lignes X » ; la dérogation est consignée dans le rapport de validation et le pack est étiqueté en conséquence. L'étiquette « validé » sans dérogation reste impossible sur G5-PCBA rouge.

## 5. Chantier C — Multi-fichiers (décision D18)

État technique vérifié : le moteur le permet déjà (`writeFile` accepte les sous-chemins, `src/lib/agent-run.ts:103-125` ; l'éval exécute un `fsMap` complet, `src/lib/tscircuit-eval.ts:101`). Ce qui manque est la convention et la cohérence des points d'entrée.

1. **`resolveEntrypoint()` unique et partagé** (agent, preview, worker, corpus). Corrige au passage le bug actuel : la preview prend le premier fichier par ordre alphabétique (`src/components/preview-panel.tsx:73`) quand l'agent cherche `main.tsx`/`index.tsx` (`src/lib/agent-run.ts:128-132`).
2. **Convention** (skill `structuration`) : `main.tsx` = assemblage du `<board>` uniquement ; un module par fonction (`power.tsx`, `mcu.tsx`, `sensors.tsx`) exportant des sous-circuits ; composants custom sous `components/`. Seuil indicatif de bascule : ~12–15 composants ou ~300 lignes dans `main.tsx`.
3. **Spike de validation avant généralisation** : un fixture 2 fichiers avec import relatif, évalué par le harnais (dry-run corpus) ; le multi-fichiers n'est annoncé au prompt que si le spike est vert sur l'éval navigateur **et** serveur.
4. **Outils complétés** : `readFile` avec `offset/limit` (aujourd'hui tronqué à 8 000 caractères sans pagination), recherche texte dans les fichiers du projet. Pas de suppression/renommage tant qu'un besoin réel ne l'exige pas.

## 6. Chantier D — Vérité des gates et dossier projet (décisions D19, D20)

### 6.1 Gates (prérequis de tout le reste — reprend l'issue #10 déjà décidée)

1. Migration G1–G3 vers les diagnostics natifs tscircuit (`*_error` + `@tscircuit/checks` épinglé en dépendance directe), suppression des heuristiques maison condamnées par doc 12.
2. G5 scindée (§4.4) ; PnP sans coordonnées = échec ; couverture BOM ↔ `source_component` comparée ; stock inconnu ≠ vert en mode PCBA.
3. Séquence imposée **côté serveur** : `g0g3` recalculé par le serveur (jamais déclaré par l'appelant — aujourd'hui stocké tel quel, `src/app/api/projects/[id]/validate/route.ts:15-39`), H2 vérifiée avant l'export « validé », artefacts d'un job rouge non téléchargeables sous étiquette « validé ».
4. Cache d'évaluation incluant les versions tscircuit/checks dans la clé (aujourd'hui contenu seul, `src/lib/agent-run.ts:142-152`).

### 6.2 Dossier projet = source de vérité des fichiers (D19)

```text
projects/<uuid>-<slug>/
├── project.json            # manifeste : nom, mode d'assemblage (§4.1), modèle, dates
├── src/
│   ├── main.tsx            # point d'entrée unique
│   ├── power.tsx  mcu.tsx  # modules fonctionnels (§5)
│   └── components/         # composants custom (§4.3)
├── parts.json              # BOM + statuts de sourcing (§4.2)
├── versions/
│   └── 001-<label>/        # copie intégrale de src/ + parts.json
├── reports/
│   ├── validation-<job>.md
│   └── agent-searches.json # traçabilité JLC (aujourd'hui caché dans le blob)
├── artifacts/<job-id>/     # gerber.zip, bom.csv, pnp.csv, project-kicad.zip, sources.zip
└── conversation.jsonl      # historique append-only
```

- Postgres ne conserve que l'index (id → chemin, métadonnées, jobs, utilisateurs futurs). Le mode « fichiers JSON » actuel disparaît comme backend de stockage (le dossier le remplace) ; `DATABASE_URL` reste le mode Docker nominal.
- Migration : script unique éclatant les `projects/<uuid>.json` existants (les champs correspondent 1:1 : `working_files`, `versions`, `conversation`) — avec vérification d'égalité avant/après et conservation des originaux tant que la migration n'est pas validée.
- Garde-fous conservés : écriture atomique tmp+rename (déjà le pattern de `src/lib/projects.ts:178-184`), validation anti-`..` (déjà `validatePath`), verrou d'écriture par projet (corrige la concurrence signalée en revue : read-modify-write sans verrou).
- Bénéfices attendus : projet ouvrable dans un éditeur externe (débloque l'édition spécialiste), `git init` possible par projet, partage/export = archive du dossier, exemples de corpus = dossiers versionnables.

### 6.3 Surfaces UI à rendre honnêtes (dans la même phase)

Onglet Validation branché sur `GET /api/validation-jobs/[id]` (existe, jamais appelé par l'UI) ; BOM d'aperçu dérivée de `parts.json` avec statuts §4.2 ; suppression des surfaces simulées (BOM prototype, badge « Checks OK » permanent `src/components/top-bar.tsx:65`, boutons sans handler, circuit jouet affiché par défaut sur projet vide) ; éditeur de code minimal (arbre de fichiers + édition + sauvegarde via l'API existante) avec diff avant/après patch de l'agent.

## 7. Séquencement et critères de sortie

| Phase | Contenu | Critère de sortie mesurable |
|---|---|---|
| **P0 — Jauges vraies** | §6.1 (migration native, G5 scindée, séquence serveur) | Cas Graetz de doc 12 vert sans contournement ; suite de fixtures gates (circuits sains et fautifs connus) verte ; aucun faux vert PnP/stock reproduit |
| **P1 — Preuve** | Corpus R1–R5 complet sur jauges natives ; commande R1 | ≥ 4/5 cartes G0–G3 vertes au corpus ; **R1 commandée, reçue, testée, registre doc 14 rempli** |
| **P2 — Liberté de l'agent** | Chantier A (cœur, modes, skills, permissions) + chantier B (statuts, modes d'assemblage, échelle de repli) | Corpus repassé sans régression vs P1 ; un run complet « composant hors stock » aboutit à un export PCB nu étiqueté correctement ; prompt cœur ≤ ~30 lignes |
| **P3 — Mains de l'utilisateur** | Chantier C (multi-fichiers) + chantier D §6.2–6.3 (dossier projet, UI honnête, éditeur) | Fixture multi-fichiers vert navigateur+serveur ; projet migré ouvrable et éditable hors UI ; zéro surface simulée à l'écran |
| **P4 — Ouverture** | Publication open source : LICENSE, README d'installation, CI (build + fixtures + dry-runs), dépendances épinglées, provider générique compatible OpenAI (l'import KiCad est en P3) | Un tiers installe depuis le README seul ; CI verte sur PR ; aucune clé ni donnée dans l'historique |

Ordre imposé : **P0 avant P2** (inutile de libérer un agent mesuré par des jauges fausses), **P1 avant toute communication externe**. P3 peut démarrer en parallèle de P2 après P0.

## 8. Nettoyage documentaire (fait et à faire)

### Fait le 2026-10-30 (avec ce plan)

- `11-BENCHMARK-M0.md` **supprimé** : benchmark jouet à n=1 par modèle, OpenAI jamais testé, contredit par le corpus réel ; son protocole ne doit plus décider du modèle par défaut. (Le script `scripts/benchmark-models.ts` le régénère via `--write-docs` : sa refonte ou son retrait est une tâche P2, le jouet statique `src/lib/toy-agent.ts` servant d'évaluateur en fait partie.)
- `08-ROADMAP-BACKLOG.md` **réécrit** : les jalons M0–M4 du 2026-10-29 ne décrivaient plus l'état réel.
- `README.md` (index) : décisions D16–D20 ajoutées, statut corrigé.
- `AGENTS.md` : section « État actuel » réécrite (backend, agent, worker et corpus existent ; la preuve par fabrication est le manque central).

### À faire, par phase

| Doc | Disposition | Quand |
|---|---|---|
| `03-AGENT-TOOLS-LOOP.md` | **Réécrire** : contrat des modes, permissions, skills ; le « processus obligatoire » disparaît. Bannière « supersédé par doc 15 » en attendant. | P2 |
| `07-DATA-API.md` | **Réécrire** : dossier projet source de vérité, index Postgres, suppression des tables fantômes (`runs`, `component_cache`…), vérité sur le worker (accès base direct, contrairement à l'ancien § — à assumer ou à corriger par une route interne, décision à trancher en P3). Bannière en attendant. | P3 |
| `02-MODELS-AI-SDK.md` | Mettre à jour : checklist §7 jamais cochée, repli `gpt-5-mini` codé en dur (`src/lib/models.ts:75`) contraire au § « aucun ID figé », budget OpenAI inopérant (prix à 0). Bannière en attendant. | P2 |
| `00-PRD.md`, `01-ARCHITECTURE.md` | Mettre à jour : modes d'assemblage, dossier projet, évaluation serveur (déjà la réalité, jamais actée), critères d'acceptation toujours à 0/3 — le dire. | P1–P3 |
| `04-TSCIRCUIT-RULES.md` | **Fait le 2026-10-30** : réécrit en overlay produit mince (sourcing D17, correspondance checks ↔ gates, périmètre, checklist H2) ; syntaxe/éléments/workflow délégués au skill officiel épinglé `src/lib/skills/tscircuit/` (§11). | Fait |
| `05-VALIDATION-FABRICATION.md` | Mettre à jour : G5-PCB/G5-PCBA, dérogation tracée, séquence serveur. | P0 |
| `06-UX-SPEC.md` | Mettre à jour : éditeur, validation réelle, BOM réelle, modes plan/build. | P3 |
| `09-RISKS.md` | Mettre à jour : risques déjà matérialisés (routage, coûts — 3,34 $ le run R1 en échec, disponibilité Meta — 3 échecs API sur 5 fichiers corpus) marqués comme tels. | P1 |
| `12-RAPPORT-AUDIT-GATES.md` | **Conserver** tel quel jusqu'à la fin de P0 (c'est la référence de la migration), puis archiver en historique. Ne pas supprimer avant. | P0 |
| `13-CORPUS-R1-R5.md` | Remplir l'historique (vide aujourd'hui alors que des runs existent), republier les scores après P0. | P0–P1 |
| `14-TEMPLATES-PREUVE-FABRICATION.md` | Conserver ; ne passer aucun template « vérifié » avant fabrication (le titre du commit `d2101ee` disait le contraire — ne pas reproduire). Retirer l'affirmation « G0–G3 verts » tant qu'elle n'est pas re-prouvée sur jauges natives. | P1 |
| `10-WEBGPU.md` | Conserver tel quel (guide opérationnel toujours valide). | — |

## 9. Ce que ce plan ne change pas

D1 (tscircuit), D5 (KiCad juge final), D7/D8 (périmètre 2 couches basse vitesse et exclusions), D9 (pas de `-contributor` par défaut), D13 (JLCPCB premier fabricant — mais plus jamais bloqueur de conception, §4), D15 (identité UI). Un run = un modèle choisi avant le run ; 50 étapes max par itération ; clés côté serveur uniquement ; `kicad-cli` uniquement dans le worker Docker.

## 10. Questions ouvertes (à trancher avant ou pendant la phase indiquée)

1. **P3** — Le worker garde-t-il son accès base direct (réalité actuelle, contraire à l'ancien doc 07) ou revient-on à une route interne authentifiée ? Impact : surface de sécurité du conteneur qui exécute du code généré.
2. **P2** — Le mode `plan` remplace-t-il entièrement la gate H1 actuelle (formulaire éditable), ou le formulaire reste-t-il comme vue d'approbation du plan produit en mode plan ?
3. **P4** — Nom public (D14 toujours ouvert) et licence (MIT vs Apache-2.0) : à trancher avant toute publication, pas avant.
4. **P2** — Providers : le provider générique compatible OpenAI (URL + clé configurables) entre-t-il en P2 ou reste-t-il en P4 ? Il conditionne l'usage de modèles locaux par la communauté.

## 11. Réutilisations officielles tscircuit (ajout validé le 2026-10-30)

Principe : ne pas recoder ce que l'écosystème tscircuit (github.com/tscircuit) fournit déjà. Inventaire vérifié le 2026-10-30 (dépôts, Context7 `/tscircuit/docs` et `/tscircuit/jlcsearch`) :

| Besoin | Réutilisation | Phase |
|---|---|---|
| Checks G1–G3 natifs | `@tscircuit/checks` épinglé en dépendance directe (`runAllNetlistChecks`, `runAllPlacementChecks`, `runAllRoutingChecks`, `runAllSchematicChecks` + ~50 checks) — déjà présent en transitif dans `node_modules`, seul l'appel manque | P0 |
| PnP fabrication | `circuit-json-to-pnp-csv` officiel — remplace le fallback PnP maison sans coordonnées (faux vert G5) | P0 |
| DRC/specs fabricant JLCPCB | `@tscircuit/fabricator-drc`, `jlcpcb-manufacturing-specs`, `jlcpcb-stackups` — alimentent G5-PCB/G5-PCBA au lieu d'heuristiques locales | P0–P1 |
| Skill syntaxe/workflow | Skill officiel `tscircuit/skill` **copié épinglé** dans `src/lib/skills/tscircuit/` (commit `ccfd1afbefa0`, MIT) avec note d'adaptation web `NIATOLIP.md` ; branchement agent en P2-3. En conséquence `docs/04` est réduit à l'overlay produit (§8 mis à jour) | Fait (copie) / P2 (branchement) |
| Catalogue composants | jlcsearch sert ~55 tables ; NIATOLIP n'en expose que 20 codées en dur (`src/lib/jlc.ts`) — élargissement = donnée, pas code. `digikeysearch.tscircuit.com` à évaluer comme 2e source (équivalent du `tsci search --digikey`) | P2 |
| Import KiCad | `kicad-to-circuit-json` + `circuit-json-to-tscircuit` (+ `easyeda-converter`, `kicad-component-converter` pour les footprints) — l'import avance de P4 à **P3** | P3 |
| Composants et gabarits | `templates/` du skill officiel (copiés), `@tscircuit/common` (form factors, composants communs) — en plus des templates produit T1–T3 | P2–P3 |
| Corpus/benchmark | Méthodologie `pcb-generation-benchmark01` (prompts étiquetés difficulté/sujet), `dataset-tsx35-kicad-boards` (25 cartes TSX vérifiées), `sparkfun-boards` — références pour P1, sans réécrire un harnais maison | P1 |
| SPICE (backlog) | `ngspice-spice-engine`, `circuit-json-to-spice` — remplacent l'évaluation de `spicets` jamais utilisé | Backlog |

Le skill officiel suppose un agent CLI (`tsci`, Bash) : chaque `tsci check X` se traduit en appel programmatique `@tscircuit/checks`, `tsci search` en outil `searchComponents` (table de correspondance dans `src/lib/skills/tscircuit/NIATOLIP.md`).
