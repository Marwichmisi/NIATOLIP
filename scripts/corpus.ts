#!/usr/bin/env tsx
// Corpus de régression R1–R5 (issue #6, doc 08 M1-5).
// Le MÊME agent complet que /api/chat (mêmes outils projet, même system
// prompt, mêmes gates G0–G3), lancé une fois par carte contre le modèle par
// défaut — sans humain dans la boucle : H1/H2 s'auto-approuvent dans le
// harnais (generateText sans toolApproval), seuls les verdicts G0–G3 comptent.
//
// Usage :
//   npm run corpus -- --dry-run        # sans clés : valide harnais + prompts
//   npm run corpus                      # réel : R1–R5 sur le modèle par défaut
//   npm run corpus -- --only R1         # une seule carte
//   npm run corpus -- --model meta-wonder
//   npm run corpus -- --write-docs      # réel + historise dans docs/13-CORPUS-R1-R5.md
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateText, isStepCount, type ToolSet } from "ai";
import {
  estimateCost,
  getDefaultChoice,
  getModel,
  getModelCatalog,
  getProviderStatus,
  isAllowedModelId,
  META_TOOL_CHOICE,
  withMeta429Retry,
  type ModelChoice,
} from "../src/lib/models";
import { AGENT_PROMPT_VERSION, AGENT_SYSTEM_PROMPT } from "../src/lib/prompts/agent-system";
import { AgentRunState, createAgentTools } from "../src/lib/agent-run";
import { runAllGates } from "../src/lib/agent-gates";
import { evaluateFullServer } from "../src/lib/agent-gates";
import { CORPUS_CARDS, CORPUS_GREEN_THRESHOLD, type CorpusCard } from "../src/lib/corpus";
import {
  createProject,
  getProject,
  getWorkingFiles,
  listVersions,
} from "../src/lib/projects";
import { TSCIRCUIT_VERSIONS } from "../src/lib/toy-circuit";

const RESULTS_DIR = new URL("../corpus/results/", import.meta.url);
const DOC_PATH = new URL("../docs/13-CORPUS-R1-R5.md", import.meta.url);

interface CardResult {
  id: string;
  title: string;
  projectId: string;
  green: boolean;
  gates: Array<{ gate: string; status: string }>;
  gateErrors: string[];
  steps: number;
  toolCalls: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  snapshots: number;
  skipped?: string;
  error?: string;
}

function maxSteps(): number {
  const raw = Number(process.env.AGENT_MAX_STEPS ?? "50");
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 50) : 50;
}

function resolveEntrypoint(files: Record<string, string>): string {
  if (typeof files["main.tsx"] === "string") return "main.tsx";
  const first = Object.keys(files).filter((p) => p.endsWith(".tsx")).sort()[0];
  if (!first) throw new Error("Aucun fichier .tsx généré par l'agent.");
  return first;
}

async function runCard(card: CorpusCard, choice: ModelChoice): Promise<CardResult> {
  const stamp = new Date().toISOString().slice(0, 10);
  const project = await createProject(`corpus-${card.id}-${stamp}`);
  // Vérifie la création (FS sandbox parfois lent) : échec rapide et parlant
  // plutôt qu'un run fantôme si le projet n'est pas relisible.
  await getProject(project.id);
  try {
    return await runCardInner(card, choice, project.id);
  } catch (err) {
    (err as { projectId?: string }).projectId = project.id;
    throw err;
  }
}

async function runCardInner(
  card: CorpusCard,
  choice: ModelChoice,
  projectId: string
): Promise<CardResult> {
  const state = new AgentRunState();
  const tools = createAgentTools({ projectId, clientBoard: null }, state) as ToolSet;
  const started = Date.now();
  const result = await withMeta429Retry(() =>
    generateText({
      model: getModel(choice),
      instructions: AGENT_SYSTEM_PROMPT,
      prompt: card.prompt,
      tools,
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

  // Verdict faisant foi : réévaluation serveur + toutes les gates G0→G3.
  // Mesure de référence P1-1 : verdict natif pur, quarantaine ignorée
  // explicitement (pas de divergenceDir) — la référence doit rester stable
  // même si une règle est quarantinée côté agent. Les divergences éventuelles
  // sur des cartes saines sont remontées dans gateErrors (signal, pas verdict).
  const files = await getWorkingFiles(projectId);
  const entry = resolveEntrypoint(files);
  const full = await evaluateFullServer(files, entry);
  const { reports, allPass, divergences } = await runAllGates(full.summary, full.circuitJson);
  const versions = await listVersions(projectId).catch(() => []);
  const gateErrors = reports
    .flatMap((r) => r.findings.filter((f) => f.severity === "error"))
    .map((f) => `${f.gate}/${f.code}: ${f.message}`);
  for (const d of divergences) {
    gateErrors.push(`div/${d.gate}/${d.ruleCode}:${d.kind}`);
  }

  return {
    id: card.id,
    title: card.title,
    projectId,
    green: allPass,
    gates: reports.map((r) => ({ gate: r.gate, status: r.status })),
    gateErrors: gateErrors.slice(0, 10),
    steps,
    toolCalls,
    latencyMs,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    costUsd: estimateCost(choice, {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    }),
    snapshots: versions.length,
  };
}

function dryRun(): void {
  const checks: [string, boolean][] = [];
  checks.push(["5 cartes définies (R1–R5)", CORPUS_CARDS.length === 5]);
  checks.push([
    "IDs uniques R1–R5",
    new Set(CORPUS_CARDS.map((c) => c.id)).size === 5 &&
      CORPUS_CARDS.every((c, i) => c.id === `R${i + 1}`),
  ]);
  checks.push(["prompts canoniques non vides", CORPUS_CARDS.every((c) => c.prompt.length > 100)]);
  checks.push([
    "fiches de test présentes",
    CORPUS_CARDS.every((c) => c.functionalTest.length >= 3),
  ]);
  checks.push(["seuil porte de sortie = 4/5", CORPUS_GREEN_THRESHOLD === 4]);
  checks.push(["-contributor bloqué par défaut", !isAllowedModelId("muse-spark-1.3-contributor")]);
  const catalog = getModelCatalog();
  checks.push(["catalogue modèle non vide", catalog["meta-spark"].modelId.length > 0]);
  checks.push([
    "versions tscircuit épinglées",
    TSCIRCUIT_VERSIONS.tscircuit.length > 0 && TSCIRCUIT_VERSIONS.eval.length > 0,
  ]);
  checks.push(["prompt agent versionné", AGENT_PROMPT_VERSION.length > 0]);
  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (failed.length > 0) {
    console.error(`\nDRY-RUN ÉCHEC : ${failed.length} vérification(s) en échec.`);
    process.exit(1);
  }
  console.log("\nDRY-RUN OK — corpus valide (rapport réel dès MODEL_API_KEY posée).");
}

function printTable(results: CardResult[]): void {
  console.log("\n| Carte | Titre | G0–G3 | Étapes | Appels outils | Latence | In/out tokens | Coût/run | Snapshots |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    if (r.skipped) {
      console.log(`| ${r.id} | ${r.title} | — | — | — | — | — | — | — | (${r.skipped}) |`);
      continue;
    }
    const cost = Number.isNaN(r.costUsd) ? "n/a" : `$${r.costUsd.toFixed(4)}`;
    const gates = r.gates.map((g) => `${g.gate}:${g.status === "pass" ? "✅" : "❌"}`).join(" ");
    console.log(
      `| ${r.id} | ${r.title} | ${r.green ? "✅" : "❌"} ${gates} | ${r.steps} | ${r.toolCalls} | ${(r.latencyMs / 1000).toFixed(0)}s | ${r.inputTokens}/${r.outputTokens} | ${cost} | ${r.snapshots} |`
    );
    if (!r.green && r.gateErrors.length > 0) {
      console.log(`  ↳ ${r.gateErrors.slice(0, 3).join(" ; ")}`);
    }
  }
}

async function writeReport(
  results: CardResult[],
  choice: ModelChoice,
  stamp: string
): Promise<string> {
  const catalog = getModelCatalog();
  const greens = results.filter((r) => !r.skipped && r.green).length;
  const tested = results.filter((r) => !r.skipped).length;
  const pass = greens >= CORPUS_GREEN_THRESHOLD;
  const payload = {
    date: new Date().toISOString(),
    promptVersion: AGENT_PROMPT_VERSION,
    modelChoice: choice,
    modelId: catalog[choice].modelId,
    tscircuit: { ...TSCIRCUIT_VERSIONS },
    maxSteps: maxSteps(),
    threshold: `${CORPUS_GREEN_THRESHOLD}/5`,
    greens,
    tested,
    pass,
    cards: results,
  };
  await mkdir(RESULTS_DIR, { recursive: true });
  const file = join(RESULTS_DIR.pathname, `corpus-${stamp}.json`);
  await writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  return file;
}

async function writeDocs(results: CardResult[], choice: ModelChoice, stamp: string): Promise<void> {
  const catalog = getModelCatalog();
  const greens = results.filter((r) => !r.skipped && r.green).length;
  const cell = (id: string): string => {
    const r = results.find((x) => x.id === id);
    if (!r || r.skipped) return "—";
    return r.green ? "✅" : "❌";
  };
  const row =
    `| ${stamp} | ${choice} (${catalog[choice].modelId}) | ${AGENT_PROMPT_VERSION.split(" ")[0]} ` +
    `| tscircuit ${TSCIRCUIT_VERSIONS.tscircuit} | ${cell("R1")} | ${cell("R2")} | ${cell("R3")} | ${cell("R4")} | ${cell("R5")} ` +
    `| ${greens}/5 | ${greens >= CORPUS_GREEN_THRESHOLD ? "✅ porte M1" : "❌ < 4/5"} |`;
  const raw = await readFile(DOC_PATH, "utf8");
  if (!raw.includes("<!-- HISTORY-START -->")) {
    throw new Error("Marqueur <!-- HISTORY-START --> introuvable dans docs/13-CORPUS-R1-R5.md.");
  }
  await writeFile(DOC_PATH, raw.replace("<!-- HISTORY-START -->", `<!-- HISTORY-START -->\n${row}`), "utf8");
  console.log("\nHistorique mis à jour dans docs/13-CORPUS-R1-R5.md");
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--dry-run")) {
    dryRun();
    return;
  }
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : undefined;
  if (only && !CORPUS_CARDS.some((c) => c.id === only)) {
    console.error(`--only attend l'une de : ${CORPUS_CARDS.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }
  const modelIdx = args.indexOf("--model");
  const choice = (modelIdx >= 0 ? args[modelIdx + 1] : getDefaultChoice()) as ModelChoice;
  const status = getProviderStatus();
  if (!status[choice]?.configured) {
    const missing = choice === "openai-main" ? "OPENAI_API_KEY + OPENAI_MAIN_MODEL" : "MODEL_API_KEY";
    console.error(`Clé manquante pour ${choice} : posez ${missing} dans .env (voir .env.example), ou relancez avec --dry-run.`);
    process.exit(2);
  }

  const cards = only ? CORPUS_CARDS.filter((c) => c.id === only) : CORPUS_CARDS;
  const stamp = new Date().toISOString().slice(0, 10);
  console.log(
    `\n▶ Corpus R1–R5 (${cards.map((c) => c.id).join(", ")}) sur ${choice} (${getModelCatalog()[choice].modelId}), ` +
      `prompt ${AGENT_PROMPT_VERSION}, tscircuit ${TSCIRCUIT_VERSIONS.tscircuit}, max ${maxSteps()} étapes/carte.`
  );
  console.log("H1/H2 auto-approuvées dans le harnais (pas d'humain) — seuls les verdicts G0–G3 comptent.");
  const results: CardResult[] = [];
  for (const card of cards) {
    console.log(`\n▶ ${card.id} — ${card.title}…`);
    try {
      const r = await runCard(card, choice);
      console.log(`  ${r.green ? "✅ G3 vert" : "❌ échec"} — ${r.steps} étapes, ${r.toolCalls} appels, $${r.costUsd.toFixed(4)}`);
      results.push(r);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      const pid = (err as { projectId?: string }).projectId ?? "";
      console.error(`  ❌ erreur run : ${message}`);
      if (stack) console.error(stack.split("\n").slice(0, 8).join("\n"));
      results.push({
        id: card.id,
        title: card.title,
        projectId: pid,
        green: false,
        gates: [],
        gateErrors: [message],
        steps: 0,
        toolCalls: 0,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: NaN,
        snapshots: 0,
        error: message,
      });
    }
  }
  printTable(results);
  const file = await writeReport(results, choice, `${stamp}-${Date.now().toString(36)}`);
  console.log(`\nRapport JSON : ${file}`);
  if (args.includes("--write-docs")) await writeDocs(results, choice, stamp);

  const greens = results.filter((r) => !r.skipped && r.green).length;
  if (!only && greens < CORPUS_GREEN_THRESHOLD) {
    console.error(`\nPorte de sortie M1 non atteinte : ${greens}/5 G3 verts (< ${CORPUS_GREEN_THRESHOLD}/5).`);
    process.exit(3);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
