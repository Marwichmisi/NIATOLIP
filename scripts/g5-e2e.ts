// Preuve E2E #13 — job worker réel sur carte minimale (fixtures/g5-e2e/minimal.tsx).
// Usage : `tsx scripts/g5-e2e.ts` (web + worker Docker rebuildés avec le code P0-2).
// Crée un projet, pousse main.tsx + parts.json, lance POST validate, poll
// jusqu'à done, contrôle G5-PCB/G5-PCBA + PnP coordonné.
import { readFile } from "node:fs/promises";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3001";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function main(): Promise<void> {
  // Carte minimale E2E (fixtures/g5-e2e/minimal.tsx) : 100 % CMS, sans nets
  // nommés — les symboles rail du convertisseur (pins 0,01 mm) font échouer
  // le chargement ERC kicad-cli (limitation G4 pré-existante, hors P0-2).
  const code = await readFile(new URL("../fixtures/g5-e2e/minimal.tsx", import.meta.url), "utf8");
  const parts = [
    { ref: "R1", lcsc: "C25744", mpn: "0402WGF1002TCE", role: "LED série 1 kΩ" },
    { ref: "D1", lcsc: "C6848499", mpn: "150060VS75000", role: "LED verte" },
  ];
  const created = (await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "e2e-g5-minimal" }) })) as { project: { id: string } };
  const projectId = created.project.id;
  console.log(`projet ${projectId} (e2e-g5-minimal : R1+D1, sans rails — voir R1 revue #13)`);
  await api(`/api/projects/${projectId}/files`, { method: "PUT", body: JSON.stringify({ files: { "main.tsx": code, "parts.json": JSON.stringify(parts, null, 2) } }) });
  const job = (await api(`/api/projects/${projectId}/validate`, { method: "POST", body: JSON.stringify({ label: "e2e G5" }) })) as { jobId: string };
  console.log(`job ${job.jobId} queued`);
  const deadline = Date.now() + 9 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("timeout job worker (> 9 min) — worker joignable ?");
    await new Promise((r) => setTimeout(r, 10_000));
    const wrapped = (await api(`/api/validation-jobs/${job.jobId}`)) as {
      job: {
        status: string; g4: { status: string } | null; g5_pcb: { status: string; stats: unknown } | null; g5_pcba: { status: string; stats: unknown } | null; g5: unknown; error: string | null;
        artifacts: Array<{ kind: string; filename: string }>;
      };
    };
    const j = wrapped.job;
    console.log(`  status=${j.status} g4=${j.g4?.status} g5_pcb=${j.g5_pcb?.status} g5_pcba=${j.g5_pcba?.status} err=${j.error ?? "-"}`);
    if (j.status === "done" || j.status === "error") {
      const kinds = (j.artifacts ?? []).map((a) => a.kind).sort().join(",");
      console.log(`  artefacts: ${kinds}`);
      if (j.status !== "done") throw new Error(`job en erreur: ${j.error}`);
      if (j.g4?.status !== "pass") throw new Error("E2E rouge: G4 doit passer sur le board minimal");
      if (j.g5_pcb?.status !== "pass") throw new Error("E2E rouge: G5-PCB doit passer sur le board minimal");
      if (!j.g5_pcba) throw new Error("E2E rouge: G5-PCBA absente (worker non à jour ?)");
      console.log(`  G5-PCBA: ${j.g5_pcba.status} stats=${JSON.stringify(j.g5_pcba.stats)}`);
      if (!kinds.includes("pnp") || !kinds.includes("gerber") || !kinds.includes("bom") || !kinds.includes("report")) {
        throw new Error(`E2E rouge: pack incomplet (${kinds})`);
      }
      // Board d'évitement (sans rails) : prouve le pipeline G5, pas un design
      // représentatif — le Graetz attend le fix G4-compat (tâche P0 dédiée).
      console.log("E2E G5 OK (board minimal, sans rails) : G4 + G5-PCB verts, G5-PCBA jugée, pack complet.");
      if (process.env.E2E_CLEANUP === "1") {
        await api(`/api/projects/${projectId}`, { method: "DELETE" });
        console.log("projet E2E nettoyé (E2E_CLEANUP=1).");
      }
      return;
    }
  }
}

main().catch((e) => {
  console.error(`E2E KO: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
