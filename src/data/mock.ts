export type StepStatus = "done" | "running" | "pending" | "error" | "awaiting" | "denied";

export interface AgentStep {
  id: string;
  label: string;
  detail: string;
  status: StepStatus;
  /** Nom de l'outil d'origine (reportOutOfScope → style hors-périmètre, gates H1/H2…). */
  tool?: string;
  /** Résumé JSON brut dépliable (jamais affiché par défaut, doc 06 §2.1). */
  raw?: string;
  /** Horodatage de début (ms) pour la durée « en cours … N s ». */
  startedAt?: number;
}

export const INITIAL_STEPS: AgentStep[] = [
  { id: "plan", label: "Plan proposé", detail: "ESP32-C3 · BME280 I2C · USB-C · 40 × 30 mm · 2 couches", status: "done" },
  { id: "search", label: "Recherche composants", detail: "8 références JLCPCB vérifiées, stock confirmé", status: "done" },
  { id: "write", label: "Écriture main.tsx", detail: "Schéma : MCU, capteur, alimentation, LED", status: "done" },
  { id: "eval", label: "Évaluation du circuit", detail: "0 erreur · 14 composants · 23 nets", status: "done" },
  { id: "netlist", label: "Check netlist", detail: "Toutes les connexions attendues sont présentes", status: "done" },
  { id: "placement", label: "Check placement", detail: "Aucun chevauchement, marges respectées", status: "done" },
  { id: "routing", label: "Routage", detail: "En cours…", status: "running" },
  { id: "snapshot", label: "Revue visuelle", detail: "Snapshot PCB analysé par le modèle", status: "pending" },
  { id: "kicad", label: "Validation KiCad (DRC)", detail: "Export + DRC dans le worker", status: "pending" },
];

export interface BomRow {
  ref: string;
  value: string;
  pkg: string;
  lcsc: string;
  stock: string;
  price: string;
  kind: "Basic" | "Preferred" | "Extended";
}

export const BOM: BomRow[] = [
  { ref: "U1", value: "ESP32-C3-MINI-1", pkg: "Module", lcsc: "C2838501", stock: "12 400", price: "2,41 €", kind: "Preferred" },
  { ref: "U2", value: "BME280", pkg: "LGA-8", lcsc: "C92490", stock: "8 930", price: "1,87 €", kind: "Preferred" },
  { ref: "U3", value: "TLV75901 LDO 3,3 V", pkg: "SOT-23-5", lcsc: "C2860980", stock: "22 150", price: "0,42 €", kind: "Basic" },
  { ref: "J1", value: "USB-C 16P", pkg: "SMD", lcsc: "C165948", stock: "45 600", price: "0,31 €", kind: "Basic" },
  { ref: "R1–R4", value: "10 kΩ · 5,1 kΩ", pkg: "0402", lcsc: "C25744", stock: "1,2 M", price: "0,01 €", kind: "Basic" },
  { ref: "C1–C5", value: "100 nF · 10 µF", pkg: "0402", lcsc: "C1525", stock: "980 k", price: "0,01 €", kind: "Basic" },
  { ref: "D1", value: "LED ambre", pkg: "0603", lcsc: "C2286", stock: "310 k", price: "0,02 €", kind: "Basic" },
];

export const GATES = [
  { id: "G0", label: "Évaluation", status: "ok", note: "0 erreur" },
  { id: "G1", label: "Netlist", status: "ok", note: "23 nets connectés" },
  { id: "G2", label: "Placement", status: "ok", note: "Aucun chevauchement" },
  { id: "G3", label: "Routage", status: "running", note: "En cours" },
  { id: "G4", label: "DRC KiCad", status: "pending", note: "En attente du routage" },
  { id: "G5", label: "Fabricabilité", status: "pending", note: "Stock revérifié à l'export" },
] as const;

export const SUGGESTIONS = [
  "Ajoute un bouton reset",
  "Passe la LED en vert",
  "Ajoute un connecteur I2C externe",
];
