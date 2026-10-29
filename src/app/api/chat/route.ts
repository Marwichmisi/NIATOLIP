// Route agent M1 (issue #4) : boucle ToolLoop via streamText + 12 outils projet.
// Un run = un modèle (fixé avant le run, jamais changé). Garde-fous doc 03 §6 :
// stopWhen 50 étapes, plafond de coût configurable, annulation propre (abort).
// Coût/étapes exposés en direct via GET /api/chat/[runId] (registre mémoire).
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isStepCount,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { randomUUID } from "node:crypto";
import { getProject } from "@/lib/projects";
import {
  estimateCost,
  getDefaultChoice,
  getModel,
  META_TOOL_CHOICE,
  MODEL_CHOICES,
  type ModelChoice,
} from "@/lib/models";
import { AGENT_PROMPT_VERSION, AGENT_SYSTEM_PROMPT } from "@/lib/prompts/agent-system";
import { AgentRunState, createAgentTools, type ClientBoardState } from "@/lib/agent-run";
import { getRun, registerRun, touchRun } from "@/lib/agent-runs";

export const maxDuration = 900; // 15 min max par run (doc 03 §6)

// Timeout ferme des appels modèle : sans lui, une connexion pendante
// (ex. `terminated` côté Meta) laisse le run orphelin à jamais.
// Combiné au signal client (annulation Stop) via AbortSignal.any.
const RUN_TIMEOUT_MS = 14 * 60 * 1000;

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

function maxCostUsd(): number {
  const raw = Number(process.env.AGENT_RUN_BUDGET_USD ?? "2");
  return Number.isFinite(raw) && raw > 0 ? raw : 2;
}

// Seuil de compaction auto (caractères JSON de l'historique) : au-delà, les
// vieux échanges sont résumés et seuls les derniers sont gardés intacts.
// Sans ça, renvoyer tout l'historique à chaque run coûte de plus en plus cher.
function compactThresholdChars(): number {
  const raw = Number(process.env.NIATOLIP_COMPACT_CHARS ?? "120000");
  return Number.isFinite(raw) && raw > 0 ? raw : 120000;
}

const COMPACT_KEEP_LAST = 8;

/** Ne garde que texte + dynamic-tool valides (ignore tout autre part client). */
function sanitizeUiMessages(messages: UIMessage[]): UIMessage[] {
  return messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && Array.isArray(m.parts))
    .map((m) => ({
      ...m,
      parts: (m.parts as unknown[]).filter((p) => {
        const part = p as Record<string, unknown>;
        if (part.type === "text") return typeof part.text === "string";
        return (
          part.type === "dynamic-tool" &&
          typeof part.toolName === "string" &&
          typeof part.toolCallId === "string" &&
          (part.state === "output-available" || part.state === "output-error")
        );
      }),
    }))
    .filter((m) => (m.parts as unknown[]).length > 0) as unknown as UIMessage[];
}

/**
 * Compaction manuelle (doc 03 §5) : résume les vieux échanges via le modèle
 * et ne garde que les derniers intacts. Invisible pour l'UI (reconstruit à
 * chaque run, jamais persisté). Un seul appel LLM, seulement au-delà du seuil.
 */
async function maybeCompact(
  model: ReturnType<typeof getModel>,
  messages: UIMessage[]
): Promise<UIMessage[]> {
  if (messages.length <= COMPACT_KEEP_LAST + 2) return messages;
  if (JSON.stringify(messages).length <= compactThresholdChars()) return messages;
  console.log(`[agent] compaction auto : ${messages.length} messages → résumé + ${COMPACT_KEEP_LAST} intacts`);
  const head = messages.slice(0, -COMPACT_KEEP_LAST);
  const tail = messages.slice(-COMPACT_KEEP_LAST);
  const digest = head
    .map((m) => {
      const texts = (m.parts as unknown[])
        .filter((p) => (p as { type: string }).type === "text")
        .map((p) => String((p as { text: unknown }).text ?? "").slice(0, 2000))
        .join("\n");
      const tools = (m.parts as unknown[])
        .filter((p) => (p as { type: string }).type === "dynamic-tool")
        .map(
          (p) => {
            const t = p as { toolName: string; input: unknown; output?: unknown; error?: string };
            return `outil ${t.toolName} ${t.error ? `ERREUR ${t.error}` : "OK"} : ${JSON.stringify(t.input ?? null).slice(0, 300)} → ${JSON.stringify(t.output ?? null).slice(0, 800)}`;
          }
        )
        .join("\n");
      return `[${m.role}] ${texts}\n${tools}`;
    })
    .join("\n---\n")
    .slice(0, 100000);
  try {
    const summary = await generateText({
      model,
      system: "Tu résumes fidèlement un historique de conception PCB pour reprise de contexte. Concis, factuel, en français.",
      prompt:
        "Résume cet historique (fichiers du projet, composants LCSC retenus avec références, résultats des gates G0–G3, décisions, erreurs rencontrées et comment elles ont été résolues, état actuel) en 30 lignes max. Ne rien inventer.\n\n" + digest,
      maxOutputTokens: 2000,
    });
    const note = {
      id: `compact-${Date.now()}`,
      role: "assistant",
      parts: [
        {
          type: "text",
          text: `[Résumé auto des runs précédents — contexte compacté]\n${summary.text.slice(0, 6000)}`,
        },
      ],
    } as unknown as UIMessage;
    return [note, ...tail];
  } catch (err) {
    // Résumé impossible : on envoie l'historique tel quel (mieux que rien).
    console.error("[agent] compaction échouée :", err instanceof Error ? err.message : String(err));
    return messages;
  }
}

interface ChatBody {
  messages?: UIMessage[];
  model?: unknown;
  projectId?: unknown;
  clientBoard?: ClientBoardState | null;
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Corps JSON invalide." }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages manquant (tableau UIMessage)." }, { status: 400 });
  }
  if (typeof body.projectId !== "string" || body.projectId.length === 0) {
    return Response.json({ error: "projectId manquant." }, { status: 400 });
  }

  const choice = parseChoice(body.model);
  let project;
  try {
    project = await getProject(body.projectId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Projet introuvable.";
    return Response.json({ error: message }, { status: 404 });
  }

  let model;
  try {
    model = getModel(choice);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /manquante/.test(message) ? 503 : 400;
    return Response.json({ error: message }, { status });
  }

  const runId = randomUUID();
  const max = maxSteps();
  const costCap = maxCostUsd();
  registerRun({
    id: runId,
    projectId: project.id,
    choice,
    steps: 0,
    maxSteps: max,
    costUsd: 0,
    maxCostUsd: costCap,
    done: false,
    aborted: false,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });

  const state = new AgentRunState();
  const tools = createAgentTools(
    { projectId: project.id, clientBoard: body.clientBoard ?? null },
    state
  );

  try {
    // Mémoire inter-runs : l'historique complet (texte + appels d'outils)
    // est renvoyé au modèle ; compacté au-delà du seuil (doc 03 §5).
    const uiMessages = await maybeCompact(model, sanitizeUiMessages(body.messages));
    const result = streamText({
      model,
      // Annulation client (bouton Stop) + timeout ferme 14 min.
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(RUN_TIMEOUT_MS)]),
      maxRetries: 2,
      instructions: [
        AGENT_SYSTEM_PROMPT,
        "",
        `Contexte run : projet "${project.name}" (${project.id}), modèle ${choice}.`,
        `Prompt version ${AGENT_PROMPT_VERSION}. Budget : ${costCap} USD max, ${max} étapes max.`,
      ].join("\n"),
      messages: await convertToModelMessages(uiMessages),
      tools,
      toolChoice: META_TOOL_CHOICE,
      stopWhen: [
        isStepCount(max),
        // Plafond de coût : lecture du cumul tenu dans onStepEnd (≤1 étape de dépassement).
        () => (getRun(runId)?.costUsd ?? 0) >= costCap,
      ],
      onStepEnd: ({ usage }) => {
        const run = getRun(runId);
        if (!run) return;
        const stepCost = estimateCost(choice, {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        });
        touchRun(runId, {
          steps: run.steps + 1,
          costUsd: run.costUsd + (Number.isFinite(stepCost) ? stepCost : 0),
        });
      },
      onFinish: () => {
        touchRun(runId, { done: true, finishedAt: new Date().toISOString() });
      },
      onError: ({ error }) => {
        touchRun(runId, {
          done: true,
          error: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      },
      onAbort: () => {
        touchRun(runId, { done: true, aborted: true, finishedAt: new Date().toISOString() });
      },
    });
    return createUIMessageStreamResponse({
      stream: toUIMessageStream({ stream: result.stream }),
      headers: { "X-Run-Id": runId },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    touchRun(runId, { done: true, error: message, finishedAt: new Date().toISOString() });
    return Response.json({ error: `Échec agent : ${message}` }, { status: 502 });
  }
}
