// Fixtures gates G0–G3 sur runners natifs (P0-1, doc 12 §7/§10).
// Usage : `npm run gates:fixtures`
// - saines (healthy-*) : G0–G3 verts, 0 divergence ;
// - fautives (g1/g2/g3-*) : allPass faux, G0 rouge, et le runner natif de la
//   famille retourne ≥1 `*_error` (preuve : pas de gate aveugle).
//
// Note R4 (chemin « runner rouge jugé ») : 8 patterns fautifs ont été sondés
// contre la 0.0.265 (mustBeConnected, tension 5V→3.3V, switch aux contacts
// court-circuités, chevauchement, hors-carte, maxLength impossible,
// via-dans-pad, vias trop proches y compris en quasi-contact 0,05 mm) —
// chaque `*_error` de runner observé a une contrepartie au rendu, et les
// deux seules exceptions connues vont dans l'autre sens (rendu-seuls :
// `source_trace_not_connected_error`, `pcb_autorouting_error`, qui font
// échouer G0 à raison). Aucun cas G0-vert + runner-rouge n'a été trouvé :
// le chemin « runner jugé rouge » est donc couvert par les assertions
// runner-direct de ce script (même code que `nativeGateReport`). Si une
// future version des checks produit un tel cas, ajouter ici la fixture
// correspondante avec `judged: true` + `status: "fail"` attendus sur la gate.
// Import dynamique uniquement (tsx + Next) : `agent-gates` ne fait que des
// `await import()` vers `@tscircuit/eval` et `@tscircuit/checks`.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Expectation {
  healthy: boolean;
  /** Famille du runner natif attendu en erreur pour les fixtures fautives. */
  family?: "netlist" | "placement" | "routing";
}

const EXPECTED: Record<string, Expectation> = {
  "healthy-graetz": { healthy: true },
  "healthy-t-junction": { healthy: true },
  "g1-must-be-connected": { healthy: false, family: "netlist" },
  "g2-overlap": { healthy: false, family: "placement" },
  "g2-offboard": { healthy: false, family: "placement" },
  "g3-unrouted": { healthy: false, family: "routing" },
};

async function main(): Promise<void> {
  const { evaluateFullServer, runAllGates } = await import("../src/lib/agent-gates");
  const checks = await import("@tscircuit/checks");
  const dir = new URL("../fixtures/gates/", import.meta.url);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".tsx")).sort();
  let failed = 0;
  for (const file of files) {
    const name = file.replace(/\.tsx$/, "");
    const expected = EXPECTED[name];
    if (!expected) {
      console.log(`? ${name} : aucune attente déclarée — IGNORÉE (ajouter à EXPECTED).`);
      failed++;
      continue;
    }
    const code = await readFile(join(dir.pathname, file), "utf8");
    console.log(`\n=== ${name} (attendu : ${expected.healthy ? "vert G0–G3" : `rouge famille ${expected.family}`}) ===`);
    try {
      const full = await evaluateFullServer({ "main.tsx": code }, "main.tsx");
      const { reports, allPass, divergences } = await runAllGates(full.summary, full.circuitJson);
      for (const r of reports) {
        const extra = r.judged === false ? ` (non jugée : ${r.blocked ?? "bloquée"})` : "";
        console.log(
          `  ${r.gate}: ${r.status}${extra} ${JSON.stringify(r.stats)}`
        );
        for (const f of r.findings.filter((x) => x.severity === "error").slice(0, 5)) {
          console.log(`      - [${f.code}] ${f.message.slice(0, 160)}${f.ref ? ` (${f.ref})` : ""}`);
        }
      }
      if (expected.healthy) {
        if (!allPass) {
          console.log(`  → ÉCHEC : fixture saine rouge.`);
          failed++;
        } else if (divergences.length > 0) {
          console.log(`  → ÉCHEC : ${divergences.length} divergence(s) sur fixture saine : ${JSON.stringify(divergences.slice(0, 3))}.`);
          failed++;
        } else {
          console.log(`  → OK (G0–G3 verts, 0 divergence).`);
        }
      } else {
        if (allPass) {
          console.log(`  → ÉCHEC : fixture fautive verte (gate aveugle).`);
          failed++;
          continue;
        }
        const g0 = reports[0];
        if (g0.status !== "fail") {
          console.log(`  → ÉCHEC : G0 vert sur fixture fautive.`);
          failed++;
          continue;
        }
        const runner =
          expected.family === "netlist"
            ? [...(await checks.runAllNetlistChecks(JSON.parse(JSON.stringify(full.circuitJson)) as never))]
            : expected.family === "placement"
              ? [...(await checks.runAllPlacementChecks(JSON.parse(JSON.stringify(full.circuitJson)) as never))]
              : [...(await checks.runAllRoutingChecks(JSON.parse(JSON.stringify(full.circuitJson)) as never))];
        const errs = runner.filter((r) => String((r as { type?: unknown }).type ?? "").endsWith("_error"));
        if (errs.length === 0) {
          console.log(`  → ÉCHEC : runner ${expected.family} sans *_error sur fixture fautive.`);
          failed++;
        } else {
          console.log(`  → OK (G0 rouge, runner ${expected.family} : ${errs.length} erreur(s), ex. [${String((errs[0] as { type?: unknown }).type)}]).`);
        }
      }
    } catch (err) {
      failed++;
      console.log(`  → EXCEPTION : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (failed > 0) {
    console.log(`\n${failed} fixture(s) en échec.`);
    process.exit(1);
  }
  console.log("\nToutes les fixtures gates sont conformes (saines vertes, fautives rouges).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
