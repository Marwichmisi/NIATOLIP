// Preuve E2E #13 + P0-6 #28 — job worker réel sur board représentatif à nets
// nommés (fixtures/gates/healthy-graetz.tsx, cas de référence doc 12 §7).
// Usage : `tsx scripts/g5-e2e.ts` (web + worker Docker rebuildés avec le code P0-6).
// Crée un projet, pousse main.tsx + parts.json, lance POST validate, poll
// jusqu'à done, contrôle G4 vert + G5-PCB/G5-PCBA jugées.
// Historique : le board minimal sans rails (fixtures/g5-e2e/minimal.tsx) servait
// de board d'évitement tant que `(power global)` du convertisseur faisait
// échouer tout ERC kicad-cli 9.0.9 (exit 3) — normalisation worker P0-6 #28.
// Le Graetz prouve désormais le pipeline G4/G5 sur design réel (VRECT/VCC/GND).
import { readFile } from "node:fs/promises";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3001";

async function api(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

async function main(): Promise<void> {
  // Board représentatif P0-6 : Graetz à nets nommés (VRECT/VCC/GND) — les rails
  // `Custom:rail_up/down` du convertisseur sont normalisés `(power)` côté worker.
  const code = await readFile(new URL("../fixtures/gates/healthy-graetz.tsx", import.meta.url), "utf8");
  // BOM de preuve : refs du Graetz ; LCSC plausibles (stock inconnu = warning
  // G5-PCBA, jamais bloquant ; rupture confirmée = erreur).
  const parts = [
    { ref: "BR1", lcsc: "C4004", mpn: "DB107", role: "Pont redresseur Graetz" },
    { ref: "C1", lcsc: "C1525", mpn: "CL05B104KO5NNNC", role: "Découplage 100 nF" },
    { ref: "U1", lcsc: "C2924396", mpn: "BCT2057ELT33-TR", role: "LDO 3,3 V" },
    { ref: "RLED", lcsc: "C25744", mpn: "0402WGF1002TCE", role: "LED série 1 kΩ" },
    { ref: "D1", lcsc: "C6848499", mpn: "150060VS75000", role: "LED verte" },
  ];
  const created = (await api("/api/projects", { method: "POST", body: JSON.stringify({ name: "e2e-g5-graetz" }) })) as { project: { id: string } };
  const projectId = created.project.id;
  console.log(`projet ${projectId} (e2e-g5-graetz : Graetz à nets nommés, P0-6 #28)`);
  await api(`/api/projects/${projectId}/files`, { method: "PUT", body: JSON.stringify({ files: { "main.tsx": code, "parts.json": JSON.stringify(parts, null, 2) } }) });
  const job = (await api(`/api/projects/${projectId}/validate`, { method: "POST", body: JSON.stringify({ label: "e2e G5 Graetz" }) })) as { jobId: string };
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
      if (j.g4?.status !== "pass") throw new Error("E2E rouge: G4 doit passer sur le Graetz (rails normalisés P0-6)");
      if (j.g5_pcb?.status !== "pass") throw new Error("E2E rouge: G5-PCB doit passer sur le Graetz");
      if (!j.g5_pcba) throw new Error("E2E rouge: G5-PCBA absente (worker non à jour ?)");
      console.log(`  G5-PCBA: ${j.g5_pcba.status} stats=${JSON.stringify(j.g5_pcba.stats)}`);
      if (!kinds.includes("pnp") || !kinds.includes("gerber") || !kinds.includes("bom") || !kinds.includes("report")) {
        throw new Error(`E2E rouge: pack incomplet (${kinds})`);
      }
      // Critère de sortie P0-6 : G4 vert sur Graetz, G5 jugées, sans board d'évitement.
      console.log("E2E G5 OK (Graetz à nets nommés) : G4 + G5-PCB verts, G5-PCBA jugée, pack complet.");
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
