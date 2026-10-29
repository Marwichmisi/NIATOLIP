// Registre mémoire des runs agent (serveur uniquement).
// Permet à l'UI de suivre étapes/coût en direct (poll GET) et expose
// l'annulation propre. Volatil par design (perte au redémarrage OK :
// fichiers et historique restent persistés dans le projet).

if (typeof window !== "undefined") {
  throw new Error("src/lib/agent-runs.ts est serveur uniquement.");
}

import type { ModelChoice } from "./models";

export interface AgentRunInfo {
  id: string;
  projectId: string;
  choice: ModelChoice;
  steps: number;
  maxSteps: number;
  costUsd: number;
  maxCostUsd: number;
  done: boolean;
  aborted: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const runs = new Map<string, AgentRunInfo>();

export function registerRun(info: AgentRunInfo): void {
  if (runs.size > 50) {
    const oldest = [...runs.values()].sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0];
    if (oldest) runs.delete(oldest.id);
  }
  runs.set(info.id, info);
}

export function getRun(id: string): AgentRunInfo | null {
  return runs.get(id) ?? null;
}

export function touchRun(id: string, patch: Partial<AgentRunInfo>): void {
  const run = runs.get(id);
  if (run) runs.set(id, { ...run, ...patch });
}
