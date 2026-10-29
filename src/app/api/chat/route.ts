// Route agent M1 (issue #4) : boucle ToolLoop via streamText + 12 outils projet.
// Un run = un modèle (fixé avant le run, jamais changé). Garde-fous doc 03 §6 :
// stopWhen 50 étapes, plafond de coût configurable, annulation propre (abort).
// Coût/étapes exposés en direct via GET /api/chat/[runId] (registre mémoire).
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
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
      messages: await convertToModelMessages(body.messages),
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
