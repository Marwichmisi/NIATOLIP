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
  getWorkingFiles,
  putWorkingFiles,
} from "./projects";
import { staticEvaluateCircuit } from "./toy-agent";
import {
  checkG0,
  evaluateFullServer,
  runAllGates,
  type CircuitElement,
  type CircuitSummary,
  type GateReport,
} from "./agent-gates";
import {
  getComponentDetails,
  searchComponents,
  searchComponentsSchema,
} from "./jlc";

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

function resolveEntrypoint(files: Record<string, string>): string {
  if (typeof files["main.tsx"] === "string") return "main.tsx";
  if (typeof files["index.tsx"] === "string") return "index.tsx";
  const first = Object.keys(files).filter((p) => p.endsWith(".tsx")).sort()[0];
  if (!first) throw new Error("Aucun fichier .tsx dans le projet.");
  return first;
}

// Hash fort du contenu (clé du cache disque) — best-effort, jamais bloquant.
// Le cache vit dans PROJECTS_DIR/.cache (éphémère en conteneur : volatil au
// redéploiement, persistant en dev — le L1 mémoire couvre le run courant).
function evalCacheDir(): string {
  return join(process.env.PROJECTS_DIR ?? join(process.cwd(), "projects"), ".cache", "eval");
}

function hashFiles(files: Record<string, string>, entrypoint: string): string {
  const h = createHash("sha256");
  h.update(`entry:${entrypoint}\n`);
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
        const { reports, allPass } = runAllGates(full.summary, full.json);
        const hash = hashFiles(files, entry);
        let snapshot: string | null = null;
        if (allPass && !state.snapshottedHashes.has(hash)) {
          const v = await createVersion(ctx.projectId, "G0–G3 verts (agent)");
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
            gates: reports.map((r) => ({
              gate: r.gate,
              status: r.status,
              findings: r.findings,
              stats: r.stats,
            })),
            hint: "Corriger la première gate rouge (ordre G0→G3)." + suffix,
          };
        }
        return {
          level: "full",
          ok: true,
          gates: reports.map((r) => ({ gate: r.gate, status: r.status, findings: r.findings, stats: r.stats })),
          snapshot,
        };
      },
    }),

    checkNetlist: tool({
      description: "Gate G1 : connexions from/to résolues, pins sans trace listés.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const { summary, json } = await ensureFull(files, resolveEntrypoint(files));
        const g0 = checkG0(summary);
        if (g0.status === "fail") return { ...reportOf(g0), blocked: "G0 rouge — évaluer d'abord." };
        return reportOf(runAllGates(summary, json).reports[1]);
      },
    }),

    checkPlacement: tool({
      description: "Gate G2 : chevauchements, hors-carte, marges. À passer AVANT tout routage.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const { summary, json } = await ensureFull(files, resolveEntrypoint(files));
        const all = runAllGates(summary, json);
        if (all.reports[1].status === "fail") {
          return { ...reportOf(all.reports[2]), blocked: "G1 rouge — netlist d'abord (doc 05 : gates séquentielles)." };
        }
        return reportOf(all.reports[2]);
      },
    }),

    checkRouting: tool({
      description: "Gate G3 : 0 net non routé, 0 violation. Interdit si G2 rouge.",
      inputSchema: z.object({}),
      execute: async () => {
        const files = await readAll();
        const { summary, json } = await ensureFull(files, resolveEntrypoint(files));
        const all = runAllGates(summary, json);
        if (all.reports[2].status === "fail") {
          return { ...reportOf(all.reports[3]), blocked: "G2 rouge — placement d'abord (doc 05 : gates séquentielles)." };
        }
        return reportOf(all.reports[3]);
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
      execute: async (input) => ({
        approved: true,
        at: new Date().toISOString(),
        plan: input.title,
        next: "Plan approuvé — générer : sourcing, code, évaluation G0–G3.",
      }),
    }),

    requestFinalApproval: tool({
      description:
        "GATE H2 — OBLIGATOIRE avant export : présente la revue finale (BOM chiffrée avec LCSC/stock/prix issus de searchComponents, état des gates G0–G3, limites) et SUSPEND le run jusqu'à l'approbation explicite. N'appeler qu'à gates G0–G3 vertes.",
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
      }),
      execute: async (input) => ({
        approved: true,
        at: new Date().toISOString(),
        items: input.bom.length,
        next: "Revue approuvée — appeler exportPack.",
      }),
    }),

    exportPack: tool({
      description:
        "EXPORT — après requestFinalApproval approuvée uniquement. Crée un snapshot versionné et prépare l'archive du projet (M1 : sources + BOM ; Gerber/DRC au M2 via worker KiCad). L'utilisateur approuve explicitement le téléchargement.",
      inputSchema: z.object({
        note: z.string().max(200).optional().describe("Note d'export."),
      }),
      execute: async ({ note }) => {
        const v = await createVersion(ctx.projectId, `Export M1${note ? ` — ${note}` : ""}`);
        return {
          ok: true,
          snapshot: `v${v.version_no}`,
          download: `/api/projects/${ctx.projectId}/export`,
          note: "M1 : archive des sources + BOM (Gerber/DRC au M2, worker KiCad).",
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
  return { gate: r.gate, status: r.status, findings: r.findings.slice(0, 20), stats: r.stats };
}
