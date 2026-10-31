# Validation et fabrication — gates G0 à G5

| Version | 1.1 — 2026-10-31 (P0-3 : séquence serveur, issue #14) |
|---|---|
| Principe | **Un DRC propre prouve que les règles géométriques sont respectées, pas que la carte fonctionnera.** Les gates réduisent le risque ; elles ne le suppriment pas. La validation humaine H2 reste obligatoire. |

> **Décision du 2026-10-30 (audit, cas réel Graetz)** : les verdicts G0–G3 migrent **intégralement** vers les diagnostics natifs tscircuit (`*_error` du rendu + runners `@tscircuit/checks`) ; les gates fait-maison sont supprimées. Voir [12-RAPPORT-AUDIT-GATES.md](./12-RAPPORT-AUDIT-GATES.md), implémentation dans l'issue #10. En cas de contradiction entre ce document et le rapport, le rapport fait foi jusqu'à mise à jour de la présente page par l'issue #10.

---

## 1. Les gates

| Gate | Contrôle | Exécuté par | Bloquant pour |
|---|---|---|---|
| G0 | Le code s'évalue sans erreur (éléments `*_error` du rendu, `summarizeCircuitJson`) | WebWorker navigateur + CircuitRunner serveur | Toute suite du run |
| G1 | Netlist native : `runAllNetlistChecks` + `runAllPinSpecificationChecks` (seuls `*_error` bloquent) | Serveur (copie d'évaluation) | Placement |
| G2 | Placement natif : `runAllPlacementChecks` (seuls `*_error` bloquent) | Serveur | Routage |
| G3 | Routage natif : `runAllRoutingChecks` sur copie — le runner mute son entrée (seuls `*_error` bloquent ; jamais jugée si G2 rouge car le core skippe le routage) | Serveur (autorouteur intégré) | Gate fabrication |
| G4 | ERC + DRC sur le fichier KiCad exporté (`kicad-cli sch erc` / `pcb drc`, format JSON, code de sortie pris en compte) | Worker KiCad | Revue H2 |
| G5-PCB | PCB nu : BOM design (refs + couverture `source_component`), Gerber généré, plancher JLCPCB (`jlcMinTolerances`, `fabricator-drc` en warning) | Worker + specs | Export du pack |
| G5-PCBA | Assemblage (souple) : LCSC + PnP officiel `circuit-json-to-pnp-csv` (coordonnées obligatoires, `supplier:'jlcpcb'`), couverture triple, rupture 0 = erreur ; stock inconnu, footprint non vérifié, statuts non-`verified`, rotations non résolues = warnings « à vos risques » | Worker + jlcsearch | Étiquette PCBA du pack (non bloquante) |

Règles :

- Les gates sont **séquentielles** : une gate n'est jamais jugée si une gate antérieure est rouge (G1 bloquée si G0 rouge, G2 si G0/G1, G3 si G0/G1/G2 — rapport `judged: false` + `blocked`). Interdiction de valider G3 si G2 est rouge. Les outils `check*` et `evaluateCircuit` propagent `judged`/`blocked` tels quels : une gate « non jugée » n'est jamais à « corriger ».
- Protocole anti-« gate menteuse » (doc 12 §6) : divergence {verdict × erreurs natives du rendu} journalisée (`gate-divergences.jsonl`, sous `projects/.cache/gates/`, globale au déploiement par choix — le comportement d'une règle native dépend de la version des checks, pas du projet ; volatil comme le cache d'éval), 3 hashes distincts sur la même règle → quarantaine auto (`error → warning` + escalade humaine, réactivation uniquement par humain). Un snapshot pris sous verdict déclassé est tamponné (« quarantaine: … ») dans son libellé et remonté (`quarantined`) dans la réponse d'évaluation. Corpus et `templates:check` sont des mesures de référence : quarantaine explicitement ignorée, divergences remontées en clair.
- Garde-fou de boucle actuel : consigne « 2 échecs identiques → changer de stratégie » (`noteFailure`). Les budgets différenciés doc 12 §6.3 (G1/G2 : 5 échecs puis escalade, G3 : 3 tentatives avec variation imposée) ne sont **pas** implémentés — voir backlog.
- Un échec de gate renvoie à l'agent un rapport structuré (type, sévérité, composant/net concerné, message) — jamais un simple « ça a échoué ».
- Aucun contournement par l'agent : il ne peut ni abaisser un seuil, ni marquer une gate comme passée manuellement.
- **Séquence imposée côté serveur (P0-3, issue #14)** : `g0g3` est **recalculé** par le serveur (`src/lib/sequence.ts` : `evaluateFullServer` + `runAllGates` natifs) à chaque `POST /validate` et `requestManufacturingValidation` — le champ déclaré par l'appelant est ignoré. Snapshot rouge → `409 gates_not_green`, ni version ni job créés. La traçabilité sourcing (`parts.json` vs `.agent-searches.json`) est jointe au snapshot en **warning non bloquant** (D17) et surfacée dans la réponse. L'export « validé » (`POST /export`, `exportManufacturingPack`) exige en plus une **H2 serveur** postérieure au job (`src/lib/approvals.ts`, table `approvals` + `POST /projects/:id/approvals`, enregistrée par l'outil `requestFinalApproval` sur approbation explicite). Les artefacts de fabrication (`gerber/bom/pnp/kicad`) d'un job non vert sont refusés au téléchargement (`409 gates_not_green`) — `sources.zip` et le rapport restent accessibles pour le debug (choix assumé : debug avant tout).
- **Limite assumée (prototype mono-user sans auth, D12 — fermeture en P4-2)** : `POST /approvals` et `POST /messages` restent appelables directement en local ; un opérateur local peut s'auto-approuver. L'agent, lui, ne peut pas contourner : son approval serveur n'existe que sur clic réel (toolApproval user-approval). Aucun faux vert possible via `g0g3` inventé, export sans H2 enregistrée, ou artefact d'un job rouge.
- L'utilisateur peut télécharger un projet **non validé** (export KiCad/code source) à tout moment, mais le pack fabrication « validé » exige G0–G4 + G5-PCB verts + H2. G5-PCBA souple (warnings) est étiquetée dans le pack, jamais bloquante.

## 2. Auto-revue visuelle (avant H2)

Après G3, l'agent :

1. capture un snapshot PCB (et schéma si le design est non trivial) via `snapshotBoard` ;
2. le soumet au modèle multimodal avec une consigne de revue fixe : orientation des connecteurs, pin 1, composants hors carte, découplages visibles près des alimentations, sérigraphie, zones manifestement problématiques ;
3. corrige ce qui est corrigeable par le code, et **déclare explicitement** ce que la revue visuelle ne peut pas prouver.

La revue visuelle est un filet supplémentaire, pas une gate : elle ne peut pas transformer un échec G1–G5 en succès.

## 3. Gate fabrication KiCad (worker)

**Où s'exécute `kicad-cli`** : uniquement dans le conteneur Docker du worker, côté serveur (voir doc 01 §3.3 et §3.5). L'utilisateur n'a pas KiCad sur son PC et n'en a jamais besoin : en mode hébergé il ouvre une URL ; en mode auto-hébergé, une seule commande (`docker compose up --build`) démarre web + base + worker. La version de KiCad est épinglée dans l'image Docker et citée dans chaque rapport.

Pipeline du job (doc 01 §3.3) :

```
snapshot des fichiers (version N)
  → build/export tscircuit (format KiCad)
  → kicad-cli sch erc  --format json
  → kicad-cli pcb drc  --format json --exit-code-violations
  → si ERC/DRC bloquants : rapport à l'agent, pas d'exports finaux
  → exports : Gerber (par couche), perçage, positions (PnP)
  → BOM consolidée + revérification stock JLCPCB
  → génération du rapport de validation
```

Versions KiCad et tscircuit du worker épinglées dans l'image et inscrites dans le rapport. Toute violation DRC « warning » est listée dans le rapport ; seuls les bloquants (erreurs, nets non connectés) empêchent G4, mais les warnings sont visibles en H2.

> **Fix G4 P0-6 #28 (2026-10-31, vérifié par repro locale sous image
> `kicad/kicad:9.0` + job E2E Graetz vert)** — trois couches, prouvées dans
> l'ordre :
> 1. **Chargement** : le refus ERC n'était PAS les pins rail à 0,01 mm
>    (les power symbols natifs KiCad utilisent `length 0`) mais le token
>    `(power global|local)` émis par `circuit-json-to-kicad`
>    (`SymbolPower("global")` sur `Custom:rail_up/down`) : format v10 rejeté par
>    `kicad-cli 9.0.9` (« Failed to load schematic », exit 3). Rationnel complet
>    dans `normalizeKicadSchPower` (`worker/src/g5.js`) ; le worker normalise en
>    `(power)` avant ERC (occurrence tracée en warning dans le rapport).
> 2. **ERC** : `power_pin_not_driven` (aucun `power_out`/PWR_FLAG dans les
>    designs tscircuit) et `pin_not_connected` (pins NC flottantes) se règlent
>    au niveau design, sans toucher aux seuils : `pinAttributes`
>    (`VOUT: { providesPower }`, `GND: { providesGround }`,
>    `NC: { doNotConnect }`) → pins `power_out` et marqueurs `no_connect`
>    KiCad via le convertisseur. Voir `fixtures/g5-e2e/graetz.tsx` (référence
>    G0–G3 `fixtures/gates/healthy-graetz.tsx` inchangée).
> 3. **DRC** : les violations `hole_clearance` 0,15–0,19 mm vs règle 0,2 mm
>    restent des ERREURS bloquantes G4 — c'est la spec JLCPCB publique
>    « Via hole to Track : 0,2 mm » (https://jlcpcb.com/capabilities/pcb-capabilities),
>    ni artefact convertisseur ni warning fabricant (la surcharge via < 0,3 mm
>    reste elle un warning `fabricator-drc`). Cause : repli marge obstacle
>    0,15 du solveur < 0,2 requis (bug upstream) + angle mort natif
>    (`getHoleGeometries` ne voit que `pcb_hole`, jamais les trous de `pcb_via` —
>    G3 vert sur board fautif). En attendant le fix upstream, le board E2E
>    passe en 90×70 mm pour aérer le routage ; aucune décote DRC ici.

## 4. Pack fabrication (livrable utilisateur)

| Fichier | Contenu |
|---|---|
| `gerber.zip` | Gerbers + fichier de perçage |
| `bom.csv` | Référence, designators, quantité, LCSC, prix unitaire constaté, stock constaté (avec date) |
| `pnp.csv` | Pick-and-place au format attendu par JLCPCB |
| `project-kicad.zip` | Projet KiCad exporté, rouvrable par l'utilisateur |
| `sources.zip` | Code tscircuit du projet (version exacte validée) |
| `validation-report.md` | Gates G0–G5, versions d'outils, warnings, limites connues, date de revérification stock |

## 5. Limites assumées (à afficher dans le rapport)

- Pas de simulation électrique (SPICE) au MVP : un schéma « DRC propre » peut être électriquement faux (mauvaise valeur, découplage insuffisant, thermique).
- Pas de vérification d'intégrité de signal ni d'impédance (hors périmètre D8).
- Stock/prix JLCPCB valables à l'instant de la revérification G5 uniquement.
- La première fabrication d'un nouveau design reste un **prototype** : recommander à l'utilisateur de commander en petite quantité et de tester avant toute série.

## 6. Procédure de preuve par fabrication (jalon M2/M3)

Pour chaque carte du corpus de référence (doc 08) :

1. génération par l'agent sans modification manuelle du code ;
2. commande chez JLCPCB (PCB + assemblage si applicable) ;
3. test fonctionnel selon une fiche de test écrite **avant** la commande ;
4. résultat consigné : fonctionne / fonctionne avec retouches / échec + cause racine ;
5. si échec imputable à l'agent : ajout d'une règle (doc 04), d'un check ou d'une correction de template, puis régénération.

Aucune carte n'est déclarée « supportée » sur la seule base d'un DRC vert.
