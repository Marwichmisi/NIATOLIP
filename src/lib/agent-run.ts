// Session d'un run agent lié à un projet (issue #4).
// Serveur uniquement. Les outils lisent/écrivent DIRECTEMENT la copie de
// travail du projet (choix utilisateur) : la preview client se met à jour
// en direct et un crash ne perd rien. Snapshot auto à chaque gate verte.
//
// Garde-fous (doc 03 §6) appliqués ici :
// - 50 étapes : stopWhen dans la route (isStepCount) ;
// - 2 échecs identiques → consigne de changement de stratégie dans le résultat ;
// - écritures fichiers sérialisées (jamais deux en parallèle).

import { tool, type ToolSet } from "ai";
import { createHash } from "node:crypto";
import { mkdir, readFile as readFsFile, writeFile as writeFsFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  createVersion,
  getAssemblyMode,
  getVersionFiles,
  getWorkingFiles,
  putWorkingFiles,
} from "./projects";
import { staticEvaluateCircuit } from "./toy-agent";
import {
  evaluateFullServer,
  runAllGates,
  type CircuitElement,
  type CircuitSummary,
  type GateReport,
} from "./agent-gates";
import { TSCIRCUIT_VERSIONS } from "./toy-circuit";
import {
  createValidationJob,
  getValidationJob,
  isJobGreenForExport,
  summarizeJobForAgent,
} from "./validation";
import { hasValidH2, recordApproval } from "./approvals";
import { assertSequenceForValidation, resolveEntrypoint } from "./sequence";
import {
  getComponentDetails,
  searchComponents,
  searchComponentsSchema,
} from "./jlc";
import { getTemplate, listTemplateMeta } from "./templates";

if (typeof window !== "undefined") {
  throw new Error("src/lib/agent-run.ts est serveur uniquement.");
}

/** État client rapporté à chaque run (onglet Validation du navigateur). */
export interface ClientBoardState {
  components?: number;
  traces?: number;
  errors?: string[];
  evaluatedAt?: string;
}

export interface AgentRunContext {
  projectId: string;
  clientBoard: ClientBoardState | null;
}

/** État mutable d'un run : traçabilité, cache éval, séries d'échecs. */
export class AgentRunState {
  /** LCSC issus d'un searchComponents du run → garantit la traçabilité. */
  searchedLcsc = new Map<string, { category: string; at: string }>();
  searchLog: Array<{ category: string; filters: string; count: number }> = [];
  lastEval: { hash: string; summary: CircuitSummary; json: CircuitElement[] } | null = null;
  snapshottedHashes = new Set<string>();
  snapshots: string[] = [];
  private failStreak = { key: "", count: 0 };

  /** Consigne anti-boucle : après 2 échecs identiques, changer de stratégie. */
  noteFailure(key: string): string {
    if (this.failStreak.key === key) this.failStreak.count++;
    else this.failStreak = { key, count: 1 };
    if (this.failStreak.count >= 2) {
      return (
        " ⚠ 2 échecs consécutifs sur la même erreur : CHANGE DE STRATÉGIE " +
        "(autre composant, autre placement, simplification) ou demande à l'utilisateur — " +
        "ne répète pas la même correction (doc 03 §1.4)."
      );
    }
    return "";
  }

  noteSuccess(): void {
    this.failStreak = { key: "", count: 0 };
  }
}

// ---------- Mutex d'écriture (sérialise read-merge-write) ----------

function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
}

// ---------- Validation des chemins (doc 03 §3.1) ----------

const ALLOWED_EXT = [".tsx", ".ts", ".json", ".md"];
const MAX_TOOL_CONTENT = 100_000;
// Fichier réservé : traçabilité des recherches JLCPCB du projet (doc 03 §3.2).
// Persisté dans la copie de travail, invisible au modèle (hors listFiles,
// hors hash d'éval) pour survivre aux runs, reprises et restarts.
const SEARCH_LOG_PATH = ".agent-searches.json";

function validatePath(path: string): void {
  if (typeof path === "string" && (path === SEARCH_LOG_PATH || path.startsWith("."))) {
    throw new Error(`Chemin réservé : "${path}".`);
  }
  if (typeof path !== "string" || path.length === 0 || path.length > 120) {
    throw new Error(`Chemin invalide : "${path}".`);
  }
  if (path.includes("..") || path.startsWith("/") || !/^[A-Za-z0-9._/-]+$/.test(path)) {
    throw new Error(`Chemin hors projet : "${path}".`);
  }
  if (!ALLOWED_EXT.some((ext) => path.endsWith(ext))) {
    throw new Error(`Extension non autorisée : "${path}" (autorisé : ${ALLOWED_EXT.join(", ")}).`);
  }
}

// resolveEntrypoint partagé : voir src/lib/sequence.ts (P0-3).

// Hash fort du contenu (clé du cache disque) — best-effort, jamais bloquant.
// Le cache vit dans PROJECTS_DIR/.cache (éphémère en conteneur : volatil au
// redéploiement, persistant en dev — le L1 mémoire couvre le run courant).
function evalCacheDir(): string {
  return join(process.env.PROJECTS_DIR ?? join(process.cwd(), "projects"), ".cache", "eval");
}

// Quarantaine/divergences (doc 12 §6) : globale par déploiement, pas par
// projet — le comportement d'une règle native dépend de la version des
// checks, pas du projet qui la déclenche. Best-effort et volatil comme le
// cache d'éval (survit tant que le volume PROJECTS_DIR survit) : après un
// redéploiement l'historique repart de zéro, sans effacer les règles déjà
// corrigées dans le code. Voir doc 05.
function evalGatesDir(): string {
  return join(process.env.PROJECTS_DIR ?? join(process.cwd(), "projects"), ".cache", "gates");
}

function hashFiles(files: Record<string, string>, entrypoint: string): string {
  const h = createHash("sha256");
  // P0-4 : la clé inclut les versions tscircuit/checks — un changement de
  // version invalide les verdicts (doc 12 §5, 0.0.x cassants).
  h.update(`entry:${entrypoint}\n`);
  h.update(`tscircuit:${TSCIRCUIT_VERSIONS.tscircuit}|core:${TSCIRCUIT_VERSIONS.core}|eval:${TSCIRCUIT_VERSIONS.eval}|checks:${TSCIRCUIT_VERSIONS.checks}\n`);
  for (const k of Object.keys(files).sort()) {
    if (k.startsWith(".")) continue; // fichiers réservés hors contenu circuit
    h.update(`--- ${k} ---\n`);
    h.update(files[k]);
    h.update("\n");
  }
  return h.digest("hex").slice(0, 32);
}

async function evalDiskGet(
  hash: string
): Promise<{ summary: CircuitSummary; json: CircuitElement[] } | null> {
  try {
    const raw = await readFsFile(join(evalCacheDir(), `${hash}.json`), "utf8");
    if (raw.length > 2_000_000) return null;
    const parsed = JSON.parse(raw) as { summary: CircuitSummary; json: CircuitElement[] };
    if (!parsed || typeof parsed.summary !== "object" || !Array.isArray(parsed.json)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function evalDiskSet(
  hash: string,
  data: { summary: CircuitSummary; json: CircuitElement[] }
): Promise<void> {
  try {
    const raw = JSON.stringify(data);
    if (raw.length > 2_000_000) return;
    await mkdir(evalCacheDir(), { recursive: true });
    await writeFsFile(join(evalCacheDir(), `${hash}.json`), raw, "utf8");
    // P0-4 : purge passive du vieux cache (best-effort, jamais bloquante) —
    // l'invalidation de version est assurée par le hash, mais on évite
    // l'accumulation : cap à 500 fichiers, TTL 30 jours.
    try {
      const { readdir, stat, unlink } = await import("node:fs/promises");
      const files = (await readdir(evalCacheDir())).filter((f) => f.endsWith(".json")).sort();
      const now = Date.now();
      for (const f of files) {
        try {
          const st = await stat(join(evalCacheDir(), f));
          if (now - st.mtimeMs > 30 * 24 * 3600 * 1000) await unlink(join(evalCacheDir(), f));
        } catch { /* best-effort */ }
      }
      const rest = (await readdir(evalCacheDir())).filter((f) => f.endsWith(".json")).sort();
      for (const f of rest.slice(0, Math.max(0, rest.length - 500))) {
        try { await unlink(join(evalCacheDir(), f)); } catch { /* best-effort */ }
      }
    } catch {
      // Purge best-effort : jamais bloquante.
    }
  } catch {
    // Cache best-effort : jamais bloquant.
  }
}

const pathSchema = z.string().min(1).max(120).describe("Chemin dans le projet (ex. main.tsx).");

// ---------- Fabrique d'outils ----------

export function createAgentTools(ctx: AgentRunContext, state: AgentRunState): ToolSet {
  const writeMutex = createMutex();

  async function readAll(): Promise<Record<string, string>> {
    return getWorkingFiles(ctx.projectId);
  }

  // Traçabilité projet (et non run) : les LCSC cherchés survivent aux
  // reprises d'itération, aux approbations H1/H2 (nouveau run serveur) et
  // aux restarts. Sans ça, getCircuitSummary crierait « untraced » au run 2.
  let searchesLoaded = false;
  async function ensureSearches(): Promise<void> {
    if (searchesLoaded) return;
    searchesLoaded = true;
    try {
      const files = await readAll();
      const raw = files[SEARCH_LOG_PATH];
      if (typeof raw !== "string") return;
      const list = JSON.parse(raw) as Array<{ lcsc?: unknown; category?: unknown; at?: unknown }>;
      if (!Array.isArray(list)) return;
      for (const r of list.slice(-500)) {
        if (typeof r.lcsc === "string" && !state.searchedLcsc.has(r.lcsc)) {
          state.searchedLcsc.set(r.lcsc, {
            category: typeof r.category === "string" ? r.category : "?",
            at: typeof r.at === "string" ? r.at : "?",
          });
        }
      }
    } catch {
      // Log illisible : on repart du run courant (jamais bloquant).
    }
  }

  async function recordSearches(rows: Array<{ lcsc: string; category: string }>): Promise<void> {
    try {
      const files = await readAll();
      let list: Array<{ lcsc: string; category: string; at: string }> = [];
      try {
        const parsed: unknown = JSON.parse(files[SEARCH_LOG_PATH] ?? "[]");
        if (Array.isArray(parsed)) list = parsed as typeof list;
      } catch {
        list = [];
      }
      const at = new Date().toISOString();
      for (const r of rows) {
        if (!list.some((e) => e.lcsc === r.lcsc)) list.push({ ...r, at });
      }
      await putWorkingFiles(ctx.projectId, { ...files, [SEARCH_LOG_PATH]: JSON.stringify(list.slice(-500)) });
    } catch {
      // Persistance best-effort : la traçabilité mémoire du run reste valide.
    }
  }

  async function ensureFull(
    files: Record<string, string>,
    entrypoint: string
  ): Promise<{ summary: CircuitSummary; json: CircuitElement[]; fresh: boolean }> {
    const hash = hashFiles(files, entrypoint);
    if (state.lastEval && state.lastEval.hash === hash) {
      return { summary: state.lastEval.summary, json: state.lastEval.json, fresh: false };
    }
    // Cache disque inter-runs (mêmes fichiers → même verdict, sans réévaluation).
    const disk = await evalDiskGet(hash);
    if (disk) {
      state.lastEval = { hash, summary: disk.summary, json: disk.json };
      return { summary: disk.summary, json: disk.json, fresh: false };
    }
    const full = await evaluateFullServer(files, entrypoint);
    state.lastEval = { hash, summary: full.summary, json: full.circuitJson };
    await evalDiskSet(hash, { summary: full.summary, json: full.circuitJson });
    return { summary: full.summary, json: full.circuitJson, fresh: true };
  }

  return {
    // ----- Fichiers -----
    listFiles: tool({
      description: "Liste les fichiers du projet (chemins + tailles).",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        return {
          files: Object.entries(files)
            .filter(([p]) => !p.startsWith("."))
            .map(([path, content]) => ({ path, bytes: content.length })),
        };
      },
    }),

    readFile: tool({
      description: "Lit un fichier (tronqué à 8000 caractères). Ne relire que si nécessaire.",
      inputSchema: z.object({ path: pathSchema }),
      execute: async ({ path }) => {
        validatePath(path);
        const files = await readAll();
        const content = files[path];
        if (typeof content !== "string") throw new Error(`Fichier introuvable : ${path}.`);
        const truncated = content.length > 8000;
        return { path, content: truncated ? content.slice(0, 8000) + "\n…[tronqué]" : content, truncated };
      },
    }),

    writeFile: tool({
      description:
        "Écrit un fichier complet (persiste dans le projet, preview live). Préférer patchFile pour les corrections locales.",
      inputSchema: z.object({
        path: pathSchema,
        content: z.string().min(1).max(MAX_TOOL_CONTENT).describe("Contenu complet du fichier."),
      }),
      execute: async ({ path, content }) =>
        writeMutex(async () => {
          validatePath(path);
          const files = await readAll();
          await putWorkingFiles(ctx.projectId, { ...files, [path]: content });
          return { ok: true, path, bytes: content.length };
        }),
    }),

    patchFile: tool({
      description: "Corrige un fichier (1 seule occurrence de oldString requise). Préféré à writeFile.",
      inputSchema: z.object({
        path: pathSchema,
        oldString: z.string().min(1).max(20_000),
        newString: z.string().min(1).max(MAX_TOOL_CONTENT),
      }),
      execute: async ({ path, oldString, newString }) =>
        writeMutex(async () => {
          validatePath(path);
          if (oldString === newString) throw new Error("oldString et newString identiques.");
          const files = await readAll();
          const content = files[path];
          if (typeof content !== "string") throw new Error(`Fichier introuvable : ${path}.`);
          const occurrences = content.split(oldString).length - 1;
          if (occurrences === 0) throw new Error(`patchFile : oldString introuvable dans ${path}.`);
          if (occurrences > 1) {
            throw new Error(`patchFile : ${occurrences} occurrences dans ${path} — préciser oldString.`);
          }
          await putWorkingFiles(ctx.projectId, { ...files, [path]: content.replace(oldString, newString) });
          return { ok: true, path };
        }),
    }),

    // ----- Composants réels -----
    searchComponents: tool({
      description:
        "OBLIGATOIRE avant tout choix de composant principal : recherche réelle JLCPCB (stock, prix, Basic/Preferred).",
      inputSchema: searchComponentsSchema,
      execute: async (input) => {
        await ensureSearches();
        const result = await searchComponents(input);
        const fresh: Array<{ lcsc: string; category: string }> = [];
        for (const c of result.candidates) {
          if (!state.searchedLcsc.has(c.lcscId)) {
            state.searchedLcsc.set(c.lcscId, { category: input.category, at: new Date().toISOString() });
            fresh.push({ lcsc: c.lcscId, category: input.category });
          }
        }
        if (fresh.length > 0) await recordSearches(fresh);
        state.searchLog.push({
          category: input.category,
          filters: JSON.stringify(input.filters ?? {}),
          count: result.candidates.length,
        });
        return {
          ...result,
          reminder: "Citer le lcscId choisi dans parts.json ({ ref, lcsc, mpn, role }).",
        };
      },
    }),

    getComponentDetails: tool({
      description: "Détails d'une pièce LCSC : footprint tscircuit vérifié + résumé borné.",
      inputSchema: z.object({
        lcscId: z.string().min(4).max(12).describe("LCSC avec ou sans préfixe C (ex. C123456)."),
      }),
      execute: async ({ lcscId }) => getComponentDetails(lcscId),
    }),

    // ----- Templates vérifiés T1–T3 (issue #8, FR-14) -----
    listTemplates: tool({
      description:
        "Catalogue des templates en-validation/vérifiés (T1 ESP32-C3, T2 RP2040, T3 breakout I2C) : contenu, BOM présourcée, limites. À consulter quand la demande correspond à un template au lieu de partir de zéro.",
      inputSchema: z.object({}),
      execute: async () => ({
        templates: listTemplateMeta().map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          board: t.board,
          matches: t.matches,
          bomCount: t.bomCount,
          limits: t.limits,
        })),
        note: "applyTemplate écrit main.tsx + parts.json ; LCSC présourcés (vérifiés le 2026-10-30) — stock/prix à revérifier (searchComponents) avant H2/export.",
      }),
    }),

    applyTemplate: tool({
      description:
        "Amorce le projet depuis un template (T1/T2/T3) : écrit main.tsx + parts.json. Puis adapter (dimensions, composants) et évaluer G0–G3. Ne jamais repartir de zéro quand un template correspond.",
      inputSchema: z.object({
        templateId: z.enum(["T1", "T2", "T3"]).describe("Template à appliquer."),
      }),
      execute: async ({ templateId }) =>
        writeMutex(async () => {
          const t = getTemplate(templateId);
          if (!t) throw new Error(`Template inconnu : ${templateId}.`);
          await ensureSearches();
          const files = await readAll();
          await putWorkingFiles(ctx.projectId, {
            ...files,
            "main.tsx": t.files["main.tsx"],
            "parts.json": t.files["parts.json"],
          });
          // Traçabilité : LCSC présourcés (vérifiés jlcsearch le 2026-10-30,
          // `npm run templates:check` G0–G3 verts) — le stock reste à
          // revérifier dans ce run avant H2 (G5 le recontrôle à l'export).
          const at = new Date().toISOString();
          const fresh: Array<{ lcsc: string; category: string }> = [];
          for (const row of t.bom) {
            if (!state.searchedLcsc.has(row.lcsc)) {
              state.searchedLcsc.set(row.lcsc, { category: `template:${t.id}`, at });
              fresh.push({ lcsc: row.lcsc, category: `template:${t.id}` });
            }
          }
          if (fresh.length > 0) await recordSearches(fresh);
          return {
            ok: true,
            templateId: t.id,
            title: t.title,
            status: t.status,
            files: ["main.tsx", "parts.json"],
            limits: t.limits,
            next: "Adapter au besoin, évaluer (evaluateCircuit → G0–G3), revérifier stock/prix (searchComponents) avant H2.",
          };
        }),
    }),

    // ----- Évaluation et checks -----
    evaluateCircuit: tool({
      description:
        "Évalue le circuit : filtre statique rapide puis vrai tscircuit serveur (G0). Snapshot auto si G0–G3 verts. À appeler après chaque écriture.",
      inputSchema: z.object({
        entrypoint: z.string().min(1).max(120).optional().describe("Défaut : main.tsx."),
      }),
      execute: async ({ entrypoint }) => {
        const files = await readAll();
        const entry = entrypoint ?? resolveEntrypoint(files);
        const fast = staticEvaluateCircuit(files, entry);
        if (!fast.ok) {
          const suffix = state.noteFailure(`G0-fast:${fast.errors[0]?.code ?? "?"}`);
          return { level: "fast", ok: false, errors: fast.errors, hint: "Corriger avant l'évaluation complète." + suffix };
        }
        let full: { summary: CircuitSummary; json: CircuitElement[] };
        try {
          full = await ensureFull(files, entry);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const suffix = state.noteFailure(`G0-full:exception`);
          return { level: "full", ok: false, errors: [{ kind: "exception", code: "exception", message }], hint: suffix };
        }
        const hash = hashFiles(files, entry);
        const { reports, allPass, quarantinedRules } = await runAllGates(full.summary, full.json, {
          hash,
          divergenceDir: evalGatesDir(),
        });
        let snapshot: string | null = null;
        if (allPass && !state.snapshottedHashes.has(hash)) {
          const quarantineNote =
            quarantinedRules.length > 0 ? ` — quarantaine: ${quarantinedRules.join(", ")}` : "";
          const v = await createVersion(ctx.projectId, `G0–G3 verts (agent)${quarantineNote}`);
          state.snapshottedHashes.add(hash);
          state.snapshots.push(`v${v.version_no}`);
          snapshot = `v${v.version_no}`;
        }
        if (allPass) state.noteSuccess();
        else {
          const firstFail = reports.find((r) => r.status === "fail");
          const suffix = firstFail ? state.noteFailure(`${firstFail.gate}:${firstFail.findings[0]?.code ?? "?"}`) : "";
          return {
            level: "full",
            ok: false,
            gates: reports.map(reportOf),
            quarantined: quarantinedRules,
            hint: "Corriger la première gate rouge (ordre G0→G3). Les gates « non jugée » sont bloquées par une gate antérieure rouge : ne pas les « corriger »." + suffix,
          };
        }
        return {
          level: "full",
          ok: true,
          gates: reports.map(reportOf),
          quarantined: quarantinedRules,
          snapshot,
        };
      },
    }),

    checkNetlist: tool({
      description: "Gate G1 : netlist native (runAllNetlistChecks + runAllPinSpecificationChecks). Bloquée si G0 rouge.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const entry = resolveEntrypoint(files);
        const { summary, json } = await ensureFull(files, entry);
        const { reports } = await runAllGates(summary, json, {
          hash: hashFiles(files, entry),
          divergenceDir: evalGatesDir(),
        });
        return reportOf(reports[1]);
      },
    }),

    checkPlacement: tool({
      description: "Gate G2 : placement natif (runAllPlacementChecks). Bloquée si G0/G1 rouges. À passer AVANT tout routage.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const entry = resolveEntrypoint(files);
        const { summary, json } = await ensureFull(files, entry);
        const { reports } = await runAllGates(summary, json, {
          hash: hashFiles(files, entry),
          divergenceDir: evalGatesDir(),
        });
        return reportOf(reports[2]);
      },
    }),

    checkRouting: tool({
      description: "Gate G3 : routage natif (runAllRoutingChecks). Bloquée si G0/G1/G2 rouges.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const entry = resolveEntrypoint(files);
        const { summary, json } = await ensureFull(files, entry);
        const { reports } = await runAllGates(summary, json, {
          hash: hashFiles(files, entry),
          divergenceDir: evalGatesDir(),
        });
        return reportOf(reports[3]);
      },
    }),

    getCircuitSummary: tool({
      description: "Netlist lisible compacte + traçabilité sourcing (parts.json vs recherches du run). Jamais de JSON brut.",
      inputSchema: z.object({}),
      execute: async () => {
        await ensureSearches();
        const files = await readAll();
        const { summary, json } = await ensureFull(files, resolveEntrypoint(files));
        const lines: string[] = [];
        for (const t of json.filter((e) => e.type === "source_trace")) {
          lines.push(`- ${(t.display_name as string) ?? t.source_trace_id}`);
        }
        const comps = json
          .filter((e) => e.type === "source_component")
          .map((e) => `${(e.name as string) ?? "?"} (${(e.ftype as string) ?? "?"})`);
        let parts: Array<{ ref?: string; lcsc?: string; mpn?: string; role?: string }> = [];
        try {
          if (typeof files["parts.json"] === "string") {
            const parsed: unknown = JSON.parse(files["parts.json"]);
            if (Array.isArray(parsed)) parts = parsed as typeof parts;
          }
        } catch {
          parts = [];
        }
        const untraced = parts
          .map((p) => p.lcsc)
          .filter((l): l is string => typeof l === "string" && !state.searchedLcsc.has(normalizeLcsc(l)));
        return {
          components: comps.slice(0, 40),
          nets: lines.slice(0, 40),
          counts: { components: summary.components, traces: summary.traces, errors: summary.errors.length },
          sourcing: {
            declared: parts.length,
            traced: parts.length - untraced.length,
            untraced,
            verdict:
              untraced.length > 0
                ? `BLOQUANT : ${untraced.join(", ")} sans searchComponents dans ce run — chercher ou retirer (doc 04 règle 1).`
                : "OK : chaque LCSC déclaré est traçable à une recherche du run.",
          },
        };
      },
    }),

    // ----- Gates humaines H1/H2 + export (doc 03 §3.5, doc 06 §2.2) -----
    // Exécution suspendue jusqu'à décision explicite via `toolApproval`
    // (route chat) : aucun clic = aucun passage de gate. Le refus renvoie
    // un output-denied — le modèle demande alors quoi modifier.

    requestPlanApproval: tool({
      description:
        "GATE H1 — OBLIGATOIRE avant toute génération : présente le plan (architecture, composants pressentis avec LCSC si déjà sourcés, dimensions, couches, estimation de coût) et SUSPEND le run jusqu'à l'approbation explicite de l'utilisateur. Ne jamais générer avant son retour.",
      inputSchema: z.object({
        title: z.string().min(1).max(120).describe("Titre du plan."),
        objective: z.string().min(1).max(1000).describe("Ce qui va être construit, en une phrase."),
        components: z
          .array(
            z.object({
              ref: z.string().max(20).describe("Repère (U1, R3…)."),
              value: z.string().max(80).describe("Valeur ou fonction."),
              lcsc: z.string().max(12).optional().describe("LCSC si déjà sourcé, sinon absent."),
              mpn: z.string().max(80).optional(),
              role: z.string().max(120).optional().describe("Rôle dans le circuit."),
            })
          )
          .max(30)
          .default([]),
        board: z
          .object({
            widthMm: z.number().positive().max(500),
            depthMm: z.number().positive().max(500),
            layers: z.number().int().min(1).max(4),
          })
          .optional()
          .describe("Dimensions et couches."),
        costEstimateUsd: z.number().nonnegative().max(10000).optional().describe("Estimation composants en USD."),
        notes: z.string().max(1000).optional().describe("Points à valider humainement."),
      }),
      execute: async (input) => {
        // Preuve serveur H1 (même mécanisme que H2 — l'exécution ne tourne
        // que sur approbation explicite).
        await recordApproval(ctx.projectId, {
          gate: "H1",
          approved: true,
          reason: typeof input.title === "string" ? input.title.slice(0, 500) : null,
        });
        return {
          approved: true,
          at: new Date().toISOString(),
          plan: input.title,
          next: "Plan approuvé — génère : sourcing, code, évaluation G0–G3. SI l'approbation contenait des modifications (consigne / plan corrigé), APPLIQUE-LES D'ABORD : le contenu corrigé remplace ta proposition (dimensions, composants, valeurs) — ne redemande jamais.",
        };
      },
    }),

    requestFinalApproval: tool({
      description:
        "GATE H2 — OBLIGATOIRE avant export : présente la revue finale (BOM chiffrée avec LCSC/stock/prix issus de searchComponents, état des gates G0–G3, limites) et SUSPEND le run jusqu'à l'approbation explicite. N'appeler qu'à gates G0–G3 vertes et job G4/G5-PCB vert (passer jobId quand disponible — lie la revue au rapport ERC/DRC exact).",
      inputSchema: z.object({
        summary: z.string().min(1).max(1000).describe("Ce qui a été construit, en une phrase."),
        bom: z
          .array(
            z.object({
              ref: z.string().max(20),
              value: z.string().max(80),
              pkg: z.string().max(30).optional().describe("Boîtier."),
              lcsc: z.string().max(12),
              stock: z.number().int().nonnegative().nullable().optional().describe("Stock JLCPCB (null = inconnu)."),
              price: z.number().nonnegative().nullable().optional().describe("Prix unitaire USD."),
            })
          )
          .max(100),
        gates: z
          .array(z.object({ gate: z.string().max(4), status: z.string().max(12), note: z.string().max(200).optional() }))
          .max(8)
          .describe("État G0–G3 (vertes exigées)."),
        limits: z.array(z.string().max(300)).max(10).default([]).describe("Limites et points à vérifier humainement."),
        jobId: z.string().min(1).max(64).optional().describe("Job G4/G5-PCB vert revu (recommandé — lie H2 au rapport exact)."),
      }),
      execute: async (input) => {
        // P0-3 : l'exécution ne tourne que sur approbation explicite
        // (toolApproval user-approval) — l'enregistrement est la preuve serveur.
        await recordApproval(ctx.projectId, {
          gate: "H2",
          approved: true,
          jobId: input.jobId ?? null,
          reason: typeof input.summary === "string" ? input.summary.slice(0, 500) : null,
        });
        return {
          approved: true,
          at: new Date().toISOString(),
          items: input.bom.length,
          next: "Revue approuvée — appeler exportManufacturingPack avec le même jobId. SI l'approbation contenait des modifications (consigne / revue corrigée), APPLIQUE-LES D'ABORD (corriger code/BOM, réévaluer G0–G3) avant exportManufacturingPack — ne redemande jamais.",
        };
      },
    }),

    exportPack: tool({
      description:
        "EXPORT NON VALIDÉ (M1) — archive des sources + BOM de travail, SANS Gerber ni DRC KiCad. Après requestFinalApproval approuvée uniquement. Le pack fabrication VALIDÉ (G4+G5-PCB) passe par exportManufacturingPack. L'utilisateur approuve explicitement le téléchargement.",
      inputSchema: z.object({
        note: z.string().max(200).optional().describe("Note d'export."),
      }),
      execute: async ({ note }) => {
        const v = await createVersion(ctx.projectId, `Export M1${note ? ` — ${note}` : ""}`);
        return {
          ok: true,
          snapshot: `v${v.version_no}`,
          download: `/api/projects/${ctx.projectId}/export`,
          note: "M1 : archive des sources (NON VALIDÉE — Gerber/DRC au M2, worker KiCad).",
        };
      },
    }),

    requestManufacturingValidation: tool({
      description:
        "FABRICATION G4/G5-PCB/G5-PCBA — le serveur RÉÉVALUE G0–G3 avant de figer la version puis lance un job worker KiCad (export KiCad + kicad-cli ERC/DRC + Gerber/BOM/PnP officiel + specs JLCPCB). N'appeler qu'à gates G0–G3 vertes. Le job est ASYNCHRONE : relever le jobId puis interroger getValidationResult.",
      inputSchema: z.object({
        label: z.string().max(120).optional().describe("Libellé de la version figée."),
      }),
      execute: async ({ label }) => {
        // P0-3 : recalcul serveur, aucun champ g0g3 déclaré. Rouge → throw, rien figé.
        const working = await getWorkingFiles(ctx.projectId);
        const snapshot = await assertSequenceForValidation(working);
        const v = await createVersion(ctx.projectId, label ?? "validation KiCad (agent)");
        const { files } = await getVersionFiles(ctx.projectId, v.id);
        const job = await createValidationJob(ctx.projectId, files, {
          versionId: v.id,
          versionNo: v.version_no,
          label: label ?? "validation KiCad (agent)",
          g0g3: snapshot,
        });
        const sourcingNote =
          snapshot.sourcing.untraced.length > 0
            ? ` Traçabilité : ${snapshot.sourcing.verdict}`
            : "";
        return {
          ok: true,
          jobId: job.id,
          snapshot: `v${v.version_no}`,
          status: job.status,
          next: "Job queued — interrogez getValidationResult(jobId) jusqu'à done (worker Docker requis : `docker compose up --build`)." + sourcingNote,
        };
      },
    }),

    getValidationResult: tool({
      description:
        "Résultat du job worker (G4 ERC/DRC, G5-PCB/G5-PCBA) : rapport structuré borné (20 findings max par gate). Si queued/running, attendre puis relancer — ne jamais inventer un verdict. Si G4 ou G5-PCB rouge, corriger le code et relancer requestManufacturingValidation.",
      inputSchema: z.object({
        jobId: z.string().min(1).max(64).describe("Job rendu par requestManufacturingValidation."),
      }),
      execute: async ({ jobId }) => {
        const job = await getValidationJob(jobId);
        if (job.projectId !== ctx.projectId) {
          throw new Error("Ce job appartient à un autre projet.");
        }
        return summarizeJobForAgent(job);
      },
    }),

    exportManufacturingPack: tool({
      description:
        "EXPORT VALIDÉ (M2) — pack fabrication (gerber.zip, bom.csv, pnp.csv, project-kicad.zip, sources.zip, validation-report.md). EXIGE : job done avec G4+G5-PCB verts + requestFinalApproval (H2) approuvée. G5-PCBA souple : vert avec avertissements possibles (stock inconnu, footprint non vérifié, rotations PnP) — lire validation-report.md avant commande. L'utilisateur approuve explicitement le téléchargement.",
      inputSchema: z.object({
        jobId: z.string().min(1).max(64).describe("Job G4+G5-PCB vert."),
        note: z.string().max(200).optional().describe("Note d'export."),
      }),
      execute: async ({ jobId }) => {
        const job = await getValidationJob(jobId);
        if (job.projectId !== ctx.projectId) {
          throw new Error("Ce job appartient à un autre projet.");
        }
        if (!isJobGreenForExport(job)) {
          const g5pcb = job.g5_pcb ?? job.g5;
          const g5pcba = job.g5_pcba ?? job.g5;
          const detail =
            job.status !== "done"
              ? `job ${job.status} — attendez le worker (getValidationResult)`
              : `G4:${job.g4?.status ?? "?"} G5-PCB:${g5pcb?.status ?? "?"} G5-PCBA:${g5pcba?.status ?? "?"} — corrigez puis relancez`;
          throw new Error(`Pack validé refusé : ${detail}.`);
        }
        // P0-3 : H2 vérifiée côté serveur (approbation postérieure au rapport).
        const h2 = await hasValidH2(ctx.projectId, { id: job.id, finished_at: job.finished_at });
        if (!h2.ok) {
          throw new Error(
            "Pack validé refusé : H2 non approuvée pour ce job (code h2_missing). " +
              "Présentez requestFinalApproval avec jobId puis faites approuver avant exportManufacturingPack."
          );
        }
        const g5pcb = job.g5_pcb ?? job.g5;
        const g5pcba = job.g5_pcba ?? job.g5;
        const v = await createVersion(ctx.projectId, `Export fab validé (job ${jobId.slice(0, 8)})`);
        const pcbaWarnings = (g5pcba?.findings ?? []).filter((f) => f.severity === "warning").slice(0, 10).map((f) => `${f.code}: ${f.message}`);
        // R2 : mode surfacé (enforcement complet en #20).
        const assemblyMode = await getAssemblyMode(ctx.projectId);
        return {
          ok: true,
          jobId: job.id,
          snapshot: `v${v.version_no}`,
          versionNo: job.versionNo,
          kicadVersion: job.kicadVersion,
          assemblyMode,
          g5_pcb: g5pcb?.status ?? null,
          g5_pcba: g5pcba?.status ?? null,
          pcbaWarnings,
          downloads: (job.artifacts ?? []).map((a) => ({ kind: a.kind, filename: a.filename, bytes: a.bytes, url: a.url })),
          report: (job.artifacts ?? []).find((a) => a.kind === "report")?.url ?? null,
          note: "Pack validé G4+G5-PCB + H2 — versions d'outils citées dans validation-report.md. G5-PCBA souple : avertissements à lire avant commande.",
        };
      },
    }),

    snapshotBoard: tool({
      description: "État visuel de la carte : reprend le dernier état rapporté par le navigateur (preview live).",
      inputSchema: z.object({
        view: z.enum(["pcb", "schematic"]).optional().describe("Vue demandée (indicatif au M1)."),
      }),
      execute: async () => {
        if (!ctx.clientBoard) {
          return {
            available: false,
            note: "Aucun état navigateur transmis avec ce run ; utiliser evaluateCircuit (serveur) + onglet Validation du client.",
          };
        }
        return { available: true, ...ctx.clientBoard };
      },
    }),

    reportOutOfScope: tool({
      description: "À appeler quand la demande sort du périmètre (BGA, DDR, RF, USB3/PCIe, secteur, médical/auto) : explique et propose l'alternative la plus proche.",
      inputSchema: z.object({
        reason: z.string().min(1).max(500).describe("Pourquoi c'est hors périmètre (D8)."),
        alternative: z.string().min(1).max(500).describe("Alternative la plus proche dans le périmètre."),
      }),
      execute: async ({ reason, alternative }) => ({
        ok: true,
        message: `Hors périmètre : ${reason} Alternative proposée : ${alternative}`,
      }),
    }),
  } satisfies ToolSet;
}

function normalizeLcsc(l: string): string {
  const m = /^C?(\d+)$/i.exec(l.trim());
  return m ? `C${m[1]}` : l;
}

function reportOf(r: GateReport): GateReport {
  return {
    gate: r.gate,
    status: r.status,
    findings: r.findings.slice(0, 20),
    stats: r.stats,
    ...(typeof r.judged === "boolean" ? { judged: r.judged } : {}),
    ...(typeof r.blocked === "string" ? { blocked: r.blocked } : {}),
  };
}
