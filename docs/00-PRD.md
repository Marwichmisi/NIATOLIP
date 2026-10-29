# PRD — NIATOLIP, agent IA de création de PCB

| Champ | Valeur |
|---|---|
| Version | 1.0 — 2026-10-29 |
| Statut | Validé pour cadrage MVP |
| Stack validée | tscircuit + Vercel AI SDK + Meta Model API / OpenAI |
| Propriétaire produit | À nommer avant M0 |

---

## 1. Problème

Créer une carte PCB simple exige aujourd'hui d'enchaîner : choix des composants, lecture de datasheets, dessin du schéma, placement, routage, DRC, génération Gerber/BOM, vérification du stock chez le fabricant. Pour une carte ESP32 + capteurs, un débutant met plusieurs jours ; un ingénieur confirmé, plusieurs heures — dont une grande partie de travail mécanique.

Les EDA classiques (KiCad, EasyEDA) sont des outils de dessin, pas des agents. Les assistants IA génériques produisent du texte ou des schémas non vérifiés : un footprint faux ou une pin inversée = une carte morte.

## 2. Vision

**L'utilisateur ouvre l'application, décrit sa carte en langage naturel, discute avec un agent IA qui conçoit, vérifie et corrige la carte en boucle, regarde le PCB se construire en direct, puis exporte des fichiers de fabrication validés.**

Équivalent de Bolt/OpenCode, mais où le « build » est un build électronique déterministe (compilation tscircuit, checks, DRC KiCad) et où la « preview » est le PCB/schéma/3D en temps réel.

## 3. Positionnement et différenciation

Ne pas concurrencer Flux/Quilter sur « toutes les cartes ». Différenciation MVP :

1. **Fiabilité sur un périmètre étroit** : cartes 2 couches basse vitesse, familles ESP32/RP2040/STM32 + capteurs courants.
2. **Fabricabilité JLCPCB d'abord** : composants réels, en stock, footprints vérifiés, Basic/Preferred privilégiés.
3. **Boucle de validation visible** : chaque build, check et DRC est montré à l'utilisateur — pas de génération « boîte noire ».
4. **Aucun enfermement** : export KiCad propre à tout moment.
5. **Bibliothèque de blocs vérifiés** (USB-C + LDO, ESP32-C3 minimal, etc.) réutilisés par l'agent plutôt que régénérés de zéro.

## 4. Personas

| Persona | Description | Besoin principal |
|---|---|---|
| P1 — Maker / indie hardware | Développeur logiciel ou bidouilleur avancé, sait coder, électronique intermédiaire | Passer d'un prototype sur breadboard à une carte propre sans apprendre tout KiCad |
| P2 — Ingénieur électronique junior / freelance | Connaît l'électronique, veut aller vite sur les cartes simples | Déléguer schéma + placement + premier routage, garder le contrôle sur la validation |
| P3 — Fondateur / prototyper produit | Non-spécialiste PCB, besoin d'itérer vite | Obtenir une première carte fabricable pour valider un produit |

Le MVP cible **P1 en priorité**, P2 en secondaire. P3 est servi par le même produit mais sans promesse d'accompagnement métier.

## 5. Jobs-to-be-done

- « Quand je décris le produit que je veux construire, aide-moi à obtenir une carte que je peux commander chez JLCPCB sans passer mes soirées dans KiCad. »
- « Quand tu proposes un composant, prouve-moi qu'il existe, qu'il est en stock et que son footprint est le bon. »
- « Quand quelque chose est faux, détecte-le toi-même, corrige-le et montre-moi ce qui a changé. »
- « Quand je veux reprendre la main, donne-moi un projet KiCad propre. »

## 6. Périmètre

### 6.1 Dans le MVP (Must)

- Cartes **2 couches** (4 couches en « Should »), **20 à 100 composants**, signaux basse vitesse.
- Familles : ESP32-C3/S3, RP2040, STM32 simples ; interfaces I2C, SPI, UART, GPIO, USB-C (alimentation + USB 2.0 basse vitesse).
- Composants sourcés chez **JLCPCB/LCSC** avec stock vérifié au moment de la génération.
- Génération complète : schéma + PCB routé + BOM + pick-and-place + Gerber.
- Validation automatique : checks tscircuit + DRC/ERC KiCad sur fichier exporté.
- Validation humaine obligatoire avant marquage « prêt à fabriquer ».

### 6.2 Hors MVP (Won't — explicite)

- BGA dense, DDR, RF, paires différentielles rapides, impédance contrôlée critique.
- Secteur, haute tension, forte puissance, charge de batterie lithium complexe au-delà des blocs vérifiés.
- Médical, automobile, aéronautique, tout usage critique pour la sécurité.
- Commande automatique chez le fabricant (aucun achat sans action utilisateur externe).
- Simulation analogique avancée (SPICE) — reportée après MVP.
- Multi-utilisateur temps réel / collaboration simultanée.

## 7. Parcours utilisateur principal

1. L'utilisateur crée un projet et décrit sa carte : *« Carte capteur ESP32-C3, BME280 en I2C, alimentation USB-C, LED d'état, 40×30 mm max, à commander chez JLCPCB. »*
2. L'agent pose **questions de clarification bloquantes** (alimentation, dimensions, connecteurs) ou propose des hypothèses explicites.
3. L'agent affiche un **plan** : architecture, composants principaux, taille de carte, nombre de couches.
4. L'utilisateur approuve le plan (gate humaine **H1**).
5. L'agent génère le code tscircuit ; la preview PCB/schéma/3D se met à jour à droite en temps réel.
6. L'agent exécute ses checks en boucle (voir `05-VALIDATION-FABRICATION.md`), corrige seul les erreurs, et rend compte par étapes compréhensibles.
7. L'agent présente le résultat : image PCB, BOM avec prix/stock, résultat DRC.
8. L'utilisateur approuve le design (gate **H2**) ou demande des modifications dans le chat.
9. L'utilisateur télécharge le pack fabrication (Gerber, BOM, PnP, projet KiCad, rapport de validation).
10. L'utilisateur commande lui-même chez le fabricant.

## 8. Exigences fonctionnelles

| ID | Exigence | Priorité |
|---|---|---|
| FR-01 | Créer/ouvrir un projet PCB avec historique de versions du code source tscircuit | Must |
| FR-02 | Chat agent en streaming affichant texte, appels d'outils et résultats d'étapes | Must |
| FR-03 | Preview temps réel PCB / schéma / 3D / BOM dans le panneau droit, mise à jour à chaque modification de fichier | Must |
| FR-04 | L'agent peut écrire/modifier les fichiers du projet, relancer le build et lire les erreurs structurées | Must |
| FR-05 | L'agent peut rechercher des composants JLCPCB (référence LCSC, stock, prix, footprint) et doit justifier chaque choix de composant principal dans le chat | Must |
| FR-06 | Gates humaines : approbation du plan (H1) et du design final (H2) avant export fabrication | Must |
| FR-07 | Boucle de correction automatique bornée à **50 étapes par itération** : à l'atteinte du plafond, le run s'arrête proprement, l'état est sauvegardé et l'utilisateur peut relancer une nouvelle itération du même projet en un clic (cf. `03-AGENT-TOOLS-LOOP.md`) | Must |
| FR-08 | Checks automatiques : netlist, placement, routage (tscircuit) puis ERC/DRC KiCad sur l'export | Must |
| FR-09 | Snapshot PCB/schéma consultable par le modèle (vision) pour auto-revue visuelle avant H2 | Must |
| FR-10 | Export pack fabrication : Gerber.zip, BOM.csv, PnP.csv, projet KiCad, rapport de validation (PDF ou Markdown) | Must |
| FR-11 | Choix du modèle par l'utilisateur : Meta (Muse Spark / Muse Wonder) ou OpenAI, avec modèle par défaut configurable côté serveur | Must |
| FR-12 | Reprise de conversation : rouvrir un projet restaure fichiers, historique et dernier état validé | Must |
| FR-13 | Annulation d'un run en cours et retour à la dernière version de fichiers valide | Must |
| FR-14 | Mode « templates » : démarrer depuis une carte de référence vérifiée (ESP32-C3 minimal, RP2040 minimal…) et la modifier | Should |
| FR-15 | Détection et signalement des contraintes hors périmètre (ex. demande DDR/RF) avec refus explicite et proposition d'alternative | Must |

## 9. Exigences non fonctionnelles

| ID | Exigence | Cible MVP |
|---|---|---|
| NFR-01 | Temps avant première preview après envoi du prompt | < 15 s (hors temps modèle) |
| NFR-02 | Rafraîchissement preview après modification de fichier | < 3 s sur une carte ≤ 100 composants |
| NFR-03 | Sécurité clés API | Clés Meta/OpenAI uniquement côté serveur, jamais exposées au navigateur |
| NFR-04 | Confidentialité Meta | Mode Standard Meta par défaut ; variantes `-contributor` désactivées (voir D9) |
| NFR-05 | Reproductibilité | Chaque run journalise modèle, version des outils, fichiers d'entrée et résultats de checks |
| NFR-06 | Coût | Coût modèle par run borné et affiché ; alerte à 80 % du budget du run |
| NFR-07 | Robustesse agent | Aucun export « prêt à fabriquer » si une gate G0–G5 échoue (voir doc 05) |
| NFR-08 | Compatibilité navigateur | Chrome/Edge/Firefox récents ; WebWorker obligatoire |

## 10. Métriques de succès

| Métrique | Cible à 3 mois post-lancement MVP |
|---|---|
| Cartes du corpus de référence générées sans modification manuelle du code | ≥ 8/10 (voir `08-ROADMAP-BACKLOG.md`) |
| Cartes commandées par les utilisateurs pilotes déclarées fonctionnelles au premier spin | ≥ 70 % |
| Temps médian prompt → pack fabrication approuvé (carte simple ≤ 50 composants) | < 20 min |
| Runs abandonnés pour cause d'erreurs agent non résolues | < 20 % |
| Taux de composants principaux introuvables/en rupture au moment de l'export | < 5 % |

## 11. Critères d'acceptation du MVP

Le MVP est « terminé » quand les 3 conditions suivantes sont démontrées sur des cartes réellement fabriquées :

1. La carte de référence **R1 (ESP32-C3 + BME280 + USB-C)** est générée de bout en bout par l'agent, fabriquée chez JLCPCB et fonctionne sans retouche.
2. Deux autres cartes du corpus (R2, R3 dans `08-ROADMAP-BACKLOG.md`) passent le même test.
3. Un utilisateur externe au projet réalise une carte simple sans aide de l'équipe, en partant uniquement du chat.

## 12. Hypothèses et dépendances

- tscircuit reste pré-1.0 : les versions sont **épinglées** et toute montée de version passe par le corpus de régression (doc 08).
- Meta Model API : `muse-spark-1.3` recommandé par Meta pour le nouveau travail agentique ; `muse-wonder-1.0` est en **preview** — ne pas en faire l'unique modèle supporté.
- Les prix/stocks JLCPCB sont volatils : toujours revérifier à l'export, jamais promettre une disponibilité durable.
- Aucune promesse contractuelle de « carte garantie fonctionnelle » au lancement : formulation produit = « carte validée automatiquement, revue par l'utilisateur ».

## 13. Décisions tranchées le 2026-10-29 (anciennes questions ouvertes)

| # | Question | Décision |
|---|---|---|
| Q1 | Mode de lancement et hébergement du worker KiCad | **Docker auto-hébergé d'abord** : `docker compose up --build` démarre web + base + worker KiCad. Le mode hébergé (SaaS, zéro installation pour l'utilisateur) viendra après, avec la même composition Docker déployée sur notre infrastructure |
| Q2 | Auth utilisateurs dès le MVP ? | **Non** : prototype sans compte. L'auth (email/OAuth) est ajoutée avant tout lancement public ou hébergé |
| Q3 | Modèle par défaut présenté à l'utilisateur : Meta ou OpenAI ? | **Celui qui gagne le benchmark M0** (Spark 1.3 vs Wonder 1.0 vs OpenAI sur la carte jouet) |
| Q4 | Nom public du produit | **À chercher** : NIATOLIP reste le nom de travail interne ; session de naming à mener avant le lancement pilote. Critères : prononçable FR/EN, disponible en `.com`/`.io`, sans connotation trompeuse sur une garantie de résultat |
| Q5 | Fabricant cible | **JLCPCB uniquement au MVP** (composants LCSC, formats BOM/PnP JLCPCB). Autres fabricants après le MVP |
