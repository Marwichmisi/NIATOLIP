# Conventions tscircuit imposées à l'agent

| Version | 1.0 — 2026-10-29 |
|---|---|
| Usage | Ce document est **injecté dans le contexte de l'agent** (en complément du skill officiel tscircuit) et sert de référence aux reviewers humains. Toute règle ici doit être vérifiable par un check ou par revue. |

> Installer aussi le skill officiel : `npx skills add tscircuit/skill` — il couvre syntaxe, workflow CLI et checklist pré-fabrication. Le présent document ne le remplace pas ; il ajoute les contraintes propres à NIATOLIP.

---

## 1. Structure de projet

- Point d'entrée unique : `main.tsx` à la racine du projet.
- Un fichier par sous-circuit significatif si le design dépasse ~15 composants (`power.tsx`, `sensors.tsx`…), importés depuis `main.tsx`.
- Aucun code en dehors des fichiers du projet ; aucun accès réseau dans le code circuit.
- Chaque projet démarre soit de zéro (carte très simple), soit d'un **template vérifié** (FR-14) — jamais d'un copier-coller non sourcé trouvé dans la conversation.

## 2. Règles de génération (normatif)

### Composants et sourcing

1. Tout composant principal (MCU, régulateur, connecteur, capteur) doit provenir d'un appel `searchComponents` dans le run courant. **Interdiction d'inventer une référence LCSC ou un MPN.**
2. Préférer les pièces **JLCPCB Basic/Preferred en stock**. Toute pièce « Extended » doit être signalée à l'utilisateur dans la revue finale.
3. Le footprint doit venir du composant/footprinter associé à la référence choisie — jamais un footprint « approché » tapé de mémoire pour un composant principal.
4. Vérifier l'orientation/pin 1 sur les snapshots pour les connecteurs et circuits polarisés avant H2.

### Schéma et connexions

5. Chaque alimentation est explicitement nommée et connectée (`VCC`, `GND`, `3V3`…) ; aucun net d'alimentation implicite.
6. Découplage : un condensateur de découplage au plus près de chaque broche d'alimentation de circuit actif, sauf justification écrite par l'agent dans le résumé.
7. Les interfaces externes (USB-C, I2C, UART, boutons, LED) sont regroupées et nommées clairement ; les connecteurs sont placés en bord de carte.
8. Les pull-ups/pull-downs requis par les datasheets (I2C, boot, reset) sont explicites dans le code, pas supposés.

### Placement (avant tout routage)

9. **Placement d'abord, routage ensuite.** `checkPlacement` doit être vert avant d'activer/valider le routage.
10. Le MCU est placé de façon centrale ; les composants de découplage au plus près de ses broches d'alimentation ; le connecteur d'alimentation en bord de carte.
11. Aucun composant hors des limites du `<board>` ; marges minimales de 1 mm au bord sauf connecteur prévu pour dépasser.
12. Taille de carte par défaut : la plus petite raisonnable pour le périmètre ; toute carte > 100 × 100 mm doit être justifiée (coût fabrication).

### Routage et carte

13. Défaut MVP : **2 couches**, pistes signal 0,2 mm min., pistes d'alimentation dimensionnées selon le courant annoncé par l'agent (et explicitées dans le résumé).
14. Plan de masse : la couche inférieure est privilégiée pour GND ; les coupures de plan sous les lignes sensibles sont à éviter et à signaler.
15. Distances/isolements par défaut tscircuit conservés ; ne jamais relâcher une contrainte de clearance pour « faire passer » le routage.
16. Sérigraphie minimale : nom de la carte, repères des connecteurs d'interface, marqueur pin 1 sur les connecteurs polarisés.

### Ce que l'agent ne doit jamais faire

- ❌ Inventer un LCSC ID, un MPN, un pinout ou un footprint.
- ❌ Déclarer le routage « terminé » sans `checkRouting` vert et nets non connectés = 0.
- ❌ Réduire les clearances ou supprimer un découplage pour résoudre une erreur de placement.
- ❌ Générer du code hors périmètre (D8) « pour essayer » — utiliser `reportOutOfScope`.
- ❌ Cacher une erreur d'évaluation dans le résumé utilisateur.

## 3. Exemple de référence (forme attendue)

```tsx
import { Board, Chip, Resistor, Capacitor, Trace } from 'tscircuit';
// Forme indicative : la syntaxe exacte suit la version épinglée de tscircuit
// et le skill officiel. La structure — pas la syntaxe de mémoire — fait foi.

export default function Main() {
  return (
    <board width="40mm" height="30mm">
      {/* Alimentation USB-C + LDO 3.3V : bloc vérifié du template */}
      {/* MCU ESP32-C3 : référence issue de searchComponents */}
      {/* Capteur I2C avec pull-ups explicites */}
      {/* LED d'état avec résistance série */}
    </board>
  );
}
```

> Règle de maintenance : cet exemple doit être remplacé par le code réel du template R1 dès qu'il est validé sur carte fabriquée (M2). Un exemple non testé ne doit pas rester dans ce document.

## 4. Templates vérifiés (à construire au M2)

| Template | Contenu | Statut |
|---|---|---|
| T1 — ESP32-C3 minimal | ESP32-C3, USB-C, LDO 3,3 V, LED, boutons boot/reset | À valider sur carte réelle |
| T2 — RP2040 minimal | RP2040, flash, USB-C, LDO | À valider |
| T3 — Capteur I2C | Connecteur I2C, pull-ups, emplacement capteur | À valider |

Un template devient « vérifié » uniquement après fabrication et test fonctionnel. Avant cela, il est étiqueté « en validation » dans l'UI.

## 5. Checklist pré-H2 pour l'agent (auto-revue)

- [ ] Tous les composants principaux ont une référence LCSC vérifiée et en stock.
- [ ] `evaluateCircuit`, `checkNetlist`, `checkPlacement`, `checkRouting` verts.
- [ ] Snapshot PCB relu : orientation connecteurs, pin 1, sérigraphie, rien hors carte.
- [ ] Découplages présents ; pull-ups/boot/reset conformes datasheet.
- [ ] BOM relue : aucune pièce Extended non signalée, quantités correctes.
- [ ] Limites résiduelles écrites dans le résumé (ce que les checks ne prouvent pas : qualité électrique analogique, thermique, etc.).
