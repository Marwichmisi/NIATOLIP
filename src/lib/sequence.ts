// Séquence G0→export imposée côté serveur (P0-3, issue #14, docs 05/15 §6.1).
// Serveur uniquement. Point de passage unique pour recalculer G0–G3 :
// - `resolveEntrypoint` partagé (agent, validate, worker) ;
// - `assertSequenceForValidation` réévalue le snapshot (evaluateFullServer +
//   runAllGates natifs) et vérifie la traçabilité sourcing en warning ;
// - le `g0g3` stocké sur le job est le snapshot recalculé, jamais la
//   déclaration de l'appelant (body.g0g3 / input outil ignorés).
if (typeof window !== "undefined") {
  throw new Error("src/lib/sequence.ts est serveur uniquement.");
}

import { join } from "node:path";
import { evaluateFullServer, runAllGates, type GateReport } from "./agent-gates";
import { TSCIRCUIT_VERSIONS } from "./toy-circuit";

export interface SourcingTrace {
  declared: number;
  traced: number;
  untraced: string[];
  verdict: string;
}

export interface SequenceSnapshot {
  version: 1;
  at: string;
  entrypoint: string;
  tscircuit: typeof TSCIRCUIT_VERSIONS;
  gates: GateReport[];
  allPass: boolean;
  sourcing: SourcingTrace;
}

export function resolveEntrypoint(files: Record<string, string>): string {
  if (typeof files["main.tsx"] === "string") return "main.tsx";
  if (typeof files["index.tsx"] === "string") return "index.tsx";
  const first = Object.keys(files).filter((p) => p.endsWith(".tsx")).sort()[0];
  if (!first) {
    const e = new Error("Aucun fichier .tsx dans le projet.") as Error & { code: string; status: number };
    e.code = "invalid_snapshot";
    e.status = 400;
    throw e;
  }
  return first;
}

function gatesCacheDir(): string {
  return join(process.env.PROJECTS_DIR ?? join(process.cwd(), "projects"), ".cache", "gates");
}

function hashFilesForLog(files: Record<string, string>, entrypoint: string): string {
  // Hash léger pour le journal de divergence (pas la clé de cache) : le
  // contenu exact suffit, la version est portée par le snapshot.
  const keys = Object.keys(files).filter((k) => !k.startsWith(".")).sort();
  return `${entrypoint}:${keys.length}:${keys.slice(0, 8).join(",")}`;
}

function normalizeLcsc(l: string): string {
  const m = /^C?(\d+)$/i.exec(l.trim());
  return m ? `C${m[1]}` : l;
}

/** Traçabilité sourcing (warning, jamais bloquante en P0-3 — D17 : le PCB nu ne bloque jamais). */
export function checkSourcingTraceability(files: Record<string, string>): SourcingTrace {
  let parts: Array<{ lcsc?: unknown }> = [];
  try {
    if (typeof files["parts.json"] === "string") {
      const parsed: unknown = JSON.parse(files["parts.json"]);
      if (Array.isArray(parsed)) parts = parsed as typeof parts;
    }
  } catch {
    parts = [];
  }
  const declared = parts
    .map((p) => (typeof p.lcsc === "string" ? normalizeLcsc(p.lcsc) : null))
    .filter((l): l is string => l !== null);
  let searched = new Set<string>();
  try {
    const raw = files[".agent-searches.json"];
    if (typeof raw === "string") {
      const list = JSON.parse(raw) as Array<{ lcsc?: unknown }>;
      if (Array.isArray(list)) {
        for (const r of list) {
          if (typeof r.lcsc === "string") searched.add(normalizeLcsc(r.lcsc));
        }
      }
    }
  } catch {
    searched = new Set();
  }
  const untraced = declared.filter((l) => !searched.has(l));
  return {
    declared: declared.length,
    traced: declared.length - untraced.length,
    untraced,
    verdict:
      untraced.length > 0
        ? `WARNING : ${untraced.join(", ")} sans searchComponents traçable — G5-PCBA jugera, n'invente jamais un verdict.`
        : "OK : chaque LCSC déclaré est traçable.",
  };
}

function seqErr(code: string, message: string, status = 409): never {
  const e = new Error(message) as Error & { code: string; status: number };
  e.code = code;
  e.status = status;
  throw e;
}

function detailOf(reports: GateReport[]): string {
  const fails = reports.filter((r) => r.status === "fail");
  return fails
    .map((r) => {
      const first = r.findings.find((f) => f.severity === "error");
      const suffix = r.judged === false ? ` (non jugée : ${r.blocked ?? "bloquée"})` : "";
      return `${r.gate}${suffix}${first ? ` — [${first.code}] ${first.message.slice(0, 160)}${first.ref ? ` (${first.ref})` : ""}` : ""}`;
    })
    .join(" ; ");
}

/**
 * Recalcule G0–G3 sur un snapshot et lève si rouge (409 `gates_not_green`)
 * ou si l'évaluation échoue (502 `evaluation_failed`). Ne crée ni version ni
 * job : l'appelant ne fige qu'après un retour vert.
 */
export async function assertSequenceForValidation(files: Record<string, string>): Promise<SequenceSnapshot> {
  const entrypoint = resolveEntrypoint(files);
  let summary: Awaited<ReturnType<typeof evaluateFullServer>>["summary"];
  let circuitJson: Awaited<ReturnType<typeof evaluateFullServer>>["circuitJson"];
  try {
    const full = await evaluateFullServer(files, entrypoint);
    summary = full.summary;
    circuitJson = full.circuitJson;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    seqErr("evaluation_failed", `Évaluation serveur impossible : ${message} — corrigez puis relancez.`, 502);
  }
  const { reports, allPass } = await runAllGates(summary!, circuitJson!, {
    hash: hashFilesForLog(files, entrypoint),
    divergenceDir: gatesCacheDir(),
  });
  const sourcing = checkSourcingTraceability(files);
  const snapshot: SequenceSnapshot = {
    version: 1,
    at: new Date().toISOString(),
    entrypoint,
    tscircuit: { ...TSCIRCUIT_VERSIONS },
    gates: reports,
    allPass,
    sourcing,
  };
  if (!allPass) {
    seqErr(
      "gates_not_green",
      `Séquence refusée : G0–G3 recalculés rouges (${detailOf(reports)}). Corrigez puis relancez — aucun job KiCad créé.`
    );
  }
  return snapshot;
}
