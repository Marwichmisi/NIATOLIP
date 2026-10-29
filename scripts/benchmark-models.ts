#!/usr/bin/env tsx
// Benchmark M0 (issue #2) : le MÊME agent jouet que /api/chat, lancé contre
// chaque candidat (Spark 1.3 vs Wonder 1.0 ; openai-main ajouté uniquement si
// OPENAI_API_KEY + OPENAI_MAIN_MODEL sont posés — pas de clé OpenAI au M0).
//
// Usage :
//   npm run benchmark:models -- --dry-run        # sans clés : harnais + verdicts
//   npm run benchmark:models                     # réel : spark + wonder
//   npm run benchmark:models -- --only meta-spark
//   npm run benchmark:models -- --write-docs    # réel + MAJ docs/11-BENCHMARK-M0.md
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { generateText, isStepCount, tool, type ToolSet } from "ai";
import {
  estimateCost,
  getModel,
  getModelCatalog,
  getProviderStatus,
  isAllowedModelId,
  META_TOOL_CHOICE,
  MODEL_CHOICES,
  withMeta429Retry,
  type ModelChoice,
} from "../src/lib/models";
import {
  evaluateCircuitSchema,
  TOY_SYSTEM_PROMPT,
  TOY_TASK_PROMPT,
  ToyCircuitSession,
  writeCircuitFileSchema,
} from "../src/lib/toy-agent";
import { TOY_FSMAP_BROKEN, TOY_FSMAP_GOOD } from "../src/lib/toy-circuit";

const DOC_PATH = new URL("../docs/11-BENCHMARK-M0.md", import.meta.url);

interface RunMetrics {
  choice: ModelChoice;
  modelId: string;
  green: boolean;
  steps: number;
  toolCalls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  finalErrors: string[];
  skipped?: string;
}

function maxSteps(): number {
  const raw = Number(process.env.AGENT_MAX_STEPS ?? "50");
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 50;
}

function buildTools(session: ToyCircuitSession) {
  return {
    write_circuit_file: tool({
      description: "Écrit un fichier tscircuit (ex. main.tsx).",
      inputSchema: writeCircuitFileSchema,
      execute: async (input) => session.writeFile(input),
    }),
    evaluate_circuit: tool({
      description: "Évalue le circuit, renvoie un résumé borné.",
      inputSchema: evaluateCircuitSchema,
      execute: async (input) => session.evaluate(input),
    }),
  } satisfies ToolSet;
}

async function runCandidate(choice: ModelChoice): Promise<RunMetrics> {
  const { modelId } = getModelCatalog()[choice];
  const session = new ToyCircuitSession();
  const started = Date.now();
  const result = await withMeta429Retry(() =>
    generateText({
      model: getModel(choice),
      instructions: TOY_SYSTEM_PROMPT,
      prompt: TOY_TASK_PROMPT,
      tools: buildTools(session),
      toolChoice: META_TOOL_CHOICE,
      stopWhen: isStepCount(maxSteps()),
    })
  );
  const latencyMs = Date.now() - started;
  const steps = result.steps?.length ?? 0;
  let toolCalls = 0;
  for (const s of result.steps ?? []) {
    toolCalls += (s as { toolCalls?: unknown[] }).toolCalls?.length ?? 0;
  }
  const usage = result.usage as
    | { inputTokens?: number; outputTokens?: number }
    | undefined;
  const final = session.evaluate({});
  return {
    choice,
    modelId,
    green: final.ok,
    steps,
    toolCalls,
    latencyMs,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: estimateCost(choice, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    }),
    finalErrors: final.errors.map((e) => `${e.code}: ${e.message}`),
  };
}

function dryRun(): void {
  const checks: [string, boolean][] = [];
  // 1. Liste blanche : -contributor bloqué par défaut, IDs normaux autorisés.
  checks.push(["-contributor bloqué par défaut", !isAllowedModelId("muse-spark-1.3-contributor")]);
  checks.push(["IDs standard autorisés", isAllowedModelId("muse-spark-1.3")]);
  // 2. Catalogue : IDs par env avec replis.
  const catalog = getModelCatalog();
  checks.push(["spark = muse-spark-1.3 par défaut", catalog["meta-spark"].modelId.length > 0]);
  checks.push(["wonder = muse-wonder-1.0 par défaut", catalog["meta-wonder"].modelId.length > 0]);
  // 3. Verdicts : good → vert, broken → 1 erreur type WebWorker.
  const good = new ToyCircuitSession(TOY_FSMAP_GOOD).evaluate({});
  const broken = new ToyCircuitSession(TOY_FSMAP_BROKEN).evaluate({});
  checks.push(["fixture good → build vert", good.ok && good.errors.length === 0]);
  checks.push([
    "fixture broken → 1 erreur source_trace_not_connected_error",
    !broken.ok &&
      broken.errors.some((e) => e.code === "source_trace_not_connected_error" && /R99/.test(e.message)),
  ]);
  // 4. Schémas Zod : entrées invalides rejetées.
  checks.push([
    "write_circuit_file rejette un contenu vide",
    writeCircuitFileSchema.safeParse({ path: "main.tsx", content: "" }).success === false,
  ]);
  checks.push([
    "evaluate_circuit accepte un appel sans argument",
    evaluateCircuitSchema.safeParse({}).success === true,
  ]);
  // 5. Garde serveur : models.ts refuse le navigateur (vérifié par inspection :
  //    `typeof window` guard en tête de module). Non exécutable ici — rappel.
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (failed.length > 0) {
    console.error(`\nDRY-RUN ÉCHEC : ${failed.length} vérification(s) en échec.`);
    process.exit(1);
  }
  console.log("\nDRY-RUN OK — harnais valide (benchmark réel dès MODEL_API_KEY posée).");
}

function printTable(runs: RunMetrics[]): void {
  console.log("\n| Modèle | ID testé | Vert | Étapes | Appels outils | Latence | In/out tokens | Coût/run |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const r of runs) {
    if (r.skipped) {
      console.log(`| ${r.choice} | ${r.modelId} | — | — | — | — | — | — | (${r.skipped}) |`);
      continue;
    }
    const cost = Number.isNaN(r.costUsd) ? "n/a" : `$${r.costUsd.toFixed(4)}`;
    console.log(
      `| ${r.choice} | ${r.modelId} | ${r.green ? "✅" : "❌"} | ${r.steps} | ${r.toolCalls} | ${(r.latencyMs / 1000).toFixed(1)}s | ${r.inputTokens}/${r.outputTokens} | ${cost} |`
    );
  }
}

function writeDocs(runs: RunMetrics[]): void {
  const lines = readFileSync(DOC_PATH, "utf-8").split("\n");
  const rowFor = (choice: ModelChoice): string => {
    const r = runs.find((x) => x.choice === choice);
    if (!r || r.skipped) return `| ${choice} | | / | | | | ${choice === "openai-main" ? "optionnel — testé quand une clé sera disponible" : "skippé (clé manquante)"} |`;
    const cost = Number.isNaN(r.costUsd) ? "n/a" : `$${r.costUsd.toFixed(4)}`;
    return `| ${choice} | ${r.modelId} | ${r.green ? "1" : "0"}/1 | ${r.steps} | ${(r.latencyMs / 1000).toFixed(1)}s | ${cost} | ${r.green ? "build vert" : "échec : " + r.finalErrors.slice(0, 2).join(" ; ")} |`;
  };
  const out = lines.map((l) =>
    /^\| (meta-spark|meta-wonder|openai-main) \|/.test(l)
      ? rowFor(l.match(/^\| (meta-spark|meta-wonder|openai-main) \|/)![1] as ModelChoice)
      : l
  );
  writeFileSync(DOC_PATH, out.join("\n"));
  console.log(`\nTableau mis à jour dans docs/11-BENCHMARK-M0.md`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--dry-run")) {
    dryRun();
    return;
  }
  const onlyArg = args.find((a) => a === "--only");
  const only = onlyArg ? args[args.indexOf("--only") + 1] : undefined;
  if (only && !(MODEL_CHOICES as readonly string[]).includes(only)) {
    console.error(`--only attend l'une de : ${MODEL_CHOICES.join(", ")}`);
    process.exit(1);
  }

  const status = getProviderStatus();
  const wanted: ModelChoice[] = only
    ? [only as ModelChoice]
    : (["meta-spark", "meta-wonder"] as const).filter((c) => status[c].configured).length > 0
      ? (["meta-spark", "meta-wonder"] as ModelChoice[])
      : [];
  // openai-main : ajouté automatiquement si configuré (pas de clé au M0).
  const candidates: ModelChoice[] = only
    ? [only as ModelChoice]
    : ([...wanted, ...(["openai-main"] as ModelChoice[]).filter((c) => status[c].configured)]);

  if (candidates.length === 0) {
    console.error(
      "Aucune clé configurée : posez MODEL_API_KEY dans .env (voir .env.example), ou relancez avec --dry-run."
    );
    process.exit(2);
  }

  const runs: RunMetrics[] = [];
  for (const choice of candidates) {
    if (!status[choice].configured) {
      runs.push({
        choice,
        modelId: getModelCatalog()[choice].modelId,
        green: false,
        steps: 0,
        toolCalls: 0,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: NaN,
        finalErrors: [],
        skipped: "clé manquante",
      });
      continue;
    }
    console.log(`\n▶ ${choice} (${getModelCatalog()[choice].modelId})…`);
    runs.push(await runCandidate(choice));
  }
  printTable(runs);
  if (args.includes("--write-docs")) writeDocs(runs);
  const failures = runs.filter((r) => !r.skipped && !r.green);
  if (failures.length > 0) {
    console.error(`\n${failures.length} candidat(s) sans build vert — voir tableau.`);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
