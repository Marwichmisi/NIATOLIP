# Conventions tscircuit — overlay NIATOLIP

| Version | 2.0 — 2026-10-30 (réécriture : l'ancien doc 04 v1.0 dupliquait la syntaxe tscircuit et contenait un exemple d'API obsolète jamais testé) |
|---|---|
| Rôle | **Uniquement ce qui est propre à NIATOLIP.** Syntaxe, éléments, workflow et checklist tscircuit viennent du skill officiel épinglé dans le dépôt : `src/lib/skills/tscircuit/` (`SKILL.md`, `SYNTAX.md`, `elements/`, `templates/`, `CHECKLIST.md` ; provenance et adaptations dans `NIATOLIP.md` du même dossier). |
| Statut d'usage | Aujourd'hui : référence humaine et des reviewers. Le chargement automatique par l'agent (skill à la demande, décision D16) arrive en phase P2 du plan `15-PLAN-REFONTE-V2.md`. En cas de conflit entre cet overlay et le skill officiel, **cet overlay prime**. |

---

## 1. Sourcing (produit, inviolable)

1. Aucune référence inventée : LCSC, MPN, pinout ou footprint d'un composant principal vient d'un outil (`searchComponents`, détails pièce) ou d'une source fournie par l'utilisateur (datasheet) — jamais de mémoire du modèle.
2. Chaque ligne de `parts.json` porte un statut D17 : `verified`, `out_of_stock`, `generic`, `custom`, `missing` (définitions et effets : doc 15 §4.2). Le lien code ↔ référence se fait aussi dans le TSX quand c'est possible (`supplierPartNumbers={{ jlcpcb: ["C…"] }}` sur le `<chip>`, idiome officiel).
3. Préférer JLCPCB Basic/Preferred en stock ; toute pièce Extended est signalée dans la revue finale.
4. Le footprint vient de la référence choisie (footprinter associé) ; un footprint standard générique (0603, SOT-23…) n'est admis qu'avec le statut `generic` explicite. Orientation/pin 1 des pièces polarisées : à vérifier sur la preview avant H2.
5. Hors stock ou hors catalogue : appliquer l'échelle de repli (doc 15 §4.3 — équivalent, générique, custom datasheet, question à l'utilisateur). Ne jamais bloquer la conception pour un problème d'approvisionnement ; le stock ne contraint que l'assemblage PCBA (mode d'assemblage du projet, doc 15 §4.1).

## 2. Correspondance checks officiels ↔ gates NIATOLIP

Les gates sont des verdicts produit construits **sur** les diagnostics natifs, pas des heuristiques locales (décision D20, audit doc 12) :

| Gate | Base officielle (skill / `@tscircuit/checks`) | Verdict NIATOLIP |
|---|---|---|
| G0 | Rendu d'évaluation, erreurs `*_error` du Circuit JSON | Aucune erreur d'évaluation |
| G1 | `runAllNetlistChecks` (≈ `tsci check netlist`) + `pin_specification` | Netlist et exigences de broches propres |
| G2 | `runAllPlacementChecks` (≈ `tsci check placement`, `schematic-placement` côté schéma) | Placement propre, rien hors carte |
| G3 | `runAllRoutingChecks` (≈ `tsci check routing`, `shorts`, `pcb-style` selon disponibilité) | Routage complet, 0 net non routé |
| G4 | `kicad-cli` ERC/DRC sur l'export KiCad (worker Docker) | Inchangé — juge externe, voir doc 05 |
| G5 | Scindée **G5-PCB / G5-PCBA** (doc 15 §4.4) : PnP officiel, couverture BOM, DRC fabricant JLCPCB | Selon le mode d'assemblage du projet |

Pendant le développement, suivre la philosophie du skill officiel : rendre d'abord le circuit correct, traiter les diagnostics dans l'ordre netlist → placement → routage. La séquence bloquante « export validé » est imposée par le serveur (P0), pas par l'ordre d'appel des outils.

## 3. Périmètre et contraintes produit

1. **Périmètre D7/D8 inchangé** : cartes 2 couches (4 max), basse vitesse ; hors périmètre (BGA dense, DDR, RF, USB3/PCIe, secteur, médical/auto) → refus propre via l'outil dédié, jamais de génération « pour essayer ».
2. Défauts de carte : 2 couches, piste signal 0,2 mm min., pistes d'alimentation dimensionnées selon le courant annoncé (et explicitées au résumé). Ne jamais relâcher une clearance pour faire passer le routage.
3. Électrique minimal attendu : alimentations nommées (`net.GND`, `net.VCC`…), découplage au plus près de chaque broche d'alimentation, pull-ups/pull-downs datasheet explicites (I2C, boot, reset), plan de masse privilégié en couche inférieure.
4. Placement d'abord, routage ensuite ; MCU central, découplages proches, connecteurs en bord de carte ; marge 1 mm au bord sauf connecteur prévu pour dépasser ; toute carte > 100 × 100 mm justifiée (coût).
5. Sérigraphie minimale : nom de la carte, repères d'interface, marqueur pin 1 sur les connecteurs polarisés. Pièces soudées à la main : `doNotPlace` (idiome officiel).
6. Organisation du code : voir la convention multi-fichiers (doc 15 §5, skill `structuration` à venir) ; organisation du schéma selon le skill officiel (`<schematicsheet>`/`<schematicsection>` dès que la carte grandit).

## 4. Templates

Les templates officiels (`src/lib/skills/tscircuit/templates/`) servent de gabarits de forme. Les templates produit T1–T3 (`src/lib/templates.ts`, BOM présourcées) restent **« en validation »** tant qu'ils n'ont pas été fabriqués et testés (registre doc 14) ; aucun template — officiel ou maison — ne devient « vérifié » sur un seul DRC vert.

## 5. Checklist pré-H2 (auto-revue de l'agent)

- [ ] Chaque composant principal a un statut de sourcing D17 explicite ; aucun `missing` ; les `custom` ont leur pinout confirmé.
- [ ] G0–G3 verts sur diagnostics natifs ; G4/G5 selon le mode d'assemblage du projet.
- [ ] Preview relue : orientation connecteurs, pin 1, sérigraphie, rien hors carte.
- [ ] Découplages présents ; pull-ups/boot/reset conformes datasheet.
- [ ] BOM relue : pièces Extended et statuts non-`verified` signalés, quantités correctes.
- [ ] Limites résiduelles écrites dans le résumé (ce que les checks ne prouvent pas : électrique analogique, thermique, pinout non confirmé par datasheet).
