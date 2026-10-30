// Templates vérifiés T1–T3 (issue #8, doc 04 §4, FR-14).
// Source unique de vérité : ce fichier. Consommé par :
// - `GET /api/templates` (galerie UI) ;
// - `POST /api/projects` avec `templateId` (amorçage projet) ;
// - outils agent `listTemplates` / `applyTemplate` (agent-run.ts) ;
// - `npm run templates:check` (gates G0–G3 par template).
//
// STATUT : "en-validation" — aucun template ne devient "vérifié" sans
// fabrication réelle + test fonctionnel (doc 05 §6, doc 14). Le code est un
// point de départ sourcé (LCSC vérifiés le 2026-10-30 via jlcsearch, stock
// à revérifier à la commande) : le BROCHAGE reste INDICATIF et doit être
// confirmé sur datasheet avant fabrication (revue H2, doc 14 §5).
//
// Règles de maintenance :
// - tout LCSC listé ici a un footprinter vérifié (IoU ≥ 0,95) sauf mention
//   explicite dans `limits` (ex. quartz/flash/capteur hors catalogue
//   jlcsearch — voir "Catalogue limité connu") ;
// - toute modification du code d'un template repasse `templates:check`
//   avant merge (même discipline que le corpus, doc 08 M1-5).

export type TemplateId = "T1" | "T2" | "T3";
export type TemplateStatus = "en-validation" | "vérifié";

export interface TemplateBomRow {
  ref: string;
  value: string;
  lcsc: string;
  mpn: string | null;
  footprint: string;
  role: string;
  /** Stock JLCPCB constaté à `stockAt` (indicatif — revérifier à la commande). */
  stock: number | null;
  stockAt: string;
}

export interface ProjectTemplate {
  id: TemplateId;
  title: string;
  description: string;
  status: TemplateStatus;
  board: { widthMm: number; depthMm: number; layers: 2 };
  /** Mots-clés pour la sélection agent (demande utilisateur → template). */
  matches: string[];
  bom: TemplateBomRow[];
  files: { "main.tsx": string; "parts.json": string };
  /** Limites connues (bloquent le passage en « vérifié », pas l'usage). */
  limits: string[];
}

const STOCK_AT = "2026-10-30";

// ---------- T1 : ESP32-C3 minimal ----------

const T1_CODE = `// Template T1 — ESP32-C3 minimal (statut : en-validation, voir doc 14).
// ATTENTION : brochage INDICATIF — confirmer chaque pin sur datasheet avant
// fabrication (revue H2). Sourcing vérifié le ${STOCK_AT} (jlcsearch) :
// U1 ESP32-C3FH4 C2858491, U2 LDO 3,3V C2924396, J1 USB-C C393939,
// D1 LED C6848499, SW1/SW2 C318884, R1 10k C25744, R2 1k C11702,
// C1/C2 100nF C1525. Stock/prix à revérifier avant commande (G5).
circuit.add(
  <board width="50mm" height="40mm" layers={2}>
    <chip
      name="U1"
      footprint="qfn32_thermalpad3.8mmx3.8mm_h5.81mm_pw0.28mm_pl0.65mm"
      pcbX={0}
      pcbY={2}
      schX={0}
      schY={0}
      schWidth={10}
      schHeight={10}
    />
    <chip
      name="U2"
      footprint="dfn6_thermalpad0.85mmx1.45mm_p0.65mm_w2.35mm_pw0.35mm_pl0.5mm_pin1location(leftside,bottom)"
      pcbX={-16}
      pcbY={10}
      schX={-14}
      schY={4}
    />
    <connector
      name="J1"
      pinCount={16}
      footprint="usbcmidmount16_tophw0.6mm_bottomhw0.6mm_tophh1.7mm_bottomhh1.4mm_topring0.2mm_bottomring0.2mm_rowy2.1mm_ph1.15mm_pw0.3mm_powerpw0.6mm_powerx3.2001mm_shellx4.32mm_topy1.5249mm_bottomy2.625mm_holex2.89mm_holey1.0255mm_holed0.65mm"
      pcbX={17}
      pcbY={-12}
      schX={14}
      schY={-6}
    />
    <capacitor
      name="C1"
      capacitance="100nF"
      footprint="0402"
      pcbX={-6}
      pcbY={8}
      schX={-6}
      schY={6}
    />
    <capacitor
      name="C2"
      capacitance="100nF"
      footprint="0402"
      pcbX={6}
      pcbY={8}
      schX={6}
      schY={6}
    />
    <resistor
      name="R1"
      resistance="10k"
      footprint="0402"
      pcbX={-10}
      pcbY={-2}
      schX={-10}
      schY={-2}
    />
    <led
      name="D1"
      footprint="res_p1.5mm_pw0.8mm_ph0.8mm"
      pcbX={8}
      pcbY={-8}
      schX={8}
      schY={-4}
    />
    <resistor
      name="R2"
      resistance="1k"
      footprint="0402"
      pcbX={13}
      pcbY={-8}
      schX={12}
      schY={-4}
    />
    <chip
      name="SW1"
      footprint="smdpushbutton4_px6mm_py3.7mm_pw1mm_ph0.75mm"
      pcbX={-17}
      pcbY={-12}
      schX={-15}
      schY={-8}
    />
    <chip
      name="SW2"
      footprint="smdpushbutton4_px6mm_py3.7mm_pw1mm_ph0.75mm"
      pcbX={-8}
      pcbY={-12}
      schX={-7}
      schY={-8}
    />
    <trace from=".J1 .pin1" to=".U2 .pin1" />
    <trace from=".U2 .pin2" to=".U1 .pin1" />
    <trace from=".C1 .pin1" to=".U1 .pin3" />
    <trace from=".C1 .pin2" to=".U1 .pin4" />
    <trace from=".C2 .pin1" to=".U1 .pin5" />
    <trace from=".C2 .pin2" to=".U1 .pin6" />
    <trace from=".R1 .pin1" to=".U1 .pin7" />
    <trace from=".R1 .pin2" to=".U2 .pin3" />
    <trace from=".SW1 .pin1" to=".U1 .pin8" />
    <trace from=".SW2 .pin1" to=".U1 .pin9" />
    <trace from=".D1 .pin1" to=".R2 .pin1" />
    <trace from=".R2 .pin2" to=".U1 .pin10" />
    <trace from=".U1 .pin11" to=".J1 .pin2" />
  </board>
)
`;

const T1_PARTS: Array<{ ref: string; lcsc: string; mpn: string | null; role: string }> = [
  { ref: "U1", lcsc: "C2858491", mpn: "ESP32-C3FH4", role: "MCU RISC-V WiFi/BLE" },
  { ref: "U2", lcsc: "C2924396", mpn: "BCT2057ELT33-TR", role: "LDO 3,3 V" },
  { ref: "J1", lcsc: "C393939", mpn: "TYPE-C16PIN", role: "USB-C alimentation + USB" },
  { ref: "D1", lcsc: "C6848499", mpn: "150060VS75000", role: "LED verte état" },
  { ref: "R2", lcsc: "C11702", mpn: "0402WGF1001TCE", role: "LED série 1 kΩ" },
  { ref: "R1", lcsc: "C25744", mpn: "0402WGF1002TCE", role: "Pull-up EN 10 kΩ" },
  { ref: "C1", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
  { ref: "C2", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
  { ref: "SW1", lcsc: "C318884", mpn: "TS-1187A-B-A-B", role: "Bouton BOOT" },
  { ref: "SW2", lcsc: "C318884", mpn: "TS-1187A-B-A-B", role: "Bouton RESET" },
];

// ---------- T2 : RP2040 minimal ----------

const T2_CODE = `// Template T2 — RP2040 minimal (statut : en-validation, voir doc 14).
// ATTENTION : brochage INDICATIF — confirmer chaque pin sur datasheet avant
// fabrication (revue H2). COMPLÉMENTS MANUELS REQUIS (hors catalogue
// jlcsearch) : quartz 12 MHz + flash SPI (ex. W25Q128) — sourcer sur LCSC,
// vérifier l'empreinte via getComponentDetails, valider avant routage final.
// Sourcing vérifié le ${STOCK_AT} : U1 RP2040 C2040, U2 LDO C2924396,
// J1 USB-C C393939, D1 C6848499, SW1/SW2 C318884, R1/R2 10k C25744,
// R3 1k C11702, C1/C2 100nF C1525.
circuit.add(
  <board width="50mm" height="40mm" layers={2}>
    <chip
      name="U1"
      footprint="qfn56_thermalpad3.1mmx3.1mm_p0.4mm_h7.9mm_pw0.2mm_pl0.85mm"
      pcbX={0}
      pcbY={2}
      schX={0}
      schY={0}
      schWidth={12}
      schHeight={12}
    />
    <chip
      name="U2"
      footprint="dfn6_thermalpad0.85mmx1.45mm_p0.65mm_w2.35mm_pw0.35mm_pl0.5mm_pin1location(leftside,bottom)"
      pcbX={-16}
      pcbY={10}
      schX={-14}
      schY={4}
    />
    <connector
      name="J1"
      pinCount={16}
      footprint="usbcmidmount16_tophw0.6mm_bottomhw0.6mm_tophh1.7mm_bottomhh1.4mm_topring0.2mm_bottomring0.2mm_rowy2.1mm_ph1.15mm_pw0.3mm_powerpw0.6mm_powerx3.2001mm_shellx4.32mm_topy1.5249mm_bottomy2.625mm_holex2.89mm_holey1.0255mm_holed0.65mm"
      pcbX={17}
      pcbY={-12}
      schX={14}
      schY={-6}
    />
    <capacitor
      name="C1"
      capacitance="100nF"
      footprint="0402"
      pcbX={-7}
      pcbY={9}
      schX={-6}
      schY={6}
    />
    <capacitor
      name="C2"
      capacitance="100nF"
      footprint="0402"
      pcbX={7}
      pcbY={9}
      schX={6}
      schY={6}
    />
    <resistor
      name="R1"
      resistance="10k"
      footprint="0402"
      pcbX={-11}
      pcbY={-2}
      schX={-10}
      schY={-2}
    />
    <resistor
      name="R2"
      resistance="10k"
      footprint="0402"
      pcbX={-7}
      pcbY={-2}
      schX={-6}
      schY={-2}
    />
    <led
      name="D1"
      footprint="res_p1.5mm_pw0.8mm_ph0.8mm"
      pcbX={8}
      pcbY={-8}
      schX={8}
      schY={-4}
    />
    <resistor
      name="R3"
      resistance="1k"
      footprint="0402"
      pcbX={13}
      pcbY={-8}
      schX={12}
      schY={-4}
    />
    <chip
      name="SW1"
      footprint="smdpushbutton4_px6mm_py3.7mm_pw1mm_ph0.75mm"
      pcbX={-17}
      pcbY={-12}
      schX={-15}
      schY={-8}
    />
    <chip
      name="SW2"
      footprint="smdpushbutton4_px6mm_py3.7mm_pw1mm_ph0.75mm"
      pcbX={-8}
      pcbY={-12}
      schX={-7}
      schY={-8}
    />
    <trace from=".J1 .pin1" to=".U2 .pin1" />
    <trace from=".U2 .pin2" to=".U1 .pin1" />
    <trace from=".C1 .pin1" to=".U1 .pin3" />
    <trace from=".C1 .pin2" to=".U1 .pin4" />
    <trace from=".C2 .pin1" to=".U1 .pin5" />
    <trace from=".C2 .pin2" to=".U1 .pin6" />
    <trace from=".R1 .pin1" to=".U1 .pin7" />
    <trace from=".R1 .pin2" to=".U2 .pin3" />
    <trace from=".R2 .pin1" to=".U1 .pin8" />
    <trace from=".R2 .pin2" to=".U1 .pin2" />
    <trace from=".SW1 .pin1" to=".U1 .pin9" />
    <trace from=".SW2 .pin1" to=".U1 .pin10" />
    <trace from=".D1 .pin1" to=".R3 .pin1" />
    <trace from=".R3 .pin2" to=".U1 .pin11" />
  </board>
)
`;

const T2_PARTS: Array<{ ref: string; lcsc: string; mpn: string | null; role: string }> = [
  { ref: "U1", lcsc: "C2040", mpn: "RP2040", role: "MCU dual-core Cortex-M0+" },
  { ref: "U2", lcsc: "C2924396", mpn: "BCT2057ELT33-TR", role: "LDO 3,3 V" },
  { ref: "J1", lcsc: "C393939", mpn: "TYPE-C16PIN", role: "USB-C alimentation + USB" },
  { ref: "D1", lcsc: "C6848499", mpn: "150060VS75000", role: "LED verte état" },
  { ref: "R3", lcsc: "C11702", mpn: "0402WGF1001TCE", role: "LED série 1 kΩ" },
  { ref: "R1", lcsc: "C25744", mpn: "0402WGF1002TCE", role: "Pull-up boot 10 kΩ" },
  { ref: "R2", lcsc: "C25744", mpn: "0402WGF1002TCE", role: "Pull-up boot 10 kΩ" },
  { ref: "C1", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
  { ref: "C2", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
  { ref: "SW1", lcsc: "C318884", mpn: "TS-1187A-B-A-B", role: "Bouton BOOT" },
  { ref: "SW2", lcsc: "C318884", mpn: "TS-1187A-B-A-B", role: "Bouton RESET" },
];

// ---------- T3 : breakout capteur I2C ----------

const T3_CODE = `// Template T3 — breakout capteur I2C + alimentation batterie (en-validation).
// Bloc « produit » : connecteur I2C externe 4P (VCC/GND/SDA/SCL), pull-ups
// explicites, connecteur batterie 2P avec sérigraphie de polarité, découplage.
// Le CAPTEUR lui-même est hors catalogue jlcsearch : brancher un module externe
// sur J1, ou sourcer la référence sur LCSC + getComponentDetails avant
// de l'intégrer au schéma. Brochage INDICATIF — datasheet avant fab (H2).
// Sourcing vérifié le ${STOCK_AT} : J1 C124378, J2 C492401, R1/R2 4,7k
// C25900, C1 100nF C1525.
circuit.add(
  <board width="40mm" height="30mm" layers={2}>
    <pinheader
      name="J1"
      pinCount={4}
      pitch="2.54mm"
      footprint="pinrow4_nosquareplating_od1.7mm_id1.1mm"
      pinLabels={["VCC", "GND", "SDA", "SCL"]}
      showSilkscreenPinLabels={true}
      pcbX={12}
      pcbY={0}
      schX={10}
      schY={0}
    />
    <pinheader
      name="J2"
      pinCount={2}
      pitch="2.54mm"
      footprint="radial_p2.54mm_od2mm_id1.2mm"
      pinLabels={["BATP", "BATN"]}
      showSilkscreenPinLabels={true}
      pcbX={-12}
      pcbY={0}
      schX={-10}
      schY={0}
    />
    <resistor
      name="R1"
      resistance="4.7k"
      footprint="0402"
      pcbX={0}
      pcbY={6}
      schX={0}
      schY={5}
    />
    <resistor
      name="R2"
      resistance="4.7k"
      footprint="0402"
      pcbX={-5}
      pcbY={6}
      schX={-5}
      schY={5}
    />
    <capacitor
      name="C1"
      capacitance="100nF"
      footprint="0402"
      pcbX={5}
      pcbY={6}
      schX={5}
      schY={5}
    />
    <trace from=".R1 .pin1" to=".J1 .pin3" />
    <trace from=".R1 .pin2" to=".J1 .pin1" />
    <trace from=".R2 .pin1" to=".J1 .pin4" />
    <trace from=".R2 .pin2" to=".J2 .pin1" />
    <trace from=".C1 .pin1" to=".J1 .pin2" />
    <trace from=".C1 .pin2" to=".J2 .pin2" />
  </board>
)
`;

const T3_PARTS: Array<{ ref: string; lcsc: string; mpn: string | null; role: string }> = [
  { ref: "J1", lcsc: "C124378", mpn: "B-2100S04P-A110", role: "Connecteur I2C externe 4P (VCC/GND/SDA/SCL)" },
  { ref: "J2", lcsc: "C492401", mpn: "PZ254V-11-02P", role: "Connecteur batterie 2P (sérigraphie +/−)" },
  { ref: "R1", lcsc: "C25900", mpn: "0402WGF4701TCE", role: "Pull-up SDA 4,7 kΩ" },
  { ref: "R2", lcsc: "C25900", mpn: "0402WGF4701TCE", role: "Pull-up SCL 4,7 kΩ" },
  { ref: "C1", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
];

function bomOf(
  parts: typeof T1_PARTS,
  footprints: Record<string, string>,
  stocks: Record<string, number | null>
): TemplateBomRow[] {
  return parts.map((p) => ({
    ref: p.ref,
    value: p.role,
    lcsc: p.lcsc,
    mpn: p.mpn,
    footprint: footprints[p.ref] ?? "?",
    role: p.role,
    stock: stocks[p.lcsc] ?? null,
    stockAt: STOCK_AT,
  }));
}

export const TEMPLATES: ProjectTemplate[] = [
  {
    id: "T1",
    title: "ESP32-C3 minimal",
    description: "MCU ESP32-C3, USB-C, LDO 3,3 V, LED, boutons BOOT/RESET. Base des cartes R1/R3.",
    status: "en-validation",
    board: { widthMm: 50, depthMm: 40, layers: 2 },
    matches: ["esp32", "esp32-c3", "wifi", "ble", "bluetooth", "capteur i2c", "bme280", "r1", "r3"],
    bom: bomOf(
      T1_PARTS,
      {
        U1: "QFN-32 (C2858491)",
        U2: "DFN-6 (C2924396)",
        J1: "USB-C midmount 16P (C393939)",
        D1: "LED 0603/1608 (C6848499)",
        R2: "0402",
        R1: "0402",
        C1: "0402",
        C2: "0402",
        SW1: "6×6 mm (C318884)",
        SW2: "6×6 mm (C318884)",
      },
      { C2858491: 26488, C2924396: 11795, C393939: 414170, C6848499: 46944, C11702: 21651885, C25744: 17005459, C1525: 36200919, C318884: 1122027 }
    ),
    files: { "main.tsx": T1_CODE, "parts.json": JSON.stringify(T1_PARTS, null, 2) + "\n" },
    limits: [
      "Brochage indicatif : confirmer chaque pin sur datasheet avant fabrication.",
      "Antenne ESP32-C3 : garder la zone sous antenne dégagée (voir datasheet).",
    ],
  },
  {
    id: "T2",
    title: "RP2040 minimal",
    description: "MCU RP2040, USB-C, LDO 3,3 V, LED, boutons BOOT/RESET. Base de la carte R2.",
    status: "en-validation",
    board: { widthMm: 50, depthMm: 40, layers: 2 },
    matches: ["rp2040", "raspberry", "pico", "r2", "usb bootloader"],
    bom: bomOf(
      T2_PARTS,
      {
        U1: "QFN-56 (C2040)",
        U2: "DFN-6 (C2924396)",
        J1: "USB-C midmount 16P (C393939)",
        D1: "LED 0603/1608 (C6848499)",
        R3: "0402",
        R1: "0402",
        R2: "0402",
        C1: "0402",
        C2: "0402",
        SW1: "6×6 mm (C318884)",
        SW2: "6×6 mm (C318884)",
      },
      { C2040: 64668, C2924396: 11795, C393939: 414170, C6848499: 46944, C11702: 21651885, C25744: 17005459, C1525: 36200919, C318884: 1122027 }
    ),
    files: { "main.tsx": T2_CODE, "parts.json": JSON.stringify(T2_PARTS, null, 2) + "\n" },
    limits: [
      "Brochage indicatif : confirmer chaque pin sur datasheet avant fabrication.",
      "Quartz 12 MHz + flash SPI (ex. W25Q128) HORS catalogue jlcsearch : sourcer sur LCSC + getComponentDetails, valider avant routage final.",
    ],
  },
  {
    id: "T3",
    title: "Breakout capteur I2C",
    description: "Connecteur I2C externe 4P, pull-ups 4,7 kΩ, connecteur batterie 2P, découplage. Bloc des cartes R1/R3.",
    status: "en-validation",
    board: { widthMm: 40, depthMm: 30, layers: 2 },
    matches: ["i2c", "capteur", "bme280", "breakout", "jst", "batterie", "r3", "grove", "stemma"],
    bom: bomOf(
      T3_PARTS,
      {
        J1: "2,54 mm 4P (C124378)",
        J2: "2,54 mm 2P (C492401)",
        R1: "0402",
        R2: "0402",
        C1: "0402",
      },
      { C124378: null, C492401: 918591, C25900: 15018488, C1525: 36200919 }
    ),
    files: { "main.tsx": T3_CODE, "parts.json": JSON.stringify(T3_PARTS, null, 2) + "\n" },
    limits: [
      "Le capteur lui-même est hors catalogue jlcsearch : module externe sur J1, ou référence LCSC + getComponentDetails.",
      "Polarité batterie sérigraphiée (BAT+/BAT−) — pas de protection contre l'inversion sur ce bloc.",
    ],
  },
];

/** Métadonnées publiques (galerie UI, outil listTemplates) — sans le code. */
export function listTemplateMeta(): Array<
  Pick<ProjectTemplate, "id" | "title" | "description" | "status" | "board" | "matches" | "limits"> & {
    bomCount: number;
  }
> {
  return TEMPLATES.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status,
    board: t.board,
    matches: t.matches,
    limits: t.limits,
    bomCount: t.bom.length,
  }));
}

export function getTemplate(id: string): ProjectTemplate | null {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
