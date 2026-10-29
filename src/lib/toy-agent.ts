// Tâche jouet M0 partagée par la route /api/chat et le benchmark (doc 08 M0-5).
// Aucun import provider ici : utilisable côté serveur (route, benchmark) et
// réutilisable côté client plus tard. L'évaluation "verte" de référence reste
// le WebWorker @tscircuit/eval (issue #1) ; `staticEvaluateCircuit` est un
// proxy rapide aux verdicts équivalents sur la carte jouet (vérifié en dry-run).
import { z } from "zod";
import type { CircuitSummary } from "./tscircuit-eval";
import { TOY_ENTRYPOINT } from "./toy-circuit";

/** Carte jouet M0 : « ESP32-C3 + LED + bouton » (doc 08 M0-5, corpus à venir en M1). */
export const TOY_TASK_PROMPT = [
  "Conçois la carte jouet : ESP32-C3 + LED + bouton, 40 × 30 mm, 2 couches.",
  "Utilise OBLIGATOIREMENT les outils : écris le fichier avec write_circuit_file,",
  "puis vérifie avec evaluate_circuit, puis corrige jusqu'à ce que le build soit vert.",
  `Point d'entrée : ${TOY_ENTRYPOINT}. Conventions tscircuit : un <board>,`,
  "composants nommés (U1, R1, C1, D1, SW1), traces from/to entre pins existants,",
  "footprints 0402/0603/soic8. Réponds en français, résumé court uniquement.",
].join(" ");

export const TOY_SYSTEM_PROMPT = [
  "Tu es l'agent PCB NIATOLIP (jalon M0). Tu conçois des cartes via tes outils.",
  "Règles impératives :",
  "1. Toute modification de circuit passe par l'outil write_circuit_file.",
  "2. Après chaque écriture, appelle evaluate_circuit et lis les erreurs.",
  "3. Tant que le build n'est pas vert, corrige et réévalue (autres composants,",
  "   autre placement, simplification) — tu ne changes jamais de modèle,",
  "   tu changes de stratégie technique.",
  "4. Tu ne demandes jamais à l'utilisateur de changer de modèle.",
  "5. Réponses courtes, en français. Jamais de Circuit JSON brut.",
].join("\n");

export const writeCircuitFileSchema = z.object({
  path: z.string().min(1).max(120).describe("Chemin du fichier, ex. main.tsx"),
  content: z.string().min(1).max(20_000).describe("Code tscircuit complet du fichier"),
});

export const evaluateCircuitSchema = z.object({
  entrypoint: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(`Point d'entrée (défaut : ${TOY_ENTRYPOINT})`),
});

export type WriteCircuitFileInput = z.infer<typeof writeCircuitFileSchema>;
export type EvaluateCircuitInput = z.infer<typeof evaluateCircuitSchema>;

const COMPONENT_TAG_RE =
  /<(chip|resistor|capacitor|inductor|led|diode|transistor|crystal|oscillator|connector|button|switch|testpoint)\b/g;
const DEFINED_NAME_RE = /name="([A-Za-z0-9_]+)"/g;
const TRACE_ENDPOINT_RE = /(?:from|to)="([^"]+)"/g;
const SELECTOR_REF_RE = /\.([A-Za-z0-9_]+)/g;

/**
 * Évaluation statique rapide : composants/traces comptés, références de
 * traces résolues contre les noms définis. Verdict équivalent au WebWorker
 * sur la carte jouet (good → vert, broken R99 → 1 erreur).
 */
export function staticEvaluateCircuit(
  fsMap: Record<string, string>,
  entrypoint: string = TOY_ENTRYPOINT
): CircuitSummary {
  const started = Date.now();
  const code = fsMap[entrypoint];
  if (typeof code !== "string" || code.trim().length === 0) {
    return {
      elements: 0,
      components: 0,
      traces: 0,
      errors: [
        {
          kind: "exception",
          code: "exception",
          message: `Point d'entrée "${entrypoint}" introuvable ou vide.`,
        },
      ],
      ok: false,
      durationMs: Date.now() - started,
    };
  }

  const components = (code.match(COMPONENT_TAG_RE) ?? []).length;
  const traceEndpoints = [...code.matchAll(TRACE_ENDPOINT_RE)].map((m) => m[1]);
  const traces = traceEndpoints.length > 0 ? Math.ceil(traceEndpoints.length / 2) : 0;
  const defined = new Set([...code.matchAll(DEFINED_NAME_RE)].map((m) => m[1]));

  const errors: CircuitSummary["errors"] = [];
  if (!/<board\b/.test(code)) {
    errors.push({
      kind: "circuit_error",
      code: "missing_board",
      message: "Aucun élément <board> dans le circuit.",
    });
  }
  if (components === 0) {
    errors.push({
      kind: "circuit_error",
      code: "no_components",
      message: "Aucun composant détecté.",
    });
  }
  const seen = new Set<string>();
  for (const endpoint of traceEndpoints) {
    for (const ref of endpoint.matchAll(SELECTOR_REF_RE)) {
      const name = ref[1];
      // Les pins (.pin1, .pin2…) ne sont pas des composants.
      if (/^pin\d*$/i.test(name)) continue;
      if (!defined.has(name) && !seen.has(name)) {
        seen.add(name);
        errors.push({
          kind: "circuit_error",
          code: "source_trace_not_connected_error",
          message: `Trace vers "${name}" : composant introuvable (équivalent source_trace_not_connected_error).`,
        });
      }
    }
  }

  const boardMatch = /width="([\d.]+)mm"[^>]*height="([\d.]+)mm"/.exec(code);
  return {
    elements: components + traces + (/<board\b/.test(code) ? 1 : 0),
    components,
    traces,
    errors: errors.slice(0, 20),
    board: boardMatch
      ? { width: Number(boardMatch[1]), height: Number(boardMatch[2]), layers: 2 }
      : undefined,
    ok: errors.length === 0,
    durationMs: Date.now() - started,
  };
}

/** Session en mémoire : le fsMap d'un run jouet + son dernier résumé borné. */
export class ToyCircuitSession {
  fsMap: Record<string, string> = {};
  lastEntry: string = TOY_ENTRYPOINT;

  constructor(initial?: Record<string, string>) {
    if (initial) this.fsMap = { ...initial };
  }

  writeFile(input: WriteCircuitFileInput): { path: string; bytes: number } {
    const parsed = writeCircuitFileSchema.parse(input);
    this.fsMap[parsed.path] = parsed.content;
    this.lastEntry = parsed.path;
    return { path: parsed.path, bytes: parsed.content.length };
  }

  evaluate(input?: EvaluateCircuitInput): CircuitSummary {
    const parsed = evaluateCircuitSchema.parse(input ?? {});
    const entry = parsed.entrypoint ?? this.lastEntry;
    return staticEvaluateCircuit(this.fsMap, entry);
  }
}
