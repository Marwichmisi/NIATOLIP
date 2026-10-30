// Checks G0–G3 côté serveur pour l'agent (issue #10 / P0-1, docs 05 et 12).
// Règle d'or (doc 12 §5) : aucun verdict fait-maison. Les verdicts proviennent
// exclusivement des diagnostics natifs tscircuit :
//  - G0 : éléments `*_error` insérés par le core au rendu (lecture du JSON) ;
//  - G1 : `runAllNetlistChecks` + `runAllPinSpecificationChecks` ;
//  - G2 : `runAllPlacementChecks` ;
//  - G3 : `runAllRoutingChecks` (sur copie — le runner mute son entrée).
// Séquentialité stricte (doc 05) : une gate n'est jamais jugée si une gate
// antérieure est rouge (G1 bloquée si G0 rouge, G2 si G0/G1, G3 si G0/G1/G2 —
// le core skippe notamment le routage quand le placement est KO).
// Ce module n'est qu'une fine couche d'appel : lancer les runners, classer
// les findings par famille, les borner (≤20/gate, jamais de Circuit JSON
// brut au modèle), appliquer la séquentialité et la politique « seuls les
// `*_error` bloquent ». Aucun parsing d'identifiant, aucun seuil géométrique
// local, aucun comptage par trace ne produit de verdict ici.
//
// Le module est serveur uniquement : CircuitRunner / @tscircuit/checks ne
// sont jamais bundlés client (imports dynamiques — l'import statique casse
// en outre la résolution tsx via `math-utils` imbriqué).

if (typeof window !== "undefined") {
  throw new Error("src/lib/agent-gates.ts est serveur uniquement.");
}

import { summarizeCircuitJson, type CircuitElement, type CircuitSummary } from "./tscircuit-eval";
import { TSCIRCUIT_VERSIONS } from "./toy-circuit";

export type { CircuitElement, CircuitSummary };

export type GateId = "G0" | "G1" | "G2" | "G3";

export interface GateFinding {
  gate: GateId;
  severity: "error" | "warning";
  code: string;
  message: string;
  ref?: string;
  /** Vrai si la règle a été mise en quarantaine (doc 12 §6.2) : déclassée warning. */
  quarantined?: boolean;
}

export interface GateReport {
  gate: GateId;
  status: "pass" | "fail";
  findings: GateFinding[];
  stats: Record<string, number | string>;
  /** Vrai si la gate a été réellement jugée (faux = bloquée par une gate antérieure). */
  judged?: boolean;
  /** Explication si la gate n'a pas été jugée (séquentialité doc 05). */
  blocked?: string;
}

function cap(findings: GateFinding[]): GateFinding[] {
  return findings.slice(0, 20);
}

// ---------- G0 : évaluation sans erreur (lecteur natif, doc 12 §3) ----------

export function checkG0(summary: CircuitSummary): GateReport {
  const findings: GateFinding[] = summary.errors.map((e) => ({
    gate: "G0" as const,
    severity: "error" as const,
    code: e.code,
    message: e.message,
  }));
  return {
    gate: "G0",
    status: summary.ok ? "pass" : "fail",
    findings: cap(findings),
    stats: {
      elements: summary.elements,
      components: summary.components,
      traces: summary.traces,
      errors: summary.errors.length,
      durationMs: summary.durationMs,
    },
    judged: true,
  };
}

// ---------- Évaluation complète serveur (CircuitRunner Node) ----------

export interface FullEvaluation {
  summary: CircuitSummary;
  circuitJson: CircuitElement[];
  durationMs: number;
  truncated: boolean;
}

/**
 * Exécute le circuit avec le vrai tscircuit en Node. Lève en cas de timeout
 * ou d'exception (l'appelant transforme en finding G0). Timeout 150 s —
 * compatible maxDuration de la route.
 */
export async function evaluateFullServer(
  fsMap: Record<string, string>,
  entrypoint: string,
  timeoutMs = 150_000
): Promise<FullEvaluation> {
  const started = Date.now();
  const { CircuitRunner } = await import("@tscircuit/eval");
  const runner = new CircuitRunner();
  const kill = () => runner.kill().catch(() => {});
  try {
    const run = (async () => {
      await runner.executeWithFsMap({ fsMap, entrypoint });
      await runner.renderUntilSettled();
      return runner.getCircuitJson();
    })();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Évaluation serveur : timeout après ${timeoutMs / 1000} s.`)), timeoutMs)
    );
    const raw = (await Promise.race([run, timeout])) as unknown[];
    const circuitJson = (Array.isArray(raw) ? raw : []) as CircuitElement[];
    const durationMs = Date.now() - started;
    return {
      summary: summarizeCircuitJson(circuitJson, durationMs),
      circuitJson,
      durationMs,
      truncated: false,
    };
  } finally {
    await kill();
  }
}

// ---------- Chargement paresseux des runners natifs ----------

type ChecksModule = typeof import("@tscircuit/checks");
let checksModule: ChecksModule | null = null;

async function loadChecks(): Promise<ChecksModule> {
  if (!checksModule) {
    checksModule = await import("@tscircuit/checks");
  }
  return checksModule;
}

/** Version épinglée des checks natifs — source unique : `TSCIRCUIT_VERSIONS.checks`
 *  (`src/lib/toy-circuit.ts`, synchronisé avec `package.json` + `overrides`). */
export const CHECKS_VERSION = TSCIRCUIT_VERSIONS.checks;

// ---------- Conversion diagnostic natif → finding borné ----------

interface NativeDiagnostic {
  type?: unknown;
  error_type?: unknown;
  message?: unknown;
  [key: string]: unknown;
}

function diagType(d: NativeDiagnostic): string {
  if (typeof d.type === "string" && d.type.length > 0) return d.type;
  if (typeof d.error_type === "string" && d.error_type.length > 0) return d.error_type;
  return "unknown_native_diagnostic";
}

function diagMessage(d: NativeDiagnostic, code: string): string {
  if (typeof d.message === "string" && d.message.length > 0) return d.message;
  return `Diagnostic natif ${code}`;
}

/**
 * Résolution d'identifiants structurés vers des noms lisibles (Comp.pin).
 * Lecture seule des champs structurés du Circuit JSON — aucun verdict n'en
 * dépend, c'est uniquement l'étiquette `ref` présentée au modèle.
 */
function buildRefResolver(json: CircuitElement[]) {
  const compName = new Map<string, string>();
  for (const c of json) {
    if (c.type === "source_component" && typeof c.source_component_id === "string") {
      compName.set(c.source_component_id, typeof c.name === "string" ? c.name : c.source_component_id);
    }
  }
  const pcbCompSource = new Map<string, string>();
  for (const c of json) {
    if (c.type === "pcb_component" && typeof c.pcb_component_id === "string" && typeof c.source_component_id === "string") {
      pcbCompSource.set(c.pcb_component_id, c.source_component_id);
    }
  }
  const portLabel = new Map<string, string>();
  for (const p of json) {
    if (p.type === "source_port" && typeof p.source_port_id === "string") {
      const comp = typeof p.source_component_id === "string" ? compName.get(p.source_component_id) : undefined;
      const pin = typeof p.name === "string" ? p.name : "?";
      portLabel.set(p.source_port_id, comp ? `${comp}.${pin}` : pin);
    }
  }
  const pcbPortSource = new Map<string, string>();
  for (const p of json) {
    if (p.type === "pcb_port" && typeof p.pcb_port_id === "string" && typeof p.source_port_id === "string") {
      pcbPortSource.set(p.pcb_port_id, p.source_port_id);
    }
  }
  const traceLabel = new Map<string, string>();
  for (const t of json) {
    if (t.type === "source_trace" && typeof t.source_trace_id === "string") {
      traceLabel.set(t.source_trace_id, typeof t.display_name === "string" ? t.display_name : t.source_trace_id);
    }
  }
  function resolveOne(id: string): string | null {
    if (compName.has(id)) return compName.get(id) ?? null;
    const src = pcbCompSource.get(id);
    if (src && compName.has(src)) return compName.get(src) ?? null;
    if (portLabel.has(id)) return portLabel.get(id) ?? null;
    const sp = pcbPortSource.get(id);
    if (sp && portLabel.has(sp)) return portLabel.get(sp) ?? null;
    if (traceLabel.has(id)) return traceLabel.get(id) ?? null;
    return null;
  }
  return function resolveRef(d: NativeDiagnostic): string | undefined {
    const out: string[] = [];
    for (const [key, value] of Object.entries(d)) {
      if (typeof value === "string" && key.endsWith("_id")) {
        const label = resolveOne(value);
        if (label && !out.includes(label)) out.push(label);
      } else if (Array.isArray(value) && key.endsWith("_ids")) {
        for (const v of value) {
          if (typeof v !== "string") continue;
          const label = resolveOne(v);
          if (label && !out.includes(label)) out.push(label);
        }
      }
      if (out.length >= 3) break;
    }
    return out.length > 0 ? out.slice(0, 3).join(", ") : undefined;
  };
}

function toFindings(gate: GateId, diagnostics: unknown[], resolveRef: (d: NativeDiagnostic) => string | undefined): GateFinding[] {
  const seen = new Set<string>();
  const findings: GateFinding[] = [];
  for (const raw of diagnostics) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as NativeDiagnostic;
    const code = diagType(d);
    const message = diagMessage(d, code);
    const ref = resolveRef(d);
    const key = `${code}|${message}|${ref ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    findings.push({
      gate,
      // Taxonomie natif fait foi : `*_error` bloquant, `*_warning` informatif.
      severity: code.endsWith("_error") ? "error" : "warning",
      code,
      message,
      ...(ref ? { ref } : {}),
    });
  }
  // Erreurs d'abord (une gate rouge ne doit pas cacher son erreur derrière
  // 20 warnings quand on borne).
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
  return findings;
}

function reportFromFindings(gate: GateId, allFindings: GateFinding[], extraStats: Record<string, number | string> = {}): GateReport {
  const errors = allFindings.filter((f) => f.severity === "error").length;
  const warnings = allFindings.length - errors;
  return {
    gate,
    status: errors > 0 ? "fail" : "pass",
    findings: cap(allFindings),
    stats: {
      source: `@tscircuit/checks@${CHECKS_VERSION}`,
      diagnostics: allFindings.length,
      errors,
      warnings,
      ...extraStats,
    },
    judged: true,
  };
}

function exceptionReport(gate: GateId, err: unknown): GateReport {
  const message = err instanceof Error ? err.message : String(err);
  return {
    gate,
    status: "fail",
    findings: [
      {
        gate,
        severity: "error",
        code: `${gate.toLowerCase()}_native_check_exception`,
        message: `Runner natif ${gate} en exception (aucun verdict produit) : ${message}`,
      },
    ],
    stats: { source: `@tscircuit/checks@${CHECKS_VERSION}`, diagnostics: 1, errors: 1, warnings: 0 },
    judged: true,
  };
}

function blockedReport(gate: GateId, blockedBy: GateId): GateReport {
  return {
    gate,
    status: "fail",
    findings: [],
    stats: { source: `@tscircuit/checks@${CHECKS_VERSION}`, diagnostics: 0, errors: 0, warnings: 0, blockedBy },
    judged: false,
    blocked: `${blockedBy} rouge — ${gate} non jugée (doc 05 : gates séquentielles).`,
  };
}

// ---------- Protocole anti-« gate menteuse » (doc 12 §6) ----------

export type DivergenceKind = "blind" | "unmatched_runner";

export interface GateDivergence {
  gate: GateId;
  ruleCode: string;
  kind: DivergenceKind;
  verdict: "pass" | "fail";
  /** Types `*_error` natifs du rendu dans la famille de la gate. */
  nativeRenderTypes: string[];
  at: string;
}

/** Familles d'erreurs de rendu (classification, jamais un verdict). */
export function classifyRenderErrorGate(type: string): GateId | null {
  if (!type.endsWith("_error")) return null;
  if (type.startsWith("source_") || type.startsWith("schematic_")) return "G1";
  if (
    type.includes("placement") ||
    type.includes("courtyard") ||
    type.includes("footprint_overlap") ||
    type.includes("outside_board") ||
    type.includes("component_over") ||
    type.includes("keepout") ||
    type.startsWith("pcb_component_") ||
    type.startsWith("pcb_copper_over") ||
    type.startsWith("pcb_courtyard")
  ) {
    return "G2";
  }
  if (
    type.startsWith("pcb_trace") ||
    type.startsWith("pcb_port_") ||
    type.startsWith("pcb_autorouting") ||
    type.startsWith("pcb_via") ||
    type.startsWith("pcb_copper_pour") ||
    type.startsWith("pcb_pad_") ||
    type.startsWith("pcb_hole_") ||
    type.startsWith("pcb_bus_")
  ) {
    return "G3";
  }
  return null;
}

/**
 * Croise verdict de famille × erreurs natives du rendu (doc 12 §6.1).
 * - `blind` (gate aveugle, le pire) : gate verte alors qu'une erreur native
 *   du rendu de sa famille n'est reproduite par aucun finding du runner.
 * - `unmatched_runner` : erreur de runner sans contrepartie (même type) dans
 *   le rendu — le natif peut être jeune (§9) : on journalise, on n'invente pas.
 * G0 est exclue par construction (son verdict EST le rendu).
 * Les gates non jugées (bloquées) sont exclues : un verdict bloqué n'est
 * jamais une divergence.
 */
export function detectDivergences(reports: GateReport[], circuitJson: CircuitElement[]): GateDivergence[] {
  const at = new Date().toISOString();
  const renderByGate = new Map<GateId, Set<string>>();
  for (const el of circuitJson) {
    if (typeof el.type !== "string") continue;
    const gate = classifyRenderErrorGate(el.type);
    if (!gate) continue;
    if (!renderByGate.has(gate)) renderByGate.set(gate, new Set());
    renderByGate.get(gate)?.add(el.type);
  }
  const divergences: GateDivergence[] = [];
  for (const report of reports) {
    if (report.gate === "G0" || report.judged === false) continue;
    const renderTypes = renderByGate.get(report.gate) ?? new Set<string>();
    const runnerErrorTypes = new Set(report.findings.filter((f) => f.severity === "error").map((f) => f.code));
    if (report.status === "pass") {
      for (const type of renderTypes) {
        if (!runnerErrorTypes.has(type)) {
          divergences.push({ gate: report.gate, ruleCode: type, kind: "blind", verdict: report.status, nativeRenderTypes: [...renderTypes], at });
        }
      }
    } else {
      for (const code of runnerErrorTypes) {
        if (!renderTypes.has(code)) {
          divergences.push({ gate: report.gate, ruleCode: code, kind: "unmatched_runner", verdict: report.status, nativeRenderTypes: [...renderTypes], at });
        }
      }
    }
  }
  return divergences;
}

export interface QuarantineRuleState {
  gate: GateId;
  kind: DivergenceKind;
  /** Nombre d'évaluations distinctes (hashes) ayant divergé. */
  count: number;
  hashes: string[];
  quarantined: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface QuarantineStore {
  rules: Record<string, QuarantineRuleState>;
}

export function emptyQuarantineStore(): QuarantineStore {
  return { rules: {} };
}

/** Seuil de quarantaine (doc 12 §6.2) : 3 divergences sur la même règle. */
export const QUARANTINE_THRESHOLD = 3;

/**
 * Applique un store de quarantaine à des rapports : les findings `error`
 * des règles quarantinées sont déclassés `warning` (visibles, flag
 * `quarantined`) — jamais supprimés. Réactivation : uniquement par un humain
 * qui retire la règle de `gates-quarantine.json` (doc 12 §6.2).
 */
export function applyQuarantineToReports(reports: GateReport[], store: QuarantineStore): GateReport[] {
  const quarantined = new Set(Object.entries(store.rules).filter(([, r]) => r.quarantined).map(([code]) => code));
  if (quarantined.size === 0) return reports;
  return reports.map((report) => {
    if (report.judged === false) return report;
    if (!report.findings.some((f) => f.severity === "error" && quarantined.has(f.code))) return report;
    const findings = report.findings.map((f) =>
      f.severity === "error" && quarantined.has(f.code) ? { ...f, severity: "warning" as const, quarantined: true } : f
    );
    const errors = findings.filter((f) => f.severity === "error").length;
    return {
      ...report,
      status: errors > 0 ? ("fail" as const) : ("pass" as const),
      findings,
      stats: { ...report.stats, errors, warnings: findings.length - errors, quarantined: findings.filter((f) => f.quarantined).length },
    };
  });
}

async function quarantinePaths(dir: string) {
  const { join } = await import("node:path");
  return { log: join(dir, "gate-divergences.jsonl"), store: join(dir, "gates-quarantine.json") };
}

export async function loadQuarantineStore(dir: string): Promise<QuarantineStore> {
  try {
    const { readFile } = await import("node:fs/promises");
    const { store } = await quarantinePaths(dir);
    const parsed = JSON.parse(await readFile(store, "utf8")) as QuarantineStore;
    if (!parsed || typeof parsed !== "object" || typeof parsed.rules !== "object" || parsed.rules === null) {
      return emptyQuarantineStore();
    }
    return parsed;
  } catch {
    return emptyQuarantineStore();
  }
}

/**
 * Journalise les divergences (même persistance que le cache d'éval) et met
 * à jour le store de quarantaine. Un même hash ne compte qu'une fois : il
 * faut 3 évaluations distinctes pour quarantiner une règle.
 * Best-effort : ne lève jamais (la journalisation ne bloque pas une gate).
 * Retourne les règles nouvellement quarantinées par cet appel.
 */
export async function recordGateDivergences(
  divergences: GateDivergence[],
  opts: { dir: string; hash?: string }
): Promise<{ newlyQuarantined: string[]; store: QuarantineStore }> {
  const store = await loadQuarantineStore(opts.dir);
  const newlyQuarantined: string[] = [];
  if (divergences.length === 0) return { newlyQuarantined, store };
  try {
    const { appendFile, mkdir, writeFile } = await import("node:fs/promises");
    const paths = await quarantinePaths(opts.dir);
    await mkdir(opts.dir, { recursive: true });
    const lines = divergences.map((d) => JSON.stringify({ ...d, hash: opts.hash ?? null })).join("\n") + "\n";
    await appendFile(paths.log, lines, "utf8");
    for (const d of divergences) {
      const existing = store.rules[d.ruleCode];
      if (!existing) {
        store.rules[d.ruleCode] = {
          gate: d.gate,
          kind: d.kind,
          count: 1,
          hashes: opts.hash ? [opts.hash] : [],
          quarantined: false,
          firstSeenAt: d.at,
          lastSeenAt: d.at,
        };
      } else {
        existing.lastSeenAt = d.at;
        if (opts.hash) {
          if (!existing.hashes.includes(opts.hash)) {
            existing.hashes.push(opts.hash);
            existing.count = existing.hashes.length;
          }
        } else {
          existing.count += 1;
        }
      }
      const rule = store.rules[d.ruleCode];
      if (!rule.quarantined && rule.count >= QUARANTINE_THRESHOLD) {
        rule.quarantined = true;
        newlyQuarantined.push(d.ruleCode);
      }
    }
    await writeFile(paths.store, JSON.stringify(store, null, 2), "utf8");
  } catch {
    // Best-effort : jamais bloquant.
  }
  return { newlyQuarantined, store };
}

// ---------- Orchestration G0→G3 sur runners natifs ----------

export interface RunAllGatesOptions {
  /** Hash du contenu évalué (journal de divergence, déduplication). */
  hash?: string;
  /** Répertoire de persistance divergence/quarantaine (cache d'éval). */
  divergenceDir?: string;
  /** Active journal + quarantaine (défaut : vrai si `divergenceDir` est fourni). */
  recordDivergences?: boolean;
}

export interface RunAllGatesResult {
  reports: GateReport[];
  allPass: boolean;
  divergences: GateDivergence[];
  quarantinedRules: string[];
}

async function nativeGateReport(
  gate: GateId,
  runners: Array<(checks: ChecksModule) => Promise<unknown[]>>,
  resolveRef: (d: NativeDiagnostic) => string | undefined
): Promise<GateReport> {
  try {
    const checks = await loadChecks();
    const diagnostics: unknown[] = [];
    for (const run of runners) {
      diagnostics.push(...(await run(checks)));
    }
    return reportFromFindings(gate, toFindings(gate, diagnostics, resolveRef));
  } catch (err) {
    return exceptionReport(gate, err);
  }
}

/**
 * Toutes les gates dans l'ordre G0→G3 avec séquentialité stricte (doc 05) :
 * G1 bloquée si G0 rouge, G2 si G0/G1 rouges, G3 si G0/G1/G2 rouges (le core
 * skippe notamment le routage quand le placement est KO : juger G3 punirait
 * un symptôme). Les erreurs `source_trace_not_connected_error` et
 * `pcb_autorouting_error` sont rendu-seules (aucun runner ne les reproduit) :
 * elles font échouer G0, donc les gates suivantes sont bloquées à raison.
 * G3 s'exécute en dernier, sur copie profonde (runAllRoutingChecks mute).
 * La quarantaine lue AVANT ce run s'applique ; une règle quarantinée par ce
 * run prend effet au run suivant, avec un finding d'escalade humaine visible
 * dans le rapport courant (doc 12 §6.2).
 */
export async function runAllGates(
  summary: CircuitSummary,
  circuitJson: CircuitElement[],
  opts: RunAllGatesOptions = {}
): Promise<RunAllGatesResult> {
  const resolveRef = buildRefResolver(circuitJson);
  const g0 = checkG0(summary);
  const firstFail = (rs: GateReport[]): GateId | null => {
    const failed = rs.find((r) => r.status === "fail");
    return failed ? failed.gate : null;
  };

  const g1 =
    g0.status === "fail"
      ? blockedReport("G1", "G0")
      : await nativeGateReport("G1", [
          (checks) => checks.runAllNetlistChecks(circuitJson as never),
          (checks) => checks.runAllPinSpecificationChecks(circuitJson as never),
        ], resolveRef);

  const g2 =
    firstFail([g0, g1]) !== null
      ? blockedReport("G2", firstFail([g0, g1]) as GateId)
      : await nativeGateReport("G2", [
          (checks) => checks.runAllPlacementChecks(circuitJson as never),
        ], resolveRef);

  // G3 en dernier, sur copie profonde : runAllRoutingChecks mute son entrée.
  const g3 =
    firstFail([g0, g1, g2]) !== null
      ? blockedReport("G3", firstFail([g0, g1, g2]) as GateId)
      : await nativeGateReport("G3", [
          (checks) => {
            const copy = JSON.parse(JSON.stringify(circuitJson)) as CircuitElement[];
            return checks.runAllRoutingChecks(copy as never);
          },
        ], resolveRef);

  let reports = [g0, g1, g2, g3];
  const divergences = detectDivergences(reports, circuitJson);
  let quarantinedRules: string[] = [];

  const shouldRecord = opts.recordDivergences ?? Boolean(opts.divergenceDir);
  if (opts.divergenceDir) {
    const storeBefore = await loadQuarantineStore(opts.divergenceDir);
    quarantinedRules = Object.entries(storeBefore.rules)
      .filter(([, r]) => r.quarantined)
      .map(([code]) => code);
    reports = applyQuarantineToReports(reports, storeBefore);
    if (shouldRecord && divergences.length > 0) {
      const { newlyQuarantined } = await recordGateDivergences(divergences, {
        dir: opts.divergenceDir,
        hash: opts.hash,
      });
      if (newlyQuarantined.length > 0) {
        quarantinedRules = [...new Set([...quarantinedRules, ...newlyQuarantined])];
        reports = reports.map((report) => {
          if (report.judged === false) return report;
          const hit = newlyQuarantined.filter((code) => report.findings.some((f) => f.code === code));
          if (hit.length === 0) return report;
          return {
            ...report,
            findings: cap([
              {
                gate: report.gate,
                severity: "warning" as const,
                code: "gate_rule_quarantined",
                message:
                  `ESCALADE HUMAINE : règle(s) ${hit.join(", ")} en quarantaine après ${QUARANTINE_THRESHOLD} divergences ` +
                  "(doc 12 §6.2) — déclassée warning au prochain run ; réactivation uniquement par un humain " +
                  "(retirer la règle de gates-quarantine.json).",
              },
              ...report.findings,
            ]),
          };
        });
      }
    }
  }

  return { reports, allPass: reports.every((r) => r.status === "pass"), divergences, quarantinedRules };
}
