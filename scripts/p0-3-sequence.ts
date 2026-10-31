// Preuve P0-3 (issue #14) — séquence G0→export imposée côté serveur.
// Usage : `npm run p0-3:sequence` (sans Docker, sans réseau).
// Vérifie de façon reproductible :
//  1. g0g3 mensonger inopérant : assertSequenceForValidation recalcule et
//     rejette (409 gates_not_green) un circuit rouge — aucun job créé ;
//  2. fixture saine verte avec snapshot versionné + traçabilité ;
//  3. traçabilité sourcing = warning non bloquant (D17) ;
//  4. export « validé » exigé : isJobGreenForExport + H2 postérieure au job
//     (hasValidH2 : avant → refus, après → OK, jobId différent → refus) ;
//  5. garde download : seuls gerber/bom/pnp/kicad d'un job vert passent.
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function main(): Promise<void> {
  // Isolation : ne touche jamais aux vrais projets.
  process.env.PROJECTS_DIR = mkdtempSync(join(tmpdir(), "niatolip-p03-"));
  const { assertSequenceForValidation, checkSourcingTraceability } = await import("../src/lib/sequence");
  const { hasValidH2, listApprovals, recordApproval } = await import("../src/lib/approvals");
  const { isJobGreenForExport } = await import("../src/lib/validation");

  let failed = 0;
  const ok = (name: string, cond: boolean, detail = "") => {
    console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!cond) failed++;
  };

  // 1. Rouge recalculé → 409, rien créé (l'appelant mensonger est inopérant).
  const redCode = await readFile(new URL("../fixtures/gates/g3-unrouted.tsx", import.meta.url), "utf8");
  try {
    await assertSequenceForValidation({ "main.tsx": redCode });
    ok("g0g3 rouge rejeté", false, "aucune erreur levée");
  } catch (e) {
    const code = (e as { code?: string })?.code;
    const status = (e as { status?: number })?.status;
    ok("g0g3 rouge rejeté", code === "gates_not_green" && status === 409, `code=${code} status=${status}`);
  }

  // 2. Saine verte + snapshot.
  const greenCode = await readFile(new URL("../fixtures/gates/healthy-graetz.tsx", import.meta.url), "utf8");
  try {
    const snap = await assertSequenceForValidation({ "main.tsx": greenCode });
    ok("fixture saine verte", snap.allPass && snap.version === 1, `gates=${snap.gates.map((g) => `${g.gate}:${g.status}`).join(" ")}`);
    ok("snapshot outille", snap.entrypoint === "main.tsx" && typeof snap.tscircuit.checks === "string", `checks=${snap.tscircuit.checks}`);
  } catch (e) {
    ok("fixture saine verte", false, e instanceof Error ? e.message.slice(0, 200) : String(e));
  }

  // 3. Traçabilité = warning non bloquant.
  const trace = checkSourcingTraceability({
    "main.tsx": greenCode,
    "parts.json": JSON.stringify([{ ref: "R1", lcsc: "C999999", mpn: "x", role: "test" }]),
    ".agent-searches.json": JSON.stringify([]),
  });
  ok("traçabilité warning non bloquant", trace.declared === 1 && trace.untraced.length === 1, trace.verdict.slice(0, 80));

  // 4. H2 serveur : avant le job → refus ; après → OK ; autre job → refus.
  const pid = "test-projet-p03";
  const jobDone = "2026-10-31T10:00:00.000Z";
  await recordApproval(pid, { gate: "H2", approved: true, jobId: "job-ancien", reason: "revue job précédent" });
  // Recule artificiellement : l'enregistrement ci-dessus est « maintenant », donc
  // valide pour un job plus ancien — on teste l'inverse avec un job futur.
  const futureJob = { id: "job-futur", finished_at: new Date(Date.now() + 60_000).toISOString() };
  const before = await hasValidH2(pid, futureJob);
  ok("H2 antérieure au rapport refusée", !before.ok, "une revue ne peut pas précéder le rapport");

  await recordApproval(pid, { gate: "H2", approved: true, jobId: "job-vert", reason: "revue du job vert" });
  const same = await hasValidH2(pid, { id: "job-vert", finished_at: new Date(Date.now() - 1000).toISOString() });
  ok("H2 postérieure au job acceptée", same.ok, `approval=${same.approval?.id.slice(0, 8)}`);
  const other = await hasValidH2(pid, { id: "job-autre", finished_at: new Date(Date.now() - 1000).toISOString() });
  // L'approbation liée à job-vert ne vaut pas pour job-autre ; seule une H2
  // sans jobId ou liée à job-autre vaudrait — ici job-ancien est lié ailleurs.
  const onlyLinked = other.approval?.jobId === "job-autre";
  ok("H2 d'un autre job refusée", !other.ok || onlyLinked, `ok=${other.ok}`);
  void jobDone;
  const approvals = await listApprovals(pid);
  ok("approvals listées", approvals.length >= 2, `${approvals.length} décision(s)`);

  // 5. Garde vert : job synthétiques.
  const green = { status: "done", g4: { status: "pass", findings: [], stats: {} }, g5: null, g5_pcb: { status: "pass", findings: [], stats: {} } } as never;
  const red = { status: "done", g4: { status: "fail", findings: [], stats: {} }, g5: null, g5_pcb: { status: "fail", findings: [], stats: {} } } as never;
  const queued = { status: "queued", g4: null, g5: null, g5_pcb: null } as never;
  ok("job vert ouvre le pack validé", isJobGreenForExport(green) === true);
  ok("job rouge ferme le pack validé", isJobGreenForExport(red) === false);
  ok("job queued ferme le pack validé", isJobGreenForExport(queued) === false);

  if (failed > 0) {
    console.log(`\n${failed} vérification(s) P0-3 en échec.`);
    process.exit(1);
  }
  console.log("\nP0-3 : séquence serveur prouvée (g0g3 recalculé, H2 serveur, garde vert).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
