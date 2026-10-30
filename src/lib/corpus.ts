// Corpus de régression R1–R5 (issue #6, doc 08 § corpus + M1-5).
// Source unique de vérité : prompts canoniques, fiches de test fonctionnel
// et résultat attendu par carte. Consommé par le harnais `scripts/corpus.ts`
// (une commande → rapport Markdown + JSON historisé).
//
// Toute modification d'un prompt canonique ou du system prompt repasse le
// corpus avant merge (doc 08 M1-5, PRD §12). Les versions tscircuit épinglées
// sont rappelées dans chaque rapport (backlog P0).

export interface CorpusCard {
  /** Identifiant stable (R1…R5), utilisé par `--only`. */
  id: "R1" | "R2" | "R3" | "R4" | "R5";
  title: string;
  /** Ce que la carte prouve (doc 08). */
  proves: string;
  /** Prompt utilisateur canonique envoyé à l'agent (français). */
  prompt: string;
  /** Fiche de test fonctionnel (écrite avant commande, doc 05 §6). */
  functionalTest: string[];
  /** Résultat attendu en M1 : G0–G3 verts sans modification manuelle. */
  expected: "G3 vert (G0–G3 pass, 0 erreur)";
  /** Garde-fous indicatifs envoyés avec le prompt (dimensions, couches). */
  constraints: { maxWidthMm: number; maxDepthMm: number; layers: 2 };
}

export const CORPUS_CARDS: CorpusCard[] = [
  {
    id: "R1",
    title: "ESP32-C3 + BME280 (I2C) + USB-C + LED",
    proves: "Chaîne complète : MCU, capteur I2C, alimentation USB-C — carte de preuve n°1.",
    prompt: [
      "Conçois la carte R1 : ESP32-C3 avec capteur BME280 en I2C, alimentation USB-C, LED d'état.",
      "Contraintes : 2 couches, 50 × 40 mm max, composants JLCPCB Basic/Preferred en stock.",
      "Exigé : LDO 3,3 V avec découplages au plus près du MCU, pull-ups I2C explicites,",
      "condensateurs de découplage sur chaque broche d'alimentation, USB-C en bord de carte, MCU central.",
      "Tiens à jour parts.json [{ ref, lcsc, mpn, role }], évalue après chaque écriture",
      "(evaluateCircuit puis checkNetlist, checkPlacement, checkRouting dans l'ordre),",
      "corrige jusqu'à G0–G3 verts. Réponds en français, résumé court uniquement.",
    ].join(" "),
    functionalTest: [
      "Alimentation via USB-C : 3,3 V mesuré en sortie LDO (±5 %).",
      "LED d'état allumée à la mise sous tension.",
      "BME280 détecté sur le bus I2C (scan : adresse présente, température/humidité/pression lues).",
      "Aucun court-circuit entre VCC et GND (testeur de continuité avant première mise sous tension).",
    ],
    expected: "G3 vert (G0–G3 pass, 0 erreur)",
    constraints: { maxWidthMm: 50, maxDepthMm: 40, layers: 2 },
  },
  {
    id: "R2",
    title: "RP2040 + flash + USB-C + boutons",
    proves: "Deuxième famille MCU (RP2040), boot/reset, flash externe.",
    prompt: [
      "Conçois la carte R2 : RP2040 avec flash SPI externe, alimentation USB-C,",
      "boutons BOOT et RESET, LED d'état.",
      "Contraintes : 2 couches, 50 × 40 mm max, composants JLCPCB Basic/Preferred en stock.",
      "Exigé : quartz 12 MHz avec condensateurs de charge, découplages au plus près du RP2040,",
      "pull-ups/pull-downs de boot explicites, boutons accessibles en bord de carte.",
      "Tiens à jour parts.json [{ ref, lcsc, mpn, role }], évalue après chaque écriture",
      "(evaluateCircuit puis checkNetlist, checkPlacement, checkRouting dans l'ordre),",
      "corrige jusqu'à G0–G3 verts. Réponds en français, résumé court uniquement.",
    ].join(" "),
    functionalTest: [
      "3,3 V mesuré sur la sortie du régulateur (±5 %).",
      "Flash détectée (lecture JEDEC ID via SWD ou firmware de test).",
      "Bouton BOOT + RESET : le RP2040 entre en mode bootloader (disque USB visible).",
      "LED d'état pilotable par GPIO.",
    ],
    expected: "G3 vert (G0–G3 pass, 0 erreur)",
    constraints: { maxWidthMm: 50, maxDepthMm: 40, layers: 2 },
  },
  {
    id: "R3",
    title: "Nœud capteur ESP32-C3 + I2C externe + JST batterie",
    proves: "Connectique usage « produit » : connecteur externe, JST batterie (charge exclue).",
    prompt: [
      "Conçois la carte R3 : nœud capteur ESP32-C3 avec connecteur I2C externe (4 broches : VCC, GND, SDA, SCL),",
      "connecteur JST pour batterie (alimentation uniquement, pas de charge), LED d'état.",
      "Contraintes : 2 couches, 50 × 40 mm max, composants JLCPCB Basic/Preferred en stock.",
      "Exigé : LDO 3,3 V avec découplages, pull-ups I2C explicites, connecteurs en bord de carte,",
      "polarité batterie sérigraphiée (repère pin 1 / + / −).",
      "Tiens à jour parts.json [{ ref, lcsc, mpn, role }], évalue après chaque écriture",
      "(evaluateCircuit puis checkNetlist, checkPlacement, checkRouting dans l'ordre),",
      "corrige jusqu'à G0–G3 verts. Réponds en français, résumé court uniquement.",
    ].join(" "),
    functionalTest: [
      "Alimentation par JST : 3,3 V régulé (±5 %) ; protection contre l'inversion vérifiée visuellement (sérigraphie).",
      "Bus I2C disponible sur le connecteur externe (pull-ups mesurés à 3,3 V).",
      "Capteur I2C externe branché : détecté au scan.",
      "LED d'état pilotable.",
    ],
    expected: "G3 vert (G0–G3 pass, 0 erreur)",
    constraints: { maxWidthMm: 50, maxDepthMm: 40, layers: 2 },
  },
  {
    id: "R4",
    title: "Carte relais pilotée en UART via connecteur externe",
    proves: "Composant de sortie, pistes d'alimentation dimensionnées (basse tension uniquement).",
    prompt: [
      "Conçois la carte R4 : carte relais basse tension pilotée en UART via un connecteur externe",
      "(VCC, GND, TX, RX), transistor de commande + diode de roue libre, LED d'état du relais.",
      "Partie puissance limitée à la basse tension du périmètre (pas de secteur).",
      "Contraintes : 2 couches, 60 × 50 mm max, composants JLCPCB Basic/Preferred en stock.",
      "Exigé : piste d'alimentation du relais dimensionnée et explicitée, diode de roue libre,",
      "connecteur de sortie à bornier vis en bord de carte, isolation claire commande/puissance.",
      "Tiens à jour parts.json [{ ref, lcsc, mpn, role }], évalue après chaque écriture",
      "(evaluateCircuit puis checkNetlist, checkPlacement, checkRouting dans l'ordre),",
      "corrige jusqu'à G0–G3 verts. Réponds en français, résumé court uniquement.",
    ].join(" "),
    functionalTest: [
      "Commande UART : le relais colle et décolle sur ordre (clic audible, continuité NO/NC vérifiée).",
      "Diode de roue libre présente et orientée (pas de surtension au blocage).",
      "Courant bobine mesuré compatible avec le transistor de commande.",
      "Aucun échauffement anormal après 10 cycles.",
    ],
    expected: "G3 vert (G0–G3 pass, 0 erreur)",
    constraints: { maxWidthMm: 60, maxDepthMm: 50, layers: 2 },
  },
  {
    id: "R5",
    title: "MCU + connecteur écran SPI + boutons",
    proves: "Bus SPI, connectique multiple.",
    prompt: [
      "Conçois la carte R5 : MCU ESP32-C3 avec connecteur écran SPI (VCC, GND, SCK, MOSI, CS, DC, RST),",
      "2 boutons poussoirs, LED d'état, alimentation USB-C.",
      "Contraintes : 2 couches, 50 × 40 mm max, composants JLCPCB Basic/Preferred en stock.",
      "Exigé : LDO 3,3 V avec découplages, lignes SPI courtes et regroupées vers le connecteur en bord de carte,",
      "pull-ups/pull-downs de boot explicites.",
      "Tiens à jour parts.json [{ ref, lcsc, mpn, role }], évalue après chaque écriture",
      "(evaluateCircuit puis checkNetlist, checkPlacement, checkRouting dans l'ordre),",
      "corrige jusqu'à G0–G3 verts. Réponds en français, résumé court uniquement.",
    ].join(" "),
    functionalTest: [
      "3,3 V mesuré (±5 %).",
      "Signaux SPI présents sur le connecteur (SCK/MOSI/CS observés à l'oscilloscope lors d'un transfert).",
      "Écran branché : affichage initialisé par le firmware de test.",
      "Les 2 boutons lus correctement (anti-rebond logiciel).",
    ],
    expected: "G3 vert (G0–G3 pass, 0 erreur)",
    constraints: { maxWidthMm: 50, maxDepthMm: 40, layers: 2 },
  },
];

/** Porte de sortie M1 (doc 08) : ≥ 4 cartes sur 5 atteignent G3 vert sans retouche. */
export const CORPUS_GREEN_THRESHOLD = 4;
