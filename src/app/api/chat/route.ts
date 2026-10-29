// Route jouet M0 (issue #2) : le même agent minimal que le benchmark,
// exposé en streaming pour valider l'intégration providers de bout en bout.
// Périmètre volontairement restreint : 2 outils, tâche carte jouet.
// Le catalogue complet d'outils et l'UX de run arrivent en M1 (issues #4-#5).
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import {
  getDefaultChoice,
  getModel,
  META_TOOL_CHOICE,
  MODEL_CHOICES,
  type ModelChoice,
} from "@/lib/models";
import {
  evaluateCircuitSchema,
  TOY_SYSTEM_PROMPT,
  ToyCircuitSession,
  writeCircuitFileSchema,
} from "@/lib/toy-agent";

export const maxDuration = 300;

function parseChoice(raw: unknown): ModelChoice {
  if (typeof raw === "string" && (MODEL_CHOICES as readonly string[]).includes(raw)) {
    return raw as ModelChoice;
  }
  return getDefaultChoice();
}

function maxSteps(): number {
  const raw = Number(process.env.AGENT_MAX_STEPS ?? "50");
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 50;
}

export async function POST(req: Request) {
  let body: { messages?: UIMessage[]; model?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages manquant (tableau UIMessage)." }, { status: 400 });
  }

  const choice = parseChoice(body.model);
  let model;
  try {
    model = getModel(choice);
  } catch (err) {
    // Clé manquante ou modèle interdit : 503/400 explicite, jamais de fuite de secret.
    const message = err instanceof Error ? err.message : String(err);
    const status = /manquante/.test(message) ? 503 : 400;
    return Response.json({ error: message }, { status });
  }

  // Session par requête : le fsMap du run vit le temps du streaming.
  const session = new ToyCircuitSession();
  const tools = {
    write_circuit_file: tool({
      description:
        "Écrit un fichier tscircuit (ex. main.tsx). Toute modification de circuit passe par cet outil.",
      inputSchema: writeCircuitFileSchema,
      execute: async (input) => session.writeFile(input),
    }),
    evaluate_circuit: tool({
      description:
        "Évalue le circuit et renvoie un résumé borné (compteurs + erreurs, jamais de Circuit JSON brut). À appeler après chaque écriture.",
      inputSchema: evaluateCircuitSchema,
      execute: async (input) => session.evaluate(input),
    }),
  } satisfies ToolSet;

  try {
    const result = streamText({
      model,
      instructions: TOY_SYSTEM_PROMPT,
      messages: await convertToModelMessages(body.messages),
      tools,
      // Contrainte Meta (doc 02 §3.3) : seul "auto" est accepté (HTTP 400 sinon).
      toolChoice: META_TOOL_CHOICE,
      stopWhen: isStepCount(maxSteps()),
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Échec agent : ${message}` }, { status: 502 });
  }
}
