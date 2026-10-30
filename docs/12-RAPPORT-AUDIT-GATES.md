# Rapport d'audit — gates G0–G3 : migration complète vers les checks natifs tscircuit

| | |
|---|---|
| Version | 1.0 — 2026-10-30 |
| Statut | Décision prise : réimplémentation complète (issue #10). Ce rapport est la référence de l'issue. |
| Déclencheur | Cas réel utilisateur : pont de Graetz + filtrage + régulateur 12 V, bloqué à tort par nos gates |
| Code audité | `src/lib/agent-gates.ts`, `src/lib/agent-run.ts`, `src/lib/tscircuit-eval.ts` |
| Versions inspectées | `tscircuit 0.0.3036`, `@tscircuit/core 0.0.2230`, `@tscircuit/capacity-autorouter 0.0.1014`, `@tscircuit/checks 0.0.265`, `@tscircuit/eval 0.0.1668`, `circuit-json 0.0.538` |

---

## 1. Le cas déclencheur (faits)

Sur un projet réel créé dans l'UI (redresseur 12 Vac → 12 Vdc + LED témoin — le 220 V avait été refusé proprement par `reportOutOfScope`, périmètre D8 respecté) :

1. L'agent source correctement (pont M7 `C95872`, filtrage 1000 µF, découplages — vrais LCSC via `searchComponents`), écrit le circuit, évalue.
2. G3 déclare des nets « non routés ». L'agent restructure : hubs en étoile, vias utilisés comme pins, chaînes pin-à-pin — **environ 65 appels d'outils** sur plusieurs itérations, sans jamais passer.
3. Le projet finit avec un `main.tsx` simplifié à 3 résistances et **aucun snapshot vert** (toujours v1 « création »).

Conclusion de l'audit : **l'agent a bien travaillé ; ce sont nos vérifications qui ont menti.** Ce rapport prouve chaque verdict et définit la cible : aucun G fait-maison.

## 2. Méthode

- **Reproduction locale** (CircuitRunner en Node, stack épinglée du dépôt) d'un circuit sain à jonction en T : 2 traces partageant un pad, puis 3 traces + traces vers `net.GND`. Résultat : autorouteur OK, **0 erreur tscircuit**, nets routés.
- **Inventaire natif** : lecture des paquets installés (`@tscircuit/core`, `eval`, `checks`, `capacity-autorouter`, `circuit-json`) et de la documentation officielle.
- **Audit de code** : chaque règle de `src/lib/agent-gates.ts` confrontée au comportement réel.
- **État de l'art** : patterns de validation recommandés pour les boucles agent hardware.

> **Divergence relevée et tranchée** : l'analyse statique des bundles récents suggérait que les `pcb_trace_id` sont des compteurs non structurés ; notre reproduction sur la stack épinglée produit des identifiants de connexion fusionnés (forme `source_trace_0__source_trace_1_mst0_0`). La leçon commune aux deux lectures : **ne jamais parser un identifiant tscircuit** (ni préfixe, ni segments) — seuls comptent les champs structurés et les erreurs natives. En cas de doute, la reproduction locale fait foi, pas la lecture de code d'une autre version.

## 3. Verdicts gate par gate

| Gate | Verdict | Motif (preuve) |
|---|---|---|
| **G0** — évaluation | ✅ **JUSTE** | Repose à 100 % sur les éléments `*_error` insérés par le core au rendu ; le test `type.endsWith("_error")` reprend la taxonomie officielle (`*_error` bloquant, `*_warning` informatif — c'est aussi ce qui fait sortir `tsci build` en code 1). Aucun critère maison. Limite : il n'existe pas d'API native `getErrors()` (vérifié par grep : `RootCircuit`/`CircuitRunner` n'exposent que `renderUntilSettled()` + `getCircuitJson()`) — notre scan du Circuit JSON est un **lecteur**, pas un vérifieur réinventé. Il doit rester. |
| **G3** — routage | ❌ **FAUSSE, bloquante** | `pcb_trace_id.startsWith(source_trace_id + "_")` : l'autorouteur travaille sur la carte de connectivité (nets fusionnés, découpage MST) ; le lien source↔pcb est N↔M et le champ `pcb_trace.source_trace_id` est unitaire et arbitraire. Repro : sur la jonction en T saine, `source_trace_1` est déclarée `unrouted` alors que le cuivre existe (0 erreur native). Sur N traces fusionnées, N−1 sont de faux négatifs. Les traces pin→`net.GND` (1 port + 1 net) produisent de faux `unrouted` supplémentaires. |
| **G1** — netlist | ❌ **FAUSSE, bloquante** | (a) `trace_incomplete` (< 2 ports) ignore `connected_source_net_ids` : toute trace idiomatique pin→net échoue alors que le circuit est sain. (b) Le warning `multi_trace_port` affirme « l'autorouteur ne route pas les jonctions en T » : **contredit par la repro** (2 puis 3 traces sur un pad fusionnées et routées, 0 erreur) et sans fondement dans doc 04. C'est ce message qui a ordonné à l'agent de restructurer des topologies saines pendant des dizaines d'itérations. (c) `trace_unknown_port` : code quasi mort (le core signale les sélecteurs invalides au lieu d'émettre des IDs pendants) — inoffensif. (d) `pin_missing_trace` : seul signal d'oubli pré-ERC mais bruyant (pins NC d'un MCU) et plafonné par la borne de 20 findings. |
| **G2** — placement | ⚠️ **PARTIELLEMENT JUSTE** | La géométrie lue (`pcb_component` width/height/center) est saine (bornes réelles post-layout, sérigraphie exclue) et la marge 1 mm est sourcée (doc 04 r11, en warning). Mais : `is_allowed_to_be_off_board` ignoré → faux positif bloquant qui contredit notre propre exception connecteur de bord ; `do_not_place` / `obstructs_within_bounds=false` ignorés ; seuil de chevauchement 0,1 mm **bloquant et arbitraire**, sans source documentaire. |
| Séquentialité (outils `check*`) | ⚠️ **TROUÉE** | Le snapshot n'a lieu que si les 4 gates passent (OK), mais `checkRouting` ignore G0/G1 rouges et `checkPlacement` ignore G0 rouge : un rapport « G3 verte » sur un circuit invalide induit le modèle en erreur. Doc 05 exige : `blocked` dès que **toute** gate antérieure est rouge. De plus, le core **skippe le routage quand le placement est KO** (sans `pcb_trace` et sans erreur de routage) : juger G3 dans ce cas punit un symptôme. |
| Cache d'évaluation | ⚠️ **PÉRIMABLE** | Le hash de contenu est exact, mais la clé du cache disque (`projects/.cache/eval/`) n'inclut pas la version de tscircuit : après un `npm install` (0.0.x cassants, cf. `AGENTS.md`), un contenu identique peut resservir un verdict produit par une autre version de l'évaluateur. |

## 4. Ce que tscircuit fournit nativement

Deux systèmes distincts, à ne pas confondre :

### 4.1 Erreurs insérées par le core au rendu (base de G0 — déjà utilisées)

Le Circuit JSON retourné contient lui-même les diagnostics : 60 types `*_error` / `*_warning` recensés dans `circuit-json 0.0.538`, dont `pcb_autorouting_error` (échec ou skip du solver), `pcb_trace_error`, `source_trace_not_connected_error`, `source_pin_must_be_connected_error`, `schematic_error`, `schematic_layout_error`, `pcb_footprint_overlap_error`, `pcb_component_outside_board_error`… Aucune API d'extraction n'existe : lecture du JSON obligatoire (notre `summarizeCircuitJson`).

### 4.2 `@tscircuit/checks` — les runners officiels (jamais appelés par le core)

Présent dans `node_modules` (dépendance transitive) mais **absent de `package.json`** : à ajouter en dépendance directe épinglée. Fonctions pures `(circuitJson) => erreurs[]` :

| Runner | Contenu réel (code, pas README) | Équivalent gate |
|---|---|---|
| `runAllNetlistChecks` | `checkPinMustBeConnected`, `checkSourcePinVoltageCompatibility`, `checkSameNameNetsAreConnected`, `checkTwoTerminalSwitchContactsOnDifferentNets` (+ warnings underspecified/no-power/no-ground) | G1 |
| `runAllPinSpecificationChecks` | spécifications de pins (tensions, connexions requises) | G1 |
| `runAllPlacementChecks` | **13 checks** : chevauchement (consolidé), hors-carte, courtyard, clearances pad/pad et cuivre/bord, vias dans les pads, keepout, cutout, accessibilité connecteurs/testpoints… | G2 |
| `runAllRoutingChecks` | **21 checks** : `pcb_trace_missing_error`, `pcb_port_not_connected_error`, épaisseur (warning), longueurs, chevauchements de cuivre, clearances pad/trace/trou/via, îlots de copper pour, traces pendantes/contiguës, hors-carte, nombre de vias… | G3 |
| `runAllSchematicChecks` | **Cosmétique uniquement** (4 checks → `schematic_component_styling_warning`). Ne jamais en faire une gate bloquante : la connectivité logique vient des erreurs de rendu (§4.1), pas de ce runner. | — |

Taxonomie : **le suffixe fait foi** — `*_error` = bloquant, `*_warning` = informatif (masquable par `--ignore-warnings` côté CLI). La doc officielle « Generating Circuit Boards with AI » prescrit l'ordre placement + netlist d'abord, routage ensuite — notre séquence G0→G3 est conforme.

### 4.3 Trous natifs connus (assumés, pas comblés en silence)

- **Net vide** (un seul port) : le core sort sans trace et **sans erreur** (« Nothing to connect… TODO warning ») ; un port non relié peut aussi ne rien produire hors `mustBeConnected`. Couverture partielle par `pcb_port_not_connected_error` du runner routing — à vérifier sur le corpus, sans réinventer de règle locale.
- **ERC électrique** (courts entre nets au niveau source, alimentations en conflit, valeurs) : non couvert.
- **LCSC / MPN / stock / disponibilité** : aucun check natif. Reste une **règle produit** (déjà dans `getCircuitSummary`), hors gates.
- **Règles fab JLCPCB** (anneau, masque, largeurs min fab) : le natif est générique. Revue humaine au MVP.
- `tsci check` est marqué « under development » : on n'enrobe pas la CLI côté serveur ; `CircuitRunner` + lecture du JSON reste le bon choix.

## 5. Décision

> **Aucun G fait-maison.** Les verdicts G0–G3 proviennent exclusivement des diagnostics natifs tscircuit. Toute logique locale de verdict (parsing d'identifiants, seuils géométriques produisant un `fail`, comptages par trace) est supprimée.

**Règle d'or** (à inscrire en doc 04) : *une gate maison ne peut pas être plus stricte que le diagnostic natif correspondant sans ADR écrite ; en cas de conflit entre une règle locale et le natif, le natif fait foi par défaut.*

Il subsiste une **fine couche d'appel**, sans logique de verdict : lancer l'évaluateur et les runners, classer les findings par famille, les borner (≤20/gate, jamais de Circuit JSON brut au modèle), appliquer la séquentialité et la politique « seuls les `*_error` bloquent ».

### Architecture cible

| Gate | Source du verdict | Bloquant si |
|---|---|---|
| G0 | Erreurs natives du rendu (§4.1) + exception/timeout d'évaluation | ≥1 `*_error` natif |
| G1 | `runAllNetlistChecks` + `runAllPinSpecificationChecks` | ≥1 `*_error` natif de ces runners |
| G2 | `runAllPlacementChecks` | ≥1 `*_error` natif |
| G3 | `runAllRoutingChecks` (+ `pcb_autorouting_error`/`pcb_trace_error` déjà vus en G0) ; jamais jugée si G2 rouge | ≥1 `*_error` natif |

Non-gates conservées telles quelles : traçabilité LCSC/stock (règle produit), conventions doc 04 dans le prompt (2 couches, découplage, pull-ups — non vérifiables nativement), gates humaines H1/H2, gates KiCad G4/G5 (issue #7), snapshot automatique à verdict vert, garde-fous de boucle (50 étapes, budget, arrêt).

## 6. Protocole anti-« gate menteuse »

Une **gate menteuse** déclare rouge avec zéro erreur native de sa famille ; une **gate aveugle** (pire) déclare vert avec des `*_error` natifs présents.

1. **Divergence automatique** : à chaque évaluation, croiser {verdict de famille} × {erreurs natives de la famille}. Toute divergence est journalisée (`gate`, `ruleCode`, verdict, erreurs natives, hash des fichiers) — même persistance que le cache d'éval.
2. **Quarantaine** : 3 divergences sur la même règle → downgrade automatique `error → warning` + escalade humaine avec reproduction minimale. Réactivation uniquement par humain. (Après migration, ceci surveille surtout les changements de comportement entre versions natives.)
3. **Budgets différenciés** : G1/G2 déterministes → 5 échecs sur la même gate puis escalade humaine ; G3 (solver, potentiellement instable) → 3 tentatives avec variation imposée (re-placement léger, effort autorouteur, simplification) puis escalade. Ne plus jamais laisser l'agent itérer jusqu'à 50 étapes sur la même gate rouge.
4. **Corpus doré** : toute modification touchant aux gates (code ou upgrade de version) doit laisser verts les cas de référence — en premier le pont de Graetz (§7). Une régression sur le corpus rejette la modification.

## 7. Cas de référence : le pont de Graetz (topologie idiomatique)

Le T sur une alimentation ne s'écrit ni en chaîne pin-à-pin forcée, ni en mono-`<trace>` à plus de 2 ports (seul motif réellement non supporté — et déjà une erreur native). L'idiome officiel : **nets nommés, une trace par pin vers le net**, l'autorouteur choisit les points de piquage :

```tsx
<net name="VRECT" />
<net name="VCC" />
<net name="GND" />
<trace from=".BR1 > .pos" to="net.VRECT" />
<trace from=".C1 > .pos"  to="net.VRECT" />  {/* filtrage */}
<trace from=".U1 > .VIN"  to="net.VRECT" />  {/* régulateur */}
<trace from=".BR1 > .neg" to="net.GND" />
<trace from=".C1 > .neg"  to="net.GND" />
<trace from=".U1 > .GND"  to="net.GND" />
```

Avec l'architecture cible : G1 voit des traces à 2 endpoints (port + net) et des nets à ≥2 ports ; G3 lit les erreurs natives de routage (0 sur ce design). Là où les anciennes gates le punissaient trois fois à tort.

## 8. Plan de migration (détail dans l'issue #10)

1. **Dépendance** : `@tscircuit/checks` en dépendance directe épinglée, alignée sur les `overrides` ; arbre à version unique vérifié par rebuild.
2. **Branchement** : runners natifs dans la couche d'évaluation serveur (attention : `runAllRoutingChecks` mute le JSON d'entrée — appeler sur copie ou en dernier) ; classification par famille, bornage, seuls les `*_error` bloquent.
3. **Suppression** : `checkG1/G2/G3` maison, matching par identifiant, warning T-jonction ; séquentialité `blocked` stricte entre outils `check*` ; versions tscircuit dans la clé de cache.
4. **Garde-fous** : journal de divergence + quarantaine ; budgets d'échecs différenciés ; étiquetage « règle produit » de la traçabilité LCSC.
5. **Preuve** : corpus doré (Graetz + références) vert avant/après ; run agent réel de bout en bout ; docs 04/05 à jour + ADR de la décision.

## 9. Risques

| Risque | Parade |
|---|---|
| `@tscircuit/checks` en 0.0.x : casse à chaque mineur (cf. `AGENTS.md`) | Épinglage strict, corpus doré rejoué à chaque upgrade, jamais de `^` lâche |
| Le natif est jeune et peut lui-même produire un faux positif | Protocole de divergence (§6) : on documente et on escalade, on ne bricole pas de correctif local silencieux ; exception seulement par ADR |
| L'autorouteur a une part d'aléa (`shuffleSeed`) : verdict limite instable entre runs | Budgets G3 avec variation imposée (§6.3) ; le cache sert le verdict du contenu exact |
| Performance des runners sur gros circuits | Checks purs sur JSON déjà calculé : négligeables devant les 20–60 s d'évaluation ; à mesurer sur le corpus |

## 10. Critères d'acceptation (rappel de l'issue #10)

- Le cas Graetz passe G0–G3 sans faux `unrouted` / `trace_incomplete`.
- Une carte volontairement fautive (net non routé, chevauchement) échoue toujours : pas de gate aveugle.
- Plus aucune logique de verdict maison : pas de parsing d'identifiant, pas de seuil géométrique local produisant un `fail`.
- Corpus doré vert, `npm run build` vert, run réel H1 → G0–G3 → H2 sans boucle sur une gate.

---

*Rapports sources : inventaire des mécanismes natifs tscircuit, audit d'exactitude des gates G1–G3 (avec reproductions), état de l'art des boucles agent hardware — analyses du 2026-10-30, lecture seule. Implémentation : issue #10.*
