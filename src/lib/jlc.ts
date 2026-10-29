// Client serveur de l'API jlcsearch (doc 03 §3.2) — source UNIQUE de
// composants réels pour l'agent. Aucun LCSC/MPN n'est inventé : toute
// référence utilisée par l'agent doit provenir d'ici (traçabilité vérifiée
// par `getCircuitSummary`, voir agent-run.ts).
//
// API : https://jlcsearch.tscircuit.com (JSON, sans clé). Connectivité
// requise — en cas d'échec, erreur explicite, jamais de données inventées.
// Cache mémoire TTL 24 h (doc 03 : "Met en cache").

import { z } from "zod";

const JLC_BASE = "https://jlcsearch.tscircuit.com";

// Sous-ensemble MVP (périmètre D8 : pas de BGA/DDR/RF). Route → table.
// Source : ROUTE_TO_TABLE de jlcsearch (cf-proxy/src/handlers/index.ts).
export const JLC_CATEGORIES = {
  resistor: "/resistors/list",
  capacitor: "/capacitors/list",
  microcontroller: "/microcontrollers/list",
  ldo: "/ldos/list",
  voltage_regulator: "/voltage_regulators/list",
  led: "/leds/list",
  diode: "/diodes/list",
  mosfet: "/mosfets/list",
  bjt_transistor: "/bjt_transistors/list",
  switch: "/switches/list",
  potentiometer: "/potentiometers/list",
  fuse: "/fuses/list",
  usb_c_connector: "/usb_c_connectors/list",
  micro_usb_connector: "/micro_usb_connectors/list",
  header: "/headers/list",
  jst_connector: "/jst_connectors/list",
  barrel_jack: "/barrel_jacks/list",
  wifi_module: "/wifi_modules/list",
  ble_module: "/ble_modules/list",
  oled_display: "/oled_display/list",
} as const;

export type JlcCategory = keyof typeof JLC_CATEGORIES;

export const searchComponentsSchema = z.object({
  category: z
    .enum(Object.keys(JLC_CATEGORIES) as [JlcCategory, ...JlcCategory[]])
    .describe("Famille de composants (route jlcsearch)."),
  filters: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .describe(
      "Filtres passés tels quels à l'API (ex. { resistance: 10000, package: '0402' } ; " +
        "microcontrôleur : { has_usb: true, has_i2c: true, flash_min: 262144 }). " +
        "Valeurs numériques en unités SI de base (ohms, farads, octets)."
    )
    .default({}),
  basicOnly: z
    .boolean()
    .optional()
    .describe("Ne garder que les pièces JLCPCB Basic (assemblage économique)."),
  inStockOnly: z
    .boolean()
    .optional()
    .describe("Ne garder que les pièces en stock (défaut : true)."),
  limit: z.number().int().min(1).max(10).optional().describe("Max 10 candidats."),
});

export type SearchComponentsInput = z.infer<typeof searchComponentsSchema>;

export interface JlcCandidate {
  lcscId: string;
  mpn: string | null;
  description: string | null;
  package: string | null;
  stock: number | null;
  price: number | null;
  basic: boolean;
  preferred: boolean;
}

export interface JlcSearchResult {
  candidates: JlcCandidate[];
  cached: boolean;
  fetchedAt: string;
  /** Présent quand certains candidats ont un stock inconnu (null) : à revérifier avant commande. */
  stockWarning?: string;
}

export interface JlcDetails {
  lcscId: string;
  footprinter: string | null;
  footprintVerified: boolean;
  title: string | null;
  package: string | null;
  pinCount: number | null;
  /** Extrait des attributs EasyEDA (borné), null si indisponible. */
  attributes: Record<string, string> | null;
  note: string;
}

// ---------- Cache mémoire (TTL 24 h) ----------

const CACHE_TTL_MS = 24 * 3600 * 1000;
const cache = new Map<string, { at: number; data: unknown }>();

function cacheGet<T>(key: string): (T & { cached: true }) | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
    if (hit) cache.delete(key);
    return null;
  }
  return { ...(hit.data as T), cached: true as const };
}

function cacheSet(key: string, data: unknown): void {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

// ---------- HTTP (timeout + retries, erreur explicite) ----------

async function fetchJson(url: string, timeoutMs = 45_000): Promise<unknown> {
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { Accept: "application/json", "User-Agent": "NIATOLIP-agent/1.0" },
      });
      if (!res.ok) {
        lastError = `jlcsearch HTTP ${res.status} sur ${url}`;
        continue;
      }
      return (await res.json()) as unknown;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(
    `Recherche composants injoignable après 3 essais (${lastError}). ` +
      `Vérifiez la connexion — aucune référence ne sera inventée en remplacement.`
  );
}

function toCandidate(row: Record<string, unknown>): JlcCandidate {
  const lcsc = Number(row.lcsc);
  const desc = typeof row.description === "string" ? row.description.slice(0, 160) : null;
  return {
    lcscId: Number.isFinite(lcsc) ? `C${lcsc}` : "C?",
    mpn: typeof row.mfr === "string" ? row.mfr : null,
    description: desc,
    package: typeof row.package === "string" ? row.package : null,
    stock: typeof row.stock === "number" ? row.stock : null,
    price: typeof row.price1 === "number" ? row.price1 : null,
    basic: row.is_basic === true || row.is_basic === 1,
    preferred: row.is_preferred === true || row.is_preferred === 1,
  };
}

/** Recherche réelle JLCPCB — jusqu'à 10 candidats, triés stock décroissant. */
export async function searchComponents(input: SearchComponentsInput): Promise<JlcSearchResult> {
  const parsed = searchComponentsSchema.parse(input);
  const route = JLC_CATEGORIES[parsed.category];
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(parsed.filters).slice(0, 8)) {
    params.set(k, String(v));
  }
  const key = `${route}?${params.toString()}|b:${parsed.basicOnly ?? "-"}|s:${parsed.inStockOnly ?? true}|l:${parsed.limit ?? 10}`;
  const hit = cacheGet<JlcSearchResult>(key);
  if (hit) return { ...hit, cached: true };

  const url = `${JLC_BASE}${route}.json${params.toString() ? `?${params.toString()}` : ""}`;
  const data = (await fetchJson(url)) as Record<string, unknown>;
  // Clé de réponse = pluriel de la table (ex. { resistors: [...] }).
  const listKey = Object.keys(data).find((k) => Array.isArray(data[k]));
  const rows = (listKey ? (data[listKey] as unknown[]) : []) as Record<string, unknown>[];

  const inStockOnly = parsed.inStockOnly ?? true;
  let candidates = rows.map(toCandidate).filter((c) => c.lcscId !== "C?");
  // Stock null = inconnu (données de sync incomplètes), pas forcément rupture :
  // on exclut uniquement le stock 0 explicite, inconnus relégués en fin de liste.
  if (inStockOnly) candidates = candidates.filter((c) => (c.stock ?? -1) !== 0);
  if (parsed.basicOnly) candidates = candidates.filter((c) => c.basic);
  candidates.sort((a, b) => (b.stock ?? -1) - (a.stock ?? -1));
  candidates = candidates.slice(0, parsed.limit ?? 10);

  const result: JlcSearchResult = {
    candidates,
    cached: false,
    fetchedAt: new Date().toISOString(),
    ...(candidates.length === 0
      ? {
          stockWarning:
            "0 candidat : vérifiez les filtres (unités SI : ohms, farads, octets ; pas de suffixe k/M) " +
            "ou réessayez (sync catalogue en cours possible). N'inventez rien.",
        }
      : candidates.some((c) => c.stock == null)
        ? { stockWarning: "Stock inconnu (null) pour certains candidats — revérifier avant commande (données de sync)." }
        : {}),
  };
  cacheSet(key, result);
  return result;
}

/** Détails d'une pièce : footprint tscircuit vérifié + résumé EasyEDA borné. */
export async function getComponentDetails(lcscId: string): Promise<JlcDetails> {
  const m = /^C?(\d{4,})$/i.exec(lcscId.trim());
  if (!m) throw new Error(`LCSC invalide : "${lcscId}" (attendu : C123456).`);
  const id = `C${m[1]}`;
  const key = `details:${id}`;
  const hit = cacheGet<JlcDetails>(key);
  if (hit) return { ...hit, cached: true } as JlcDetails;

  const [fpRaw, eeRaw] = await Promise.all([
    fetchJson(`${JLC_BASE}/api/footprinter_strings/${id}`).catch(() => null),
    fetchJson(`${JLC_BASE}/api/easyeda_components/${id}?cache_only=true`).catch(() => null),
  ]);

  const fp = (fpRaw as { component_footprinter_details?: { footprinter_string?: string | null } } | null)
    ?.component_footprinter_details;
  const ee = (eeRaw as { easyeda_component_details?: { easyeda_json?: Record<string, unknown> } } | null)
    ?.easyeda_component_details?.easyeda_json;

  const title = ee && typeof ee.title === "string" ? (ee.title as string).slice(0, 120) : null;
  const footprint = ee && typeof ee.footprint === "string" ? (ee.footprint as string).slice(0, 80) : null;
  const pins = Array.isArray(ee?.pins) ? (ee.pins as unknown[]).length : null;
  const attributes: Record<string, string> | null =
    ee && typeof ee === "object" && ee.attributes && typeof ee.attributes === "object"
      ? Object.fromEntries(
          Object.entries(ee.attributes as Record<string, unknown>)
            .slice(0, 12)
            .map(([k, v]) => [k, String(v).slice(0, 80)])
        )
      : null;

  const details: JlcDetails = {
    lcscId: id,
    footprinter: fp?.footprinter_string ?? null,
    footprintVerified: fp?.footprinter_string != null,
    title,
    package: footprint,
    pinCount: pins,
    attributes,
    note:
      fp?.footprinter_string != null
        ? "Utiliser ce footprinter comme footprint dans le code tscircuit."
        : "Empreinte non vérifiée (IoU < 95 % ou non traitée) — choisir une autre pièce ou signaler le risque.",
  };
  cacheSet(key, details);
  return details;
}
