// Checks G0–G3 côté serveur pour l'agent (issue #4, doc 05).
// Deux niveaux (choix utilisateur "les deux") :
//  1. statique rapide (regex, <10 ms) — premier filtre après chaque écriture ;
//  2. tscircuit réel via CircuitRunner en Node (~20-60 s) — verdict faisant foi.
//
// Le module est serveur uniquement : CircuitRunner n'est jamais bundlé client.
// Les résultats sont bornés (≤20 findings) — jamais de Circuit JSON au modèle.

if (typeof window !== "undefined") {
  throw new Error("src/lib/agent-gates.ts est serveur uniquement.");
}

import { summarizeCircuitJson, type CircuitElement, type CircuitSummary } from "./tscircuit-eval";

export type { CircuitElement, CircuitSummary };

export type GateId = "G0" | "G1" | "G2" | "G3";

export interface GateFinding {
  gate: GateId;
  severity: "error" | "warning";
  code: string;
  message: string;
  ref?: string;
}

export interface GateReport {
  gate: GateId;
  status: "pass" | "fail";
  findings: GateFinding[];
  stats: Record<string, number | string>;
}

function cap(findings: GateFinding[]): GateFinding[] {
  return findings.slice(0, 20);
}

// ---------- G0 : évaluation sans erreur ----------

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

// ---------- Helpers de lecture du Circuit JSON ----------

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function byType(json: CircuitElement[], type: string): CircuitElement[] {
  return json.filter((el) => el.type === type);
}

// ---------- G1 : netlist ----------

export function checkG1(json: CircuitElement[]): GateReport {
  const findings: GateFinding[] = [];
  const ports = new Map<string, { comp: string; pin: string }>();
  const compNames = new Map<string, string>();
  for (const c of byType(json, "source_component")) {
    const id = str(c.source_component_id);
    if (id) compNames.set(id, str(c.name) ?? id);
  }
  for (const p of byType(json, "source_port")) {
    const id = str(p.source_port_id);
    if (!id) continue;
    const compId = str(p.source_component_id) ?? "";
    ports.set(id, { comp: compNames.get(compId) ?? compId, pin: str(p.name) ?? "?" });
  }

  const traces = byType(json, "source_trace");
  const usedPorts = new Set<string>();
  const useCount = new Map<string, number>();
  for (const t of traces) {
    const id = str(t.source_trace_id) ?? "trace?";
    const connected = Array.isArray(t.connected_source_port_ids)
      ? (t.connected_source_port_ids as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    for (const pid of connected) {
      if (!ports.has(pid)) {
        findings.push({
          gate: "G1",
          severity: "error",
          code: "trace_unknown_port",
          message: `Trace ${id} connectée à un port inexistant (${pid}).`,
          ref: id,
        });
      }
      usedPorts.add(pid);
      useCount.set(pid, (useCount.get(pid) ?? 0) + 1);
    }
    if (connected.length < 2) {
      findings.push({
        gate: "G1",
        severity: "error",
        code: "trace_incomplete",
        message: `Trace ${id} ("${str(t.display_name) ?? "?"}") : moins de 2 ports connectés.`,
        ref: id,
      });
    }
  }

  // Jonctions en T sur un même pad : l'autorouteur intégré ne les route
  // pas — signaler tôt pour que l'agent revoie la topologie (G3 bloquerait).
  for (const [pid, n] of useCount) {
    if (n > 1 && findings.length < 20) {
      const info = ports.get(pid);
      findings.push({
        gate: "G1",
        severity: "warning",
        code: "multi_trace_port",
        message:
          `Pin partagé par ${n} traces : ${info ? `${info.comp}.${info.pin}` : pid}. ` +
          "Fusionner en une seule trace ou revoir la topologie (l'autorouteur ne route pas les jonctions en T).",
        ref: info ? `${info.comp}.${info.pin}` : pid,
      });
    }
  }
  // Pins sans trace : warnings (non bloquants — alims/découplage en revue).
  let orphanCount = 0;
  for (const [pid, info] of ports) {
    if (!usedPorts.has(pid)) {
      orphanCount++;
      if (findings.length < 20) {
        findings.push({
          gate: "G1",
          severity: "warning",
          code: "pin_missing_trace",
          message: `Pin sans trace : ${info.comp}.${info.pin}.`,
          ref: `${info.comp}.${info.pin}`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    gate: "G1",
    status: errors.length === 0 ? "pass" : "fail",
    findings: cap(findings),
    stats: { traces: traces.length, ports: ports.size, orphanPins: orphanCount },
  };
}

// ---------- G2 : placement ----------

interface Box {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export function checkG2(json: CircuitElement[]): GateReport {
  const findings: GateFinding[] = [];
  const boards = byType(json, "pcb_board");
  const board = boards[0];
  const bw = board ? (num(board.width) ?? 0) : 0;
  const bh = board ? (num(board.height) ?? 0) : 0;
  const bcx = board && typeof board.center === "object" && board.center !== null ? (num((board.center as Record<string, unknown>).x) ?? 0) : 0;
  const bcy = board && typeof board.center === "object" && board.center !== null ? (num((board.center as Record<string, unknown>).y) ?? 0) : 0;

  const boxes: Box[] = [];
  const compNames = new Map<string, string>();
  for (const c of byType(json, "source_component")) {
    const id = str(c.source_component_id);
    if (id) compNames.set(id, str(c.name) ?? id);
  }
  for (const c of byType(json, "pcb_component")) {
    const center = (c.center as Record<string, unknown> | undefined) ?? undefined;
    const cx = center ? (num(center.x) ?? 0) : 0;
    const cy = center ? (num(center.y) ?? 0) : 0;
    const w = num(c.width) ?? 2;
    const h = num(c.height) ?? 2;
    const rawId = str(c.source_component_id) ?? str(c.pcb_component_id) ?? "composant?";
    const id = compNames.get(rawId) ?? rawId;
    boxes.push({ id, cx, cy, w, h });

    if (bw > 0) {
      const outside =
        cx - w / 2 < bcx - bw / 2 - 1e-6 ||
        cx + w / 2 > bcx + bw / 2 + 1e-6 ||
        cy - h / 2 < bcy - bh / 2 - 1e-6 ||
        cy + h / 2 > bcy + bh / 2 + 1e-6;
      if (outside) {
        findings.push({
          gate: "G2",
          severity: "error",
          code: "off_board",
          message: `${id} dépasse les limites de la carte (${bw}×${bh} mm).`,
          ref: id,
        });
      } else {
        const margin = Math.min(
          cx - w / 2 - (bcx - bw / 2),
          bcx + bw / 2 - (cx + w / 2),
          cy - h / 2 - (bcy - bh / 2),
          bcy + bh / 2 - (cy + h / 2)
        );
        if (margin < 1) {
          findings.push({
            gate: "G2",
            severity: "warning",
            code: "edge_margin",
            message: `${id} à ${margin.toFixed(2)} mm du bord (< 1 mm, doc 04 règle 11).`,
            ref: id,
          });
        }
      }
    }
  }

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlapX = Math.min(a.cx + a.w / 2, b.cx + b.w / 2) - Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
      const overlapY = Math.min(a.cy + a.h / 2, b.cy + b.h / 2) - Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
      if (overlapX > 0.1 && overlapY > 0.1) {
        findings.push({
          gate: "G2",
          severity: "error",
          code: "overlap",
          message: `Chevauchement : ${a.id} × ${b.id} (~${overlapX.toFixed(1)}×${overlapY.toFixed(1)} mm).`,
          ref: `${a.id}/${b.id}`,
        });
      }
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    gate: "G2",
    status: errors.length === 0 ? "pass" : "fail",
    findings: cap(findings),
    stats: { components: boxes.length, board: bw > 0 ? `${bw}x${bh}` : "?" },
  };
}

// ---------- G3 : routage ----------

export function checkG3(json: CircuitElement[]): GateReport {
  const findings: GateFinding[] = [];
  const traces = byType(json, "source_trace");
  const pcbTraces = byType(json, "pcb_trace");
  let routed = 0;
  let vias = 0;

  for (const t of traces) {
    const id = str(t.source_trace_id);
    if (!id) continue;
    const matches = pcbTraces.filter((p) => (str(p.pcb_trace_id) ?? "").startsWith(`${id}_`));
    if (matches.length === 0) {
      findings.push({
        gate: "G3",
        severity: "error",
        code: "unrouted",
        message: `Net non routé : "${str(t.display_name) ?? id}".`,
        ref: id,
      });
    } else {
      routed++;
      for (const m of matches) {
        const route = Array.isArray(m.route) ? (m.route as Array<Record<string, unknown>>) : [];
        for (const seg of route) {
          if (seg.route_type === "via") vias++;
        }
      }
    }
  }

  for (const e of json) {
    if (e.type === "pcb_trace_error") {
      findings.push({
        gate: "G3",
        severity: "error",
        code: "pcb_trace_error",
        message: typeof e.message === "string" ? e.message : "Violation de routage.",
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  return {
    gate: "G3",
    status: errors.length === 0 ? "pass" : "fail",
    findings: cap(findings),
    stats: { nets: traces.length, routed, unrouted: traces.length - routed, vias },
  };
}

/** Toutes les gates dans l'ordre G0→G3 (séquentiel doc 05 : pas de G2/G3 si G0/G1 rouges — signalé, pas bloqué ici). */
export function runAllGates(
  summary: CircuitSummary,
  circuitJson: CircuitElement[]
): { reports: GateReport[]; allPass: boolean } {
  const reports = [checkG0(summary), checkG1(circuitJson), checkG2(circuitJson), checkG3(circuitJson)];
  return { reports, allPass: reports.every((r) => r.status === "pass") };
}
