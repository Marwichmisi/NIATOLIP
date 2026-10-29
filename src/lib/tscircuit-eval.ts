// Évaluation tscircuit dans un WebWorker (jamais sur le thread principal,
// jamais côté serveur) + résumé borné du Circuit JSON.
//
// Le modèle/agent ne reçoit QUE le résumé (erreurs + compteurs), jamais
// le Circuit JSON complet (doc 01 §3.1, doc 03 §5).

export interface StructuredEvalError {
  kind: "exception" | "circuit_error";
  /** Type d'élément Circuit JSON fautif, ou "exception" */
  code: string;
  message: string;
}

export interface CircuitSummary {
  elements: number;
  components: number;
  traces: number;
  errors: StructuredEvalError[];
  board?: { width?: number; height?: number; layers?: number };
  ok: boolean;
  durationMs: number;
}

// Élément Circuit JSON minimal : on ne type que ce qu'on lit.
interface CircuitElement {
  type: string;
  message?: string;
  error?: string;
  name?: string;
  width?: number;
  height?: number;
  layer_count?: number;
  [key: string]: unknown;
}

function errorMessage(el: CircuitElement): string {
  if (typeof el.message === "string" && el.message.length > 0) return el.message;
  if (typeof el.error === "string" && el.error.length > 0) return el.error;
  const name = typeof el.name === "string" ? ` (${el.name})` : "";
  return `Erreur ${el.type}${name}`;
}

/** Résumé borné d'un Circuit JSON — extraction pure, réutilisée par la preview. */
export function summarizeCircuitJson(json: unknown, durationMs = 0): CircuitSummary {
  return summarize(Array.isArray(json) ? (json as CircuitElement[]) : [], durationMs);
}

function summarize(json: CircuitElement[], durationMs: number): CircuitSummary {
  const errors: StructuredEvalError[] = [];
  let components = 0;
  let traces = 0;
  let board: CircuitSummary["board"];

  for (const el of json) {
    if (typeof el.type !== "string") continue;
    // On ne compte que les éléments sources (l'intention de conception).
    // Les éléments pcb_*/schematic_* dérivés doubleraient les compteurs.
    if (el.type === "source_component") {
      components += 1;
    } else if (el.type === "source_trace") {
      traces += 1;
    } else if (el.type === "pcb_board") {
      board = {
        width: typeof el.width === "number" ? el.width : undefined,
        height: typeof el.height === "number" ? el.height : undefined,
        layer_count: typeof el.layer_count === "number" ? el.layer_count : undefined,
      } as CircuitSummary["board"];
    }
    if (el.type.endsWith("_error")) {
      errors.push({ kind: "circuit_error", code: el.type, message: errorMessage(el) });
    }
  }

  return {
    elements: json.length,
    components,
    traces,
    errors: errors.slice(0, 20),
    board,
    ok: errors.length === 0,
    durationMs,
  };
}

export async function evaluateCircuit(
  fsMap: Record<string, string>,
  entrypoint: string
): Promise<CircuitSummary> {
  const started = performance.now();
  // Import dynamique : le worker n'existe que dans le navigateur.
  const { createCircuitWebWorker } = await import("@tscircuit/eval/worker");
  const worker = await createCircuitWebWorker({});

  try {
    await worker.executeWithFsMap({ fsMap, entrypoint });
    await worker.renderUntilSettled();
    const json = await worker.getCircuitJson();
    return summarizeCircuitJson(Array.isArray(json) ? json : [], Math.round(performance.now() - started));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      elements: 0,
      components: 0,
      traces: 0,
      errors: [{ kind: "exception", code: "exception", message }],
      ok: false,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    await worker.kill().catch(() => {});
  }
}
