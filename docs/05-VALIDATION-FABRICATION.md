# Validation et fabrication — gates G0 à G5

| Version | 1.0 — 2026-10-29 |
|---|---|
| Principe | **Un DRC propre prouve que les règles géométriques sont respectées, pas que la carte fonctionnera.** Les gates réduisent le risque ; elles ne le suppriment pas. La validation humaine H2 reste obligatoire. |

---

## 1. Les gates

| Gate | Contrôle | Exécuté par | Bloquant pour |
|---|---|---|---|
| G0 | Le code s'évalue sans erreur (`evaluateCircuit`) | WebWorker navigateur | Toute suite du run |
| G1 | Netlist : connexions attendues présentes, aucun net critique non connecté (`checkNetlist`) | tscircuit | Placement |
| G2 | Placement : aucun chevauchement, rien hors carte, espacements OK (`checkPlacement`) | tscircuit | Routage |
| G3 | Routage : 0 net non routé, violations de routage = 0 (`checkRouting`) | tscircuit (autorouteur intégré) | Gate fabrication |
| G4 | ERC + DRC sur le fichier KiCad exporté (`kicad-cli sch erc` / `pcb drc`, format JSON, code de sortie pris en compte) | Worker KiCad | Revue H2 |
| G5 | Fabricabilité : BOM complète avec références LCSC en stock revérifiées, PnP cohérent avec la BOM, Gerber généré sans erreur | Worker + jlcsearch | Export du pack |

Règles :

- Les gates sont **séquentielles** : interdiction de valider G3 si G2 est rouge.
- Un échec de gate renvoie à l'agent un rapport structuré (type, sévérité, composant/net concerné, message) — jamais un simple « ça a échoué ».
- Aucun contournement par l'agent : il ne peut ni abaisser un seuil, ni marquer une gate comme passée manuellement.
- L'utilisateur peut télécharger un projet **non validé** (export KiCad/code source) à tout moment, mais le pack fabrication « validé » exige G0–G5 verts + H2.

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
