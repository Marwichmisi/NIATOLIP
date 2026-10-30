# Templates T1–T3 et preuve par fabrication R1–R3 (issue #8)

| Version | 1.0 — 2026-10-30 |
|---|---|
| Statut | Templates construits, G0–G3 verts, **en-validation** (pas encore fabriqués) |
| Règle | Aucun template ne passe « vérifié » sans fabrication + test (doc 05 §6) |

## 1. Templates livrés

Source unique : `src/lib/templates.ts`. Vérification : `npm run templates:check`
(vrai tscircuit serveur, même moteur que l'agent). Référence 2026-10-30 :
**T1, T2, T3 tous G0–G3 verts, 0 erreur**.

| Template | Contenu | Base pour | Statut |
|---|---|---|---|
| T1 — ESP32-C3 minimal | ESP32-C3, USB-C, LDO 3,3 V, LED, BOOT/RESET, 50×40 mm 2 couches | R1, R3 | en-validation |
| T2 — RP2040 minimal | RP2040, USB-C, LDO 3,3 V, LED, BOOT/RESET, 50×40 mm 2 couches | R2 | en-validation |
| T3 — Breakout capteur I2C | Connecteur I2C 4P, pull-ups 4,7 kΩ, connecteur batterie 2P, 40×30 mm | R1, R3 | en-validation |

BOM présourcées (LCSC vérifiés jlcsearch le 2026-10-30, footprints IoU ≥ 0,95) :

| Template | LCSC (stock constaté le 2026-10-30) |
|---|---|
| T1 | C2858491 ESP32-C3FH4 (26 488), C2924396 LDO 3,3 V (11 795), C393939 USB-C (414 170), C6848499 LED (46 944), C318884 boutons (1 125 027), C25744 10k (17 005 459), C11702 1k (21 651 885), C1525 100nF (36 200 919) |
| T2 | C2040 RP2040 (64 668) + mêmes LDO/USB-C/LED/boutons/passifs que T1 |
| T3 | C124378 header 4P (stock à revérifier), C492401 header 2P (918 591), C25900 4,7k (15 018 488), C1525 100nF (36 200 919) |

Stocks **indicatifs** : revérification obligatoire avant commande (G5 + `searchComponents`).

### Limites connues (bloquent le passage en « vérifié », pas l'usage)

- **Brochage indicatif** sur les trois templates : chaque pin doit être confirmée
  sur datasheet avant fabrication (revue H2).
- **Hors catalogue jlcsearch** (compléments manuels requis, procédure §3) :
  BME280 et capteurs I2C, quartz 12 MHz + flash SPI (T2/R2). Les modules
  ESP32-C3 assemblés n'ont PAS d'empreinte vérifiée (IoU < 0,2) : T1 utilise
  la puce nue C2858491 (QFN-32, IoU 0,996).
- T3 n'a pas de LED : elle arrive avec la carte MCU.

## 2. Utilisation

- **UI** : à la création d'un projet, sélecteur « Template de démarrage »
  (Vide / T1 / T2 / T3) — `POST /api/projects { name, templateId }`.
- **Agent** : `listTemplates` (choix) puis `applyTemplate` + adaptation.
  Instruction system prompt v1.4 §1b. Les LCSC des templates sont tracés
  (`template:Tx`) mais le stock/prix est revérifié avant H2.
- **Galerie** : `GET /api/templates` (métadonnées + BOM).

## 3. R1–R3 : packs prêts-JLCPCB

### Cartographie template → carte

| Carte | Départ | Compléments agent avant validation |
|---|---|---|
| R1 (ESP32-C3 + BME280 + USB-C + LED) | T1 (+ T3 pour le capteur externe si besoin) | BME280 : sourcer sur LCSC + `getComponentDetails` (empreinte vérifiée exigée), pull-ups I2C explicites, firmware de test I2C |
| R2 (RP2040 + flash + USB-C + boutons) | T2 | Quartz 12 MHz + flash SPI : sourcer sur LCSC + `getComponentDetails`, valider avant routage final |
| R3 (ESP32-C3 + I2C externe + JST batterie) | T1 + T3 | Capteur externe sur J1 ; polarité batterie sérigraphiée (déjà en T3) ; charge exclue |

### Procédure par carte (doc 05 §6)

1. L'agent génère la carte **sans modification manuelle du code** (départ
   template autorisé et tracé), jusqu'à G0–G3 verts.
2. `requestManufacturingValidation` → job KiCad → G4+G5 verts + H2.
3. `exportManufacturingPack` → pack (`gerber.zip`, `bom.csv`, `pnp.csv`,
   `project-kicad.zip`, `sources.zip`, `validation-report.md`).
4. **Fiche de test écrite AVANT commande** (corpus `src/lib/corpus.ts`, rappel) :
   - R1 : 3,3 V ±5 % en sortie LDO ; LED allumée ; BME280 détecté au scan I2C ;
     pas de court-circuit VCC/GND avant mise sous tension.
   - R2 : 3,3 V ±5 % ; flash lisible (JEDEC ID) ; BOOT+RESET → disque USB ;
     LED pilotable.
   - R3 : 3,3 V via JST ±5 %, sérigraphie polarité ; pull-ups I2C à 3,3 V ;
     capteur externe détecté ; LED pilotable.
5. Commande JLCPCB (compte utilisateur, **hors produit**) :
   `jlcpcb.com` → Instant Quote → ajouter `gerber.zip` → options : 2 couches,
   HASL sans plomb (prototype), couleur au choix → assembly PCBA si souhaité :
   ajouter `bom.csv` + `pnp.csv`, choisir Basic/Preferred, vérifier chaque
   empreinte → petite quantité (5 ex.) → paiement → réception.
6. Test selon la fiche, **sans retouche**, puis consignation (§4).

### Complément manuel hors catalogue (BME280, quartz, flash)

1. Chercher la référence sur `lcsc.com` (disponibilité + prix + boîtier).
2. `getComponentDetails(lcscId)` : exiger `footprintVerified: true`.
   Sinon : choisir une autre référence, jamais de footprint approché.
3. Intégrer au schéma (datasheet pour le pinout), réévaluer G0–G3.

## 4. Registre des fabrications (à remplir)

| Carte | Date cmd | Template | Modif. vs template | G4/G5 | Reçu le | Résultat | Cause racine si échec | Règle/check ajouté |
|---|---|---|---|---|---|---|---|---|
| R1 | — | T1 | — | — | — | en attente | — | — |
| R2 | — | T2 | — | — | — | en attente | — | — |
| R3 | — | T1+T3 | — | — | — | en attente | — | — |

## 5. Promotion « vérifié »

Un template passe `en-validation` → `vérifié` (`status` dans
`src/lib/templates.ts`) quand **une carte issue du template** (adaptations
mineures acceptées et listées) **fonctionne sans retouche** après fabrication.
Mettre à jour : `status`, doc 04 §4, et remplacer l'exemple de doc 04 §3 par
le code réel validé.
